# Fzfetch 后端核心实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 构建 Fzfetch 的 Rust 后端核心，实现懒加载内存索引、后台扫描刷新、WebSocket 搜索、请求纪元取消、安全下载与 `410 Gone` 惰性校验。

**Architecture:** 后端采用单进程、单根目录、按需装载的索引架构。`data/cache.txt` 作为冷启动缓存介质，用户首次使用时才载入内存；当缓存过期时，在后台执行全盘扫描并基于 `HashSet` 差异刷新索引；若检测到删除项，则由于 `nucleo 0.5.0` 公共 API 不提供单条删除，改为在保留 diff 结果的前提下调用 `restart(true)` 并按最新全集重建 matcher。

**Tech Stack:** Rust、axum、tokio、serde、serde_json、nucleo、walkdir、tokio-util、tracing、tempfile、tower

---

## 文件结构

### 后端文件

- Create: `Cargo.toml`
- Create: `src/lib.rs`
- Create: `src/main.rs`
- Create: `src/config.rs`
- Create: `src/error.rs`
- Create: `src/cache.rs`
- Create: `src/scanner.rs`
- Create: `src/search.rs`
- Create: `src/state.rs`
- Create: `src/ws.rs`
- Create: `src/api.rs`
- Create: `tests/cache_scanner.rs`
- Create: `tests/index_manager.rs`
- Create: `tests/download_api.rs`

### 前端协作目录建议

以下路径建议直接提供给前端 agent，后端本轮不实现这些文件，但接口边界会按这些路径组织：

- Reserve: `frontend/package.json`
- Reserve: `frontend/vite.config.ts`
- Reserve: `frontend/tsconfig.json`
- Reserve: `frontend/src/main.tsx`
- Reserve: `frontend/src/app/App.tsx`
- Reserve: `frontend/src/styles/tokens.css`
- Reserve: `frontend/src/styles/index.css`
- Reserve: `frontend/src/features/search/types.ts`
- Reserve: `frontend/src/features/search/useSearchSocket.ts`
- Reserve: `frontend/src/features/search/SearchInput.tsx`
- Reserve: `frontend/src/features/search/SearchResults.tsx`
- Reserve: `frontend/src/features/search/SearchPage.tsx`
- Reserve: `frontend/src/lib/ws/client.ts`
- Reserve: `frontend/src/lib/api/download.ts`

前端 agent 的接口契约应固定为：

- WebSocket 请求：`{"req_id":123,"query":"rust"}`
- WebSocket 响应：`{"req_id":123,"data":[{"path":"/a/b.txt","score":99}]}`
- WebSocket 广播：`{"type":"INDEX_REFRESHED"}`
- 下载接口：`GET /download?path=/absolute/path`
- 幽灵文件：HTTP `410 Gone`

---

### Task 1: 初始化工程与启动骨架

**Files:**
- Create: `Cargo.toml`
- Create: `src/lib.rs`
- Create: `src/config.rs`
- Create: `src/error.rs`
- Create: `src/cache.rs`
- Create: `src/main.rs`
- Test: `tests/cache_scanner.rs`

- [ ] **Step 1: 先写启动初始化失败测试**

```rust
// tests/cache_scanner.rs
use std::path::PathBuf;

use fzfetch::cache::ensure_cache_layout;

#[test]
fn ensure_cache_layout_creates_data_dir_and_cache_file() {
    let temp = tempfile::tempdir().unwrap();
    let data_dir = temp.path().join("data");
    let cache_file = data_dir.join("cache.txt");

    assert!(!data_dir.exists());
    assert!(!cache_file.exists());

    ensure_cache_layout(&data_dir, &cache_file).unwrap();

    assert!(data_dir.is_dir());
    assert!(cache_file.is_file());
}

#[test]
fn config_uses_expected_defaults() {
    let config = fzfetch::config::AppConfig::default_for(PathBuf::from("/tmp/root"));
    assert_eq!(config.data_dir, PathBuf::from("data"));
    assert_eq!(config.cache_file, PathBuf::from("data/cache.txt"));
    assert_eq!(config.top_k, 100);
}
```

- [ ] **Step 2: 运行测试，确认当前仓库还没有实现**

Run: `cargo test ensure_cache_layout_creates_data_dir_and_cache_file --test cache_scanner -- --exact`
Expected: FAIL with `could not find Cargo.toml` or unresolved crate/module errors

- [ ] **Step 3: 写最小可编译工程骨架**

```toml
# Cargo.toml
[package]
name = "fzfetch"
version = "0.1.0"
edition = "2024"

[dependencies]
anyhow = "1"
axum = { version = "0.8", features = ["ws", "macros"] }
futures = "0.3"
nucleo = "0.5.0"
serde = { version = "1", features = ["derive"] }
serde_json = "1"
thiserror = "2"
tokio = { version = "1", features = ["full"] }
tokio-util = { version = "0.7", features = ["io"] }
tracing = "0.1"
tracing-subscriber = { version = "0.3", features = ["env-filter"] }
walkdir = "2"

[dev-dependencies]
tempfile = "3"
tower = "0.5"
```

