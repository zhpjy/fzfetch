use std::collections::HashSet;
use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::{Instant, SystemTime, UNIX_EPOCH};

use tokio::sync::{Mutex, RwLock, broadcast};
use tokio::task;
use tokio::time::sleep;

use crate::cache::{
    CacheLayoutStatus, ensure_cache_layout, load_cache_paths, write_cache_snapshot,
};
use crate::config::AppConfig;
use crate::scanner::{diff_paths, scan_root_files};
use crate::search::{SearchEngine, SearchHit};

pub struct AppState {
    pub config: Arc<AppConfig>,
    pub index_manager: Arc<IndexManager>,
    pub refresh_tx: broadcast::Sender<String>,
}

impl AppState {
    pub fn new(config: AppConfig) -> Self {
        let (refresh_tx, _) = broadcast::channel(64);
        let config = Arc::new(config);
        let index_manager = Arc::new(IndexManager::new(config.clone(), refresh_tx.clone()));

        Self {
            config,
            index_manager,
            refresh_tx,
        }
    }
}

pub struct IndexRuntime {
    pub paths: RwLock<HashSet<String>>,
    pub engine: Mutex<SearchEngine>,
    pub last_used_at: Mutex<Instant>,
    pub last_refresh_at: Mutex<SystemTime>,
    pub refreshing: AtomicBool,
    pub bootstrap_refresh_pending: AtomicBool,
}

pub struct IndexManager {
    pub config: Arc<AppConfig>,
    pub runtime: RwLock<Option<Arc<IndexRuntime>>>,
    refresh_tx: broadcast::Sender<String>,
}

struct RefreshGuard {
    runtime: Arc<IndexRuntime>,
}

impl RefreshGuard {
    fn new(runtime: Arc<IndexRuntime>) -> Self {
        Self { runtime }
    }
}

impl Drop for RefreshGuard {
    fn drop(&mut self) {
        self.runtime.refreshing.store(false, Ordering::Release);
    }
}

impl IndexManager {
    pub fn new(config: Arc<AppConfig>, refresh_tx: broadcast::Sender<String>) -> Self {
        Self {
            config,
            runtime: RwLock::new(None),
            refresh_tx,
        }
    }

    pub async fn ensure_loaded(&self) -> anyhow::Result<Arc<IndexRuntime>> {
        if let Some(runtime) = self.runtime.read().await.clone() {
            return Ok(runtime);
        }

        let mut runtime_guard = self.runtime.write().await;
        if let Some(runtime) = runtime_guard.clone() {
            return Ok(runtime);
        }

        tracing::info!(
            cache_file = %self.config.cache_file.display(),
            "lazy index load started"
        );
        let cache_status = ensure_cache_layout(&self.config.data_dir, &self.config.cache_file)?;
        let paths = load_cache_paths(&self.config.cache_file)?;

        let mut engine = SearchEngine::new();
        engine.seed(paths.iter().cloned());

        let last_refresh_at = std::fs::metadata(&self.config.cache_file)
            .and_then(|meta| meta.modified())
            .unwrap_or(UNIX_EPOCH);

        let runtime = Arc::new(IndexRuntime {
            paths: RwLock::new(paths),
            engine: Mutex::new(engine),
            last_used_at: Mutex::new(Instant::now()),
            last_refresh_at: Mutex::new(last_refresh_at),
            refreshing: AtomicBool::new(false),
            bootstrap_refresh_pending: AtomicBool::new(
                self.config.force_initial_refresh || cache_status == CacheLayoutStatus::Created,
            ),
        });
        let path_count = runtime.paths.read().await.len();

        tracing::info!(
            cache_file = %self.config.cache_file.display(),
            path_count,
            bootstrap_refresh_pending = runtime.bootstrap_refresh_pending.load(Ordering::Acquire),
            "lazy index load completed"
        );
        *runtime_guard = Some(runtime.clone());
        Ok(runtime)
    }

    pub async fn search(&self, query: &str) -> anyhow::Result<Vec<SearchHit>> {
        let runtime = self.ensure_loaded().await?;
        *runtime.last_used_at.lock().await = Instant::now();
        self.maybe_spawn_refresh(runtime.clone()).await;

        let mut engine = runtime.engine.lock().await;
        Ok(engine.search(query, self.config.top_k))
    }

    pub async fn maybe_unload_idle(&self) {
        let Some(runtime) = self.runtime.read().await.clone() else {
            return;
        };

        let last_used_at = *runtime.last_used_at.lock().await;
        let idle_for = last_used_at.elapsed();
        if idle_for <= self.config.idle_ttl {
            tracing::debug!(
                idle_for_secs = idle_for.as_secs_f32(),
                idle_ttl_secs = self.config.idle_ttl.as_secs(),
                "index unload skipped because runtime is still active"
            );
            return;
        }

        if runtime.refreshing.load(Ordering::Acquire) {
            tracing::debug!("index unload skipped because refresh is still running");
            return;
        }

        let mut runtime_guard = self.runtime.write().await;
        let Some(current_runtime) = runtime_guard.as_ref().cloned() else {
            return;
        };

        if !Arc::ptr_eq(&current_runtime, &runtime) {
            return;
        }

        if !self.runtime_is_unloadable(&current_runtime).await {
            return;
        }

        *runtime_guard = None;
        tracing::info!(
            idle_for_secs = idle_for.as_secs_f32(),
            "idle in-memory index unloaded"
        );
    }