```rust
// src/lib.rs
pub mod cache;
pub mod config;
pub mod error;
```

```rust
// src/config.rs
use std::path::PathBuf;
use std::time::Duration;

#[derive(Debug, Clone)]
pub struct AppConfig {
    pub root_dir: PathBuf,
    pub canonical_root_dir: PathBuf,
    pub data_dir: PathBuf,
    pub cache_file: PathBuf,
    pub refresh_ttl: Duration,
    pub idle_ttl: Duration,
    pub cleanup_interval: Duration,
    pub top_k: usize,
}

impl AppConfig {
    pub fn default_for(root_dir: PathBuf) -> Self {
        let canonical_root_dir = root_dir.clone();
        Self {
            root_dir,
            canonical_root_dir,
            data_dir: PathBuf::from("data"),
            cache_file: PathBuf::from("data/cache.txt"),
            refresh_ttl: Duration::from_secs(24 * 60 * 60),
            idle_ttl: Duration::from_secs(30 * 60),
            cleanup_interval: Duration::from_secs(60),
            top_k: 100,
        }
    }
}
```

```rust
// src/error.rs
use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};

#[derive(Debug, thiserror::Error)]
pub enum AppError {
    #[error("invalid request: {0}")]
    BadRequest(String),
    #[error("forbidden")]
    Forbidden,
    #[error("not found")]
    NotFound,
    #[error("gone")]
    Gone,
    #[error("internal error: {0}")]
    Internal(String),
}

impl IntoResponse for AppError {
    fn into_response(self) -> Response {
        let status = match self {
            Self::BadRequest(_) => StatusCode::BAD_REQUEST,
            Self::Forbidden => StatusCode::FORBIDDEN,
            Self::NotFound => StatusCode::NOT_FOUND,
            Self::Gone => StatusCode::GONE,
            Self::Internal(_) => StatusCode::INTERNAL_SERVER_ERROR,
        };
        (status, self.to_string()).into_response()
    }
}
```

```rust
// src/cache.rs
use std::fs;
use std::path::Path;

pub fn ensure_cache_layout(data_dir: &Path, cache_file: &Path) -> anyhow::Result<()> {
    fs::create_dir_all(data_dir)?;
    if !cache_file.exists() {
        fs::File::create(cache_file)?;
    }
    Ok(())
}
```

```rust
// src/main.rs
use tracing_subscriber::EnvFilter;

use fzfetch::cache::ensure_cache_layout;
use fzfetch::config::AppConfig;

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    tracing_subscriber::fmt()
        .with_env_filter(EnvFilter::from_default_env())
        .init();

    let root_dir = std::env::var("FZFETCH_ROOT").unwrap_or_else(|_| ".".to_string());
    let mut config = AppConfig::default_for(root_dir.into());
    config.canonical_root_dir = std::fs::canonicalize(&config.root_dir)?;

    ensure_cache_layout(&config.data_dir, &config.cache_file)?;
    Ok(())
}
```

- [ ] **Step 4: 跑初始化测试确认通过**

Run: `cargo test config_uses_expected_defaults --test cache_scanner -- --exact`
Expected: PASS

- [ ] **Step 5: 提交初始化骨架**

```bash
git add Cargo.toml src/lib.rs src/config.rs src/error.rs src/cache.rs src/main.rs tests/cache_scanner.rs
git commit -m "feat: bootstrap backend crate"
```

### Task 2: 实现缓存文件与扫描差异逻辑

**Files:**
- Modify: `src/lib.rs`
- Modify: `src/cache.rs`
- Create: `src/scanner.rs`
- Modify: `tests/cache_scanner.rs`

- [ ] **Step 1: 先补缓存读写与 diff 的失败测试**

```rust
// tests/cache_scanner.rs
use std::collections::HashSet;
use std::fs;

use fzfetch::cache::{ensure_cache_layout, load_cache_paths, write_cache_snapshot};
use fzfetch::scanner::{diff_paths, scan_root_files};

#[test]
fn load_cache_paths_ignores_empty_lines() {
    let temp = tempfile::tempdir().unwrap();
    let data_dir = temp.path().join("data");
    let cache_file = data_dir.join("cache.txt");
    ensure_cache_layout(&data_dir, &cache_file).unwrap();

    fs::write(&cache_file, "/tmp/a\n\n/tmp/b\n").unwrap();

    let paths = load_cache_paths(&cache_file).unwrap();
    assert_eq!(paths.len(), 2);
    assert!(paths.contains("/tmp/a"));
    assert!(paths.contains("/tmp/b"));
}

#[test]
fn write_cache_snapshot_overwrites_previous_content() {
    let temp = tempfile::tempdir().unwrap();
    let data_dir = temp.path().join("data");
    let cache_file = data_dir.join("cache.txt");
    ensure_cache_layout(&data_dir, &cache_file).unwrap();

    let paths = HashSet::from([
        "/tmp/a".to_string(),
        "/tmp/b".to_string(),
    ]);
    write_cache_snapshot(&cache_file, &paths).unwrap();

    let content = fs::read_to_string(&cache_file).unwrap();
    assert!(content.contains("/tmp/a"));
    assert!(content.contains("/tmp/b"));
}

#[test]
fn diff_paths_reports_added_and_removed() {
    let old_paths = HashSet::from([
        "/tmp/a".to_string(),
        "/tmp/b".to_string(),
    ]);
    let new_paths = HashSet::from([
        "/tmp/b".to_string(),
        "/tmp/c".to_string(),
    ]);

    let diff = diff_paths(&old_paths, &new_paths);
    assert_eq!(diff.added, vec!["/tmp/c".to_string()]);
    assert_eq!(diff.removed, vec!["/tmp/a".to_string()]);
}

#[test]
fn scan_root_files_only_collects_regular_files() {
    let temp = tempfile::tempdir().unwrap();
    let root = temp.path();
    fs::create_dir_all(root.join("nested")).unwrap();
    fs::write(root.join("nested").join("file.txt"), "ok").unwrap();

    let paths = scan_root_files(root).unwrap();
    assert_eq!(paths.len(), 1);
    assert!(paths.iter().next().unwrap().ends_with("nested/file.txt"));
}
```

- [ ] **Step 2: 运行扫描测试确认失败**

Run: `cargo test diff_paths_reports_added_and_removed --test cache_scanner -- --exact`
Expected: FAIL with unresolved imports for `load_cache_paths`, `write_cache_snapshot`, `diff_paths`, or `scan_root_files`

- [ ] **Step 3: 实现缓存模块与扫描模块**

```rust
// src/lib.rs
pub mod cache;
pub mod config;
pub mod error;
pub mod scanner;
```

```rust
// src/cache.rs
use std::collections::HashSet;
use std::fs;
use std::io::Write;
use std::path::Path;

pub fn ensure_cache_layout(data_dir: &Path, cache_file: &Path) -> anyhow::Result<()> {
    fs::create_dir_all(data_dir)?;
    if !cache_file.exists() {
        fs::File::create(cache_file)?;
    }
    Ok(())
}

pub fn load_cache_paths(cache_file: &Path) -> anyhow::Result<HashSet<String>> {
    let content = fs::read_to_string(cache_file).unwrap_or_default();
    let paths = content
        .lines()
        .map(str::trim)
        .filter(|line| !line.is_empty())
        .map(ToOwned::to_owned)
        .collect();
    Ok(paths)
}

pub fn write_cache_snapshot(cache_file: &Path, paths: &HashSet<String>) -> anyhow::Result<()> {
    let mut sorted_paths = paths.iter().cloned().collect::<Vec<_>>();
    sorted_paths.sort();

    let tmp_file = cache_file.with_extension("txt.tmp");
    let mut file = fs::File::create(&tmp_file)?;
    for path in sorted_paths {
        writeln!(file, "{path}")?;
    }
    file.sync_all()?;
    fs::rename(tmp_file, cache_file)?;
    Ok(())
}
```

```rust
// src/scanner.rs
use std::collections::HashSet;
use std::path::Path;

use walkdir::WalkDir;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct IndexDiff {
    pub added: Vec<String>,
    pub removed: Vec<String>,
}

pub fn scan_root_files(root_dir: &Path) -> anyhow::Result<HashSet<String>> {
    let mut paths = HashSet::new();
    for entry in WalkDir::new(root_dir).follow_links(false) {
        let entry = entry?;
        if entry.file_type().is_file() {
            let canonical = entry.path().canonicalize()?;
            paths.insert(canonical.to_string_lossy().into_owned());
        }
    }
    Ok(paths)
}

pub fn diff_paths(old_paths: &HashSet<String>, new_paths: &HashSet<String>) -> IndexDiff {
    let mut added = new_paths
        .difference(old_paths)
        .cloned()
        .collect::<Vec<_>>();
    let mut removed = old_paths
        .difference(new_paths)
        .cloned()
        .collect::<Vec<_>>();
    added.sort();
    removed.sort();
    IndexDiff { added, removed }
}
```

- [ ] **Step 4: 运行缓存与扫描测试确认通过**

Run: `cargo test --test cache_scanner`
Expected: PASS with all cache/scanner tests green

- [ ] **Step 5: 提交缓存与扫描能力**

```bash
git add src/cache.rs src/scanner.rs src/lib.rs tests/cache_scanner.rs
git commit -m "feat: add cache and scanner primitives"
```

### Task 3: 实现搜索引擎封装与索引生命周期管理

**Files:**
- Create: `src/search.rs`
- Create: `src/state.rs`
- Modify: `src/lib.rs`
- Create: `tests/index_manager.rs`