    pub async fn run_cleanup_loop(self: Arc<Self>) {
        loop {
            sleep(self.config.cleanup_interval).await;
            self.maybe_unload_idle().await;
        }
    }

    async fn maybe_spawn_refresh(&self, runtime: Arc<IndexRuntime>) {
        let current_cache_mtime = cache_mtime_or_epoch(&self.config.cache_file);
        *runtime.last_refresh_at.lock().await = current_cache_mtime;
        let bootstrap_refresh_pending = runtime.bootstrap_refresh_pending.load(Ordering::Acquire);
        let cache_age = SystemTime::now()
            .duration_since(current_cache_mtime)
            .unwrap_or_default();

        let refresh_due = bootstrap_refresh_pending || cache_age >= self.config.refresh_ttl;

        if !refresh_due {
            tracing::debug!(
                cache_file = %self.config.cache_file.display(),
                cache_age_secs = cache_age.as_secs(),
                refresh_ttl_secs = self.config.refresh_ttl.as_secs(),
                "index refresh skipped because cache is still fresh"
            );
            return;
        }

        if runtime
            .refreshing
            .compare_exchange(false, true, Ordering::AcqRel, Ordering::Acquire)
            .is_err()
        {
            tracing::debug!(
                "index refresh skipped because another refresh task is already running"
            );
            return;
        }

        if bootstrap_refresh_pending {
            tracing::info!(
                cache_file = %self.config.cache_file.display(),
                "background index refresh scheduled because bootstrap refresh is pending"
            );
        } else {
            tracing::info!(
                cache_file = %self.config.cache_file.display(),
                cache_age_secs = cache_age.as_secs(),
                refresh_ttl_secs = self.config.refresh_ttl.as_secs(),
                "background index refresh scheduled because cache ttl expired"
            );
        }

        let config = self.config.clone();
        let refresh_tx = self.refresh_tx.clone();
        tokio::spawn(async move {
            let _refresh_guard = RefreshGuard::new(runtime.clone());
            let refresh_result: anyhow::Result<()> = async {
                tracing::info!(
                    root_dir = %config.canonical_root_dir.display(),
                    "background index refresh started"
                );
                let old_paths = runtime.paths.read().await.clone();
                let config_for_scan = config.clone();
                let blocking_output = task::spawn_blocking(move || -> anyhow::Result<_> {
                    let new_paths = scan_root_files(&config_for_scan.canonical_root_dir)?;
                    let diff = diff_paths(&old_paths, &new_paths);
                    write_cache_snapshot(&config_for_scan.cache_file, &new_paths)?;
                    let refreshed_cache_mtime = cache_mtime(&config_for_scan.cache_file)?;

                    Ok(BlockingRefreshOutput {
                        new_paths,
                        diff,
                        refreshed_cache_mtime,
                    })
                })
                .await
                .map_err(anyhow::Error::from)??;
                tracing::info!(
                    new_path_count = blocking_output.new_paths.len(),
                    added = blocking_output.diff.added.len(),
                    removed = blocking_output.diff.removed.len(),
                    "background index refresh scan completed"
                );

                {
                    // 路径全集与 matcher 要一起推进，避免搜索看到半更新状态。
                    let mut engine = runtime.engine.lock().await;
                    engine.apply_diff(
                        &blocking_output.new_paths,
                        &blocking_output.diff.added,
                        &blocking_output.diff.removed,
                    );
                }

                {
                    let mut paths = runtime.paths.write().await;
                    *paths = blocking_output.new_paths;
                }

                *runtime.last_refresh_at.lock().await = blocking_output.refreshed_cache_mtime;
                let path_count = runtime.paths.read().await.len();
                tracing::info!(
                    cache_file = %config.cache_file.display(),
                    path_count,
                    "cache snapshot updated after refresh"
                );
                runtime
                    .bootstrap_refresh_pending
                    .store(false, Ordering::Release);
                let _ = refresh_tx.send("{\"type\":\"INDEX_REFRESHED\"}".to_string());
                tracing::info!("index refresh broadcast sent to websocket subscribers");
                Ok(())
            }
            .await;

            if let Err(error) = refresh_result {
                tracing::error!(?error, "background index refresh failed");
            }
        });
    }
}

impl IndexManager {
    async fn runtime_is_unloadable(&self, runtime: &Arc<IndexRuntime>) -> bool {
        let last_used_at = *runtime.last_used_at.lock().await;
        if last_used_at.elapsed() <= self.config.idle_ttl {
            return false;
        }

        !runtime.refreshing.load(Ordering::Acquire)
    }
}

struct BlockingRefreshOutput {
    new_paths: HashSet<String>,
    diff: crate::scanner::IndexDiff,
    refreshed_cache_mtime: SystemTime,
}

fn cache_mtime(cache_file: &std::path::Path) -> anyhow::Result<SystemTime> {
    Ok(std::fs::metadata(cache_file)?.modified()?)
}

fn cache_mtime_or_epoch(cache_file: &std::path::Path) -> SystemTime {
    cache_mtime(cache_file).unwrap_or(UNIX_EPOCH)
}