- [ ] **Step 1: 先写懒加载、刷新调度和空闲回收的失败测试**

```rust
// tests/index_manager.rs
use std::fs;
use std::path::PathBuf;
use std::sync::Arc;
use std::time::{Duration, SystemTime};

use fzfetch::cache::ensure_cache_layout;
use fzfetch::config::AppConfig;
use fzfetch::state::AppState;

fn build_config(root_dir: PathBuf) -> AppConfig {
    let mut config = AppConfig::default_for(root_dir.clone());
    config.canonical_root_dir = root_dir;
    config.refresh_ttl = Duration::from_secs(0);
    config.idle_ttl = Duration::from_secs(1);
    config.cleanup_interval = Duration::from_millis(50);
    config
}

#[tokio::test]
async fn ensure_loaded_builds_runtime_from_cache() {
    let temp = tempfile::tempdir().unwrap();
    let root = temp.path().join("root");
    fs::create_dir_all(&root).unwrap();
    let data_dir = temp.path().join("data");
    let cache_file = data_dir.join("cache.txt");
    ensure_cache_layout(&data_dir, &cache_file).unwrap();
    fs::write(&cache_file, format!("{}\n", root.join("a.txt").display())).unwrap();

    let mut config = build_config(root.clone());
    config.data_dir = data_dir;
    config.cache_file = cache_file;
    let state = Arc::new(AppState::new(config));

    let runtime = state.index_manager.ensure_loaded().await.unwrap();
    let paths = runtime.paths.read().await;
    assert_eq!(paths.len(), 1);
}

#[tokio::test]
async fn maybe_unload_removes_idle_runtime() {
    let temp = tempfile::tempdir().unwrap();
    let root = temp.path().join("root");
    fs::create_dir_all(&root).unwrap();
    let data_dir = temp.path().join("data");
    let cache_file = data_dir.join("cache.txt");
    ensure_cache_layout(&data_dir, &cache_file).unwrap();

    let mut config = build_config(root.clone());
    config.data_dir = data_dir;
    config.cache_file = cache_file;
    let state = Arc::new(AppState::new(config));

    state.index_manager.ensure_loaded().await.unwrap();
    tokio::time::sleep(Duration::from_secs(2)).await;
    state.index_manager.maybe_unload_idle().await;

    assert!(state.index_manager.runtime.read().await.is_none());
}

#[tokio::test]
async fn refresh_due_uses_cache_mtime() {
    let temp = tempfile::tempdir().unwrap();
    let root = temp.path().join("root");
    fs::create_dir_all(&root).unwrap();
    let data_dir = temp.path().join("data");
    let cache_file = data_dir.join("cache.txt");
    ensure_cache_layout(&data_dir, &cache_file).unwrap();

    let mut config = build_config(root.clone());
    config.data_dir = data_dir;
    config.cache_file = cache_file;
    let state = Arc::new(AppState::new(config));

    let runtime = state.index_manager.ensure_loaded().await.unwrap();
    let last_refresh = *runtime.last_refresh_at.lock().await;
    assert!(last_refresh <= SystemTime::now());
}
```

- [ ] **Step 2: 运行生命周期测试确认失败**

Run: `cargo test ensure_loaded_builds_runtime_from_cache --test index_manager -- --exact`
Expected: FAIL with unresolved imports for `AppState`, `ensure_loaded`, or runtime fields

- [ ] **Step 3: 实现搜索引擎包装与索引管理器**

```rust
// src/search.rs
use std::collections::HashSet;
use std::sync::Arc;
use std::time::Duration;

use nucleo::pattern::{CaseMatching, Normalization};
use nucleo::{Config, Matcher, Nucleo, Utf32String};

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SearchHit {
    pub path: String,
    pub score: u32,
}

pub struct SearchEngine {
    nucleo: Nucleo<String>,
}

impl SearchEngine {
    pub fn new() -> Self {
        let notify = Arc::new(|| ());
        let nucleo = Nucleo::new(Config::DEFAULT, notify, Some(1), 1);
        Self { nucleo }
    }

    pub fn seed(&mut self, paths: impl IntoIterator<Item = String>) {
        let injector = self.nucleo.injector();
        for path in paths {
            injector.push(path, |value, columns| {
                columns[0] = Utf32String::from(value.as_str());
            });
        }
        self.drain();
    }

    pub fn apply_diff(&mut self, new_paths: &HashSet<String>, added: &[String], removed: &[String]) {
        if removed.is_empty() {
            let injector = self.nucleo.injector();
            for path in added {
                injector.push(path.clone(), |value, columns| {
                    columns[0] = Utf32String::from(value.as_str());
                });
            }
            self.drain();
            return;
        }

        self.nucleo.restart(true);
        let injector = self.nucleo.injector();
        for path in new_paths {
            injector.push(path.clone(), |value, columns| {
                columns[0] = Utf32String::from(value.as_str());
            });
        }
        self.drain();
    }

    pub fn search(&mut self, query: &str, top_k: usize) -> Vec<SearchHit> {
        self.nucleo
            .pattern
            .reparse(0, query, CaseMatching::Smart, Normalization::Smart, false);
        self.drain();

        let snapshot = self.nucleo.snapshot();
        let mut matcher = Matcher::new(Config::DEFAULT);

        snapshot
            .matched_items(..)
            .take(top_k)
            .map(|item| SearchHit {
                path: item.data.clone(),
                score: snapshot
                    .pattern()
                    .score(item.matcher_columns, &mut matcher)
                    .unwrap_or_default(),
            })
            .collect()
    }

    fn drain(&mut self) {
        loop {
            let status = self.nucleo.tick(Duration::from_millis(10).as_millis() as u64);
            if !status.running {
                break;
            }
        }
    }
}
```

```rust
// src/lib.rs
pub mod cache;
pub mod config;
pub mod error;
pub mod scanner;
pub mod search;
pub mod state;
```

```rust
// src/state.rs
use std::collections::HashSet;
use std::sync::Arc;
use std::time::{Instant, SystemTime, UNIX_EPOCH};

use tokio::sync::{broadcast, Mutex, RwLock};
use tokio::time::sleep;

use crate::cache::{ensure_cache_layout, load_cache_paths, write_cache_snapshot};
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
    pub refreshing: std::sync::atomic::AtomicBool,
}

pub struct IndexManager {
    pub config: Arc<AppConfig>,
    pub runtime: RwLock<Option<Arc<IndexRuntime>>>,
    refresh_tx: broadcast::Sender<String>,
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

        let mut guard = self.runtime.write().await;
        if let Some(runtime) = guard.clone() {
            return Ok(runtime);
        }

        ensure_cache_layout(&self.config.data_dir, &self.config.cache_file)?;
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
            refreshing: std::sync::atomic::AtomicBool::new(false),
        });

        *guard = Some(runtime.clone());
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
        if last_used_at.elapsed() <= self.config.idle_ttl {
            return;
        }

        if runtime
            .refreshing
            .load(std::sync::atomic::Ordering::SeqCst)
        {
            return;
        }

        *self.runtime.write().await = None;
    }

    pub async fn run_cleanup_loop(self: Arc<Self>) {
        loop {
            sleep(self.config.cleanup_interval).await;
            self.maybe_unload_idle().await;
        }
    }

    async fn maybe_spawn_refresh(&self, runtime: Arc<IndexRuntime>) {
        let last_refresh_at = *runtime.last_refresh_at.lock().await;
        let overdue = SystemTime::now()
            .duration_since(last_refresh_at)
            .unwrap_or_default()
            >= self.config.refresh_ttl;

        if !overdue {
            return;
        }

        if runtime
            .refreshing
            .compare_exchange(
                false,
                true,
                std::sync::atomic::Ordering::SeqCst,
                std::sync::atomic::Ordering::SeqCst,
            )
            .is_err()
        {
            return;
        }

        let config = self.config.clone();
        let refresh_tx = self.refresh_tx.clone();
        tokio::spawn(async move {
            let result = async {
                let new_paths = scan_root_files(&config.canonical_root_dir)?;
                let old_paths = runtime.paths.read().await.clone();
                let diff = diff_paths(&old_paths, &new_paths);

                {
                    let mut engine = runtime.engine.lock().await;
                    engine.apply_diff(&new_paths, &diff.added, &diff.removed);
                }

                {
                    let mut guard = runtime.paths.write().await;
                    *guard = new_paths.clone();
                }

                write_cache_snapshot(&config.cache_file, &new_paths)?;
                *runtime.last_refresh_at.lock().await = SystemTime::now();
                let _ = refresh_tx.send("{\"type\":\"INDEX_REFRESHED\"}".to_string());
                anyhow::Ok(())
            }
            .await;

            if let Err(error) = result {
                tracing::error!(?error, "background refresh failed");
            }

            runtime
                .refreshing
                .store(false, std::sync::atomic::Ordering::SeqCst);
        });
    }
}
```

- [ ] **Step 4: 运行索引生命周期测试确认通过**

Run: `cargo test --test index_manager`
Expected: PASS with lazy load and idle eviction tests green

- [ ] **Step 5: 提交搜索与状态管理**

```bash
git add src/search.rs src/state.rs src/lib.rs tests/index_manager.rs
git commit -m "feat: add lazy index lifecycle and search engine"
```

### Task 4: 实现 WebSocket 搜索与请求纪元取消

**Files:**
- Create: `src/ws.rs`
- Modify: `src/main.rs`
- Modify: `src/lib.rs`

- [ ] **Step 1: 先写请求纪元取消的单元测试**

```rust
// 在 src/ws.rs 内联测试
#[cfg(test)]
mod tests {
    use std::sync::atomic::{AtomicU64, Ordering};

    #[test]
    fn stale_epoch_is_dropped() {
        let latest = AtomicU64::new(1);
        latest.store(2, Ordering::SeqCst);
        assert!(super::should_drop_response(&latest, 1));
        assert!(!super::should_drop_response(&latest, 2));
    }
}
```

- [ ] **Step 2: 运行纪元测试确认失败**

Run: `cargo test stale_epoch_is_dropped --lib -- --exact`
Expected: FAIL with missing `ws` module or missing `should_drop_response`

- [ ] **Step 3: 实现 WebSocket 处理器**

```rust
// src/ws.rs
use std::sync::Arc;
use std::sync::atomic::{AtomicU64, Ordering};

use axum::extract::ws::{Message, WebSocket, WebSocketUpgrade};
use axum::extract::State;
use axum::response::Response;
use futures::{SinkExt, StreamExt};
use serde::{Deserialize, Serialize};

use crate::state::AppState;

#[derive(Debug, Deserialize)]
pub struct SearchRequest {
    pub req_id: u64,
    pub query: String,
}

#[derive(Debug, Serialize)]
pub struct SearchResponseItem {
    pub path: String,
    pub score: u32,
}

#[derive(Debug, Serialize)]
pub struct SearchResponse {
    pub req_id: u64,
    pub data: Vec<SearchResponseItem>,
}

pub async fn ws_handler(
    ws: WebSocketUpgrade,
    State(state): State<Arc<AppState>>,
) -> Response {
    ws.on_upgrade(move |socket| handle_socket(state, socket))
}

async fn handle_socket(state: Arc<AppState>, socket: WebSocket) {
    let (mut sender, mut receiver) = socket.split();
    let latest_req_id = Arc::new(AtomicU64::new(0));
    let mut refresh_rx = state.refresh_tx.subscribe();
    loop {
        tokio::select! {
            Some(Ok(message)) = receiver.next() => {
                let Message::Text(text) = message else {
                    continue;
                };

                let Ok(request) = serde_json::from_str::<SearchRequest>(&text) else {
                    continue;
                };

                latest_req_id.store(request.req_id, Ordering::SeqCst);

                let hits = match state.index_manager.search(&request.query).await {
                    Ok(hits) => hits,
                    Err(error) => {
                        tracing::error!(?error, "search failed");
                        continue;
                    }
                };

                if should_drop_response(&latest_req_id, request.req_id) {
                    continue;
                }

                let payload = SearchResponse {
                    req_id: request.req_id,
                    data: hits
                        .into_iter()
                        .map(|hit| SearchResponseItem {
                            path: hit.path,
                            score: hit.score,
                        })
                        .collect(),
                };

                let Ok(json) = serde_json::to_string(&payload) else {
                    continue;
                };

                if sender.send(Message::Text(json.into())).await.is_err() {
                    break;
                }
            }
            Ok(payload) = refresh_rx.recv() => {
                if sender.send(Message::Text(payload.into())).await.is_err() {
                    break;
                }
            }
            else => break,
        }
    }
}

pub fn should_drop_response(latest_req_id: &AtomicU64, current_req_id: u64) -> bool {
    latest_req_id.load(Ordering::SeqCst) != current_req_id
}
```

```rust
// src/lib.rs
pub mod cache;
pub mod config;
pub mod error;
pub mod scanner;
pub mod search;
pub mod state;
pub mod ws;
```

```rust
// src/main.rs
use std::net::SocketAddr;
use std::sync::Arc;

use axum::routing::get;
use axum::Router;
use tracing_subscriber::EnvFilter;

use fzfetch::cache::ensure_cache_layout;
use fzfetch::config::AppConfig;
use fzfetch::state::AppState;

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    tracing_subscriber::fmt()
        .with_env_filter(EnvFilter::from_default_env())
        .init();

    let root_dir = std::env::var("FZFETCH_ROOT").unwrap_or_else(|_| ".".to_string());
    let mut config = AppConfig::default_for(root_dir.into());
    config.canonical_root_dir = std::fs::canonicalize(&config.root_dir)?;
    ensure_cache_layout(&config.data_dir, &config.cache_file)?;

    let app_state = Arc::new(AppState::new(config));
    let cleanup_state = app_state.index_manager.clone();
    tokio::spawn(async move {
        cleanup_state.run_cleanup_loop().await;
    });

    let app = Router::new()
        .route("/ws", get(fzfetch::ws::ws_handler))
        .with_state(app_state);

    let addr = SocketAddr::from(([127, 0, 0, 1], 3000));
    let listener = tokio::net::TcpListener::bind(addr).await?;
    axum::serve(listener, app).await?;
    Ok(())
}
```

- [ ] **Step 4: 运行 WebSocket 纪元测试确认通过**

Run: `cargo test stale_epoch_is_dropped --lib -- --exact`
Expected: PASS

- [ ] **Step 5: 提交 WebSocket 搜索接口**

```bash
git add src/ws.rs src/main.rs src/lib.rs
git commit -m "feat: add websocket search with epoch cancellation"
```

### Task 5: 实现下载接口与 410 Gone 惰性校验

**Files:**
- Create: `src/api.rs`
- Modify: `src/main.rs`
- Modify: `src/lib.rs`
- Create: `tests/download_api.rs`

- [ ] **Step 1: 先写下载沙箱与幽灵文件失败测试**

```rust
// tests/download_api.rs
use std::fs;
use std::sync::Arc;

use axum::body::Body;
use axum::http::{Request, StatusCode};
use axum::routing::get;
use axum::Router;
use tower::util::ServiceExt;

use fzfetch::cache::ensure_cache_layout;
use fzfetch::config::AppConfig;
use fzfetch::state::AppState;

fn build_state(root_dir: std::path::PathBuf, data_dir: std::path::PathBuf) -> Arc<AppState> {
    let mut config = AppConfig::default_for(root_dir.clone());
    config.canonical_root_dir = root_dir;
    config.data_dir = data_dir.clone();
    config.cache_file = data_dir.join("cache.txt");
    Arc::new(AppState::new(config))
}

#[tokio::test]
async fn download_rejects_path_outside_root() {
    let temp = tempfile::tempdir().unwrap();
    let root = temp.path().join("root");
    let data_dir = temp.path().join("data");
    fs::create_dir_all(&root).unwrap();
    ensure_cache_layout(&data_dir, &data_dir.join("cache.txt")).unwrap();
    let state = build_state(root, data_dir);

    let app = Router::new()
        .route("/download", get(fzfetch::api::download_handler))
        .with_state(state);

    let response = app
        .oneshot(
            Request::builder()
                .uri("/download?path=/etc/passwd")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::FORBIDDEN);
}

#[tokio::test]
async fn download_returns_410_for_ghost_file() {
    let temp = tempfile::tempdir().unwrap();
    let root = temp.path().join("root");
    let data_dir = temp.path().join("data");
    fs::create_dir_all(&root).unwrap();
    ensure_cache_layout(&data_dir, &data_dir.join("cache.txt")).unwrap();

    let file = root.join("ghost.txt");
    fs::write(&file, "gone").unwrap();
    let requested = file.to_string_lossy().into_owned();
    fs::remove_file(&file).unwrap();

    let state = build_state(root, data_dir);
    let app = Router::new()
        .route("/download", get(fzfetch::api::download_handler))
        .with_state(state);

    let response = app
        .oneshot(
            Request::builder()
                .uri(format!("/download?path={requested}"))
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::GONE);
}
```

- [ ] **Step 2: 运行下载测试确认失败**

Run: `cargo test download_returns_410_for_ghost_file --test download_api -- --exact`
Expected: FAIL with missing `download_handler`

- [ ] **Step 3: 实现安全下载接口**

```rust
// src/api.rs
use std::path::{Path, PathBuf};
use std::sync::Arc;

use axum::body::Body;
use axum::extract::{Query, State};
use axum::http::header::{CONTENT_DISPOSITION, CONTENT_TYPE};
use axum::http::{HeaderValue, StatusCode};
use axum::response::{IntoResponse, Response};
use serde::Deserialize;
use tokio::fs::File;
use tokio_util::io::ReaderStream;

use crate::error::AppError;
use crate::state::AppState;

#[derive(Debug, Deserialize)]
pub struct DownloadQuery {
    pub path: String,
}

pub async fn download_handler(
    State(state): State<Arc<AppState>>,
    Query(query): Query<DownloadQuery>,
) -> Result<Response, AppError> {
    let requested = PathBuf::from(&query.path);
    let canonical_root = &state.config.canonical_root_dir;

    if !requested.exists() {
        return Err(AppError::Gone);
    }

    let canonical_path = requested
        .canonicalize()
        .map_err(|_| AppError::BadRequest("invalid path".to_string()))?;

    if !canonical_path.starts_with(canonical_root) {
        return Err(AppError::Forbidden);
    }

    if !canonical_path.is_file() {
        return Err(AppError::NotFound);
    }

    if !Path::new(&canonical_path).exists() {
        return Err(AppError::Gone);
    }

    let file = File::open(&canonical_path)
        .await
        .map_err(|_| AppError::Gone)?;
    let stream = ReaderStream::new(file);
    let filename = canonical_path
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or("download.bin");

    let mut response = Body::from_stream(stream).into_response();
    response.headers_mut().insert(
        CONTENT_TYPE,
        HeaderValue::from_static("application/octet-stream"),
    );
    response.headers_mut().insert(
        CONTENT_DISPOSITION,
        HeaderValue::from_str(&format!("attachment; filename=\"{filename}\""))
            .unwrap_or(HeaderValue::from_static("attachment")),
    );
    *response.status_mut() = StatusCode::OK;
    Ok(response)
}
```

```rust
// src/lib.rs
pub mod api;
pub mod cache;
pub mod config;
pub mod error;
pub mod scanner;
pub mod search;
pub mod state;
pub mod ws;
```

```rust
// src/main.rs
use std::net::SocketAddr;
use std::sync::Arc;

use axum::routing::get;
use axum::Router;
use tracing_subscriber::EnvFilter;

use fzfetch::cache::ensure_cache_layout;
use fzfetch::config::AppConfig;
use fzfetch::state::AppState;

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    tracing_subscriber::fmt()
        .with_env_filter(EnvFilter::from_default_env())
        .init();

    let root_dir = std::env::var("FZFETCH_ROOT").unwrap_or_else(|_| ".".to_string());
    let mut config = AppConfig::default_for(root_dir.into());
    config.canonical_root_dir = std::fs::canonicalize(&config.root_dir)?;
    ensure_cache_layout(&config.data_dir, &config.cache_file)?;

    let app_state = Arc::new(AppState::new(config));
    let cleanup_state = app_state.index_manager.clone();
    tokio::spawn(async move {
        cleanup_state.run_cleanup_loop().await;
    });

    let app = Router::new()
        .route("/ws", get(fzfetch::ws::ws_handler))
        .route("/download", get(fzfetch::api::download_handler))
        .with_state(app_state);

    let addr = SocketAddr::from(([127, 0, 0, 1], 3000));
    let listener = tokio::net::TcpListener::bind(addr).await?;
    axum::serve(listener, app).await?;
    Ok(())
}
```

- [ ] **Step 4: 运行下载测试确认通过**

Run: `cargo test --test download_api`
Expected: PASS with forbidden and gone scenarios green

- [ ] **Step 5: 提交下载接口**

```bash
git add src/api.rs src/main.rs src/lib.rs tests/download_api.rs
git commit -m "feat: add secure download endpoint"
```

### Task 6: 全量整理与冒烟验证

**Files:**
- Modify: `src/main.rs`
- Modify: `src/state.rs`
- Modify: `src/ws.rs`
- Modify: `src/api.rs`
- Modify: `tests/cache_scanner.rs`
- Modify: `tests/index_manager.rs`
- Modify: `tests/download_api.rs`

- [ ] **Step 1: 补充中文注释与对外协议结构体注释**

```rust
// 需要在以下文件中补足中文注释：
// src/main.rs
// src/state.rs
// src/search.rs
// src/ws.rs
// src/api.rs
//
// 注释重点：
// 1. 为什么 cache 只在首次使用时装载
// 2. 为什么过期刷新是后台异步
// 3. 为什么 req_id 必须按 WebSocket 连接隔离
// 4. 为什么删除项需要 restart(true) 全量重建 nucleo
// 5. 为什么下载时返回 410 Gone
```

- [ ] **Step 2: 运行全部测试与格式检查**

Run: `cargo fmt --check && cargo test`
Expected: PASS with formatter clean and all test suites green

- [ ] **Step 3: 本地手工冒烟启动服务**

Run: `FZFETCH_ROOT=. cargo run`
Expected: server starts on `127.0.0.1:3000` and creates `data/cache.txt` if missing

- [ ] **Step 4: 手工验证最小请求链路**

Run: `python -m websockets ws://127.0.0.1:3000/ws`
Expected: able to send `{"req_id":1,"query":"Cargo"}` and receive JSON search results or empty data list

- [ ] **Step 5: 提交收尾整理**

```bash
git add src/main.rs src/state.rs src/ws.rs src/api.rs src/search.rs tests
git commit -m "chore: verify backend core flow"
```

## 自检结论

### Spec 覆盖

- 懒加载 `cache.txt`：由 Task 3 覆盖
- 启动创建 `data/cache.txt`：由 Task 1 和 Task 2 覆盖
- `HashSet` 差异比对：由 Task 2 覆盖
- 后台刷新与广播：由 Task 3 和 Task 4 覆盖
- WebSocket 请求纪元取消：由 Task 4 覆盖
- 下载接口沙箱与 `410 Gone`：由 Task 5 覆盖
- 空闲 30 分钟卸载：由 Task 3 覆盖
- 前端协作路径：由本文“前端协作目录建议”覆盖

### 已修正的实现约束

- `nucleo 0.5.0` 提供 `Injector::push` 与 `Nucleo::restart(true)`，但未提供对单条 item 的公共删除接口。
- 因此实现策略必须是：
  - 仅新增时：直接用 `Injector::push` 增量注入
  - 存在删除时：先算出 `HashSet` diff，再调用 `restart(true)`，随后按 `new_paths` 全量重建 matcher
- 该策略不改变最终行为约束，只修正到与实际 crate API 一致的实现方式。

### 类型一致性

- 搜索结果统一使用 `SearchHit { path: String, score: u32 }`
- WebSocket 请求统一使用 `SearchRequest { req_id: u64, query: String }`
- WebSocket 响应统一使用 `SearchResponse { req_id: u64, data: Vec<SearchResponseItem> }`
- 下载查询统一使用 `DownloadQuery { path: String }`
