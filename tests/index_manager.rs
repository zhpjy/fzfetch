use std::collections::HashSet;
use std::fs;
use std::path::{Path, PathBuf};
use std::time::{Duration, Instant, UNIX_EPOCH};

use fzfetch::cache::{ensure_cache_layout, write_cache_snapshot};
use fzfetch::config::AppConfig;
use fzfetch::state::AppState;

fn build_config(root_dir: &Path, data_dir: PathBuf, cache_file: PathBuf) -> AppConfig {
    let mut config = AppConfig::default_for(root_dir.to_path_buf());
    config.canonical_root_dir = root_dir.canonicalize().unwrap();
    config.data_dir = data_dir;
    config.cache_file = cache_file;
    config.refresh_ttl = Duration::from_millis(1);
    config.idle_ttl = Duration::from_secs(1);
    config.cleanup_interval = Duration::from_millis(50);
    config.top_k = 10;
    config.force_initial_refresh = false;
    config
}

#[tokio::test]
async fn ensure_loaded_builds_runtime_from_cache() {
    let temp = tempfile::tempdir().unwrap();
    let root = temp.path().join("root");
    fs::create_dir_all(&root).unwrap();

    let alpha = root
        .join("alpha.txt")
        .canonicalize()
        .unwrap_or_else(|_| root.join("alpha.txt"));
    let beta = root
        .join("beta.txt")
        .canonicalize()
        .unwrap_or_else(|_| root.join("beta.txt"));

    let data_dir = temp.path().join("data");
    let cache_file = data_dir.join("cache.txt");
    ensure_cache_layout(&data_dir, &cache_file).unwrap();
    write_cache_snapshot(
        &cache_file,
        &HashSet::from([
            alpha.to_string_lossy().to_string(),
            beta.to_string_lossy().to_string(),
        ]),
    )
    .unwrap();

    let state = AppState::new(build_config(&root, data_dir, cache_file));

    let runtime = state.index_manager.ensure_loaded().await.unwrap();
    let paths = runtime.paths.read().await.clone();

    assert_eq!(paths.len(), 2);
    assert!(paths.contains(&alpha.to_string_lossy().to_string()));
    assert!(paths.contains(&beta.to_string_lossy().to_string()));
    assert!(state.index_manager.runtime.read().await.is_some());
}

#[tokio::test]
async fn maybe_unload_removes_idle_runtime() {
    let temp = tempfile::tempdir().unwrap();
    let root = temp.path().join("root");
    fs::create_dir_all(&root).unwrap();

    let data_dir = temp.path().join("data");
    let cache_file = data_dir.join("cache.txt");
    ensure_cache_layout(&data_dir, &cache_file).unwrap();

    let state = AppState::new(build_config(&root, data_dir, cache_file));

    let runtime = state.index_manager.ensure_loaded().await.unwrap();
    *runtime.last_used_at.lock().await = Instant::now() - Duration::from_secs(5);

    state.index_manager.maybe_unload_idle().await;

    assert!(state.index_manager.runtime.read().await.is_none());
}

#[tokio::test]
async fn refresh_due_uses_cache_mtime() {
    let temp = tempfile::tempdir().unwrap();
    let root = temp.path().join("root");
    fs::create_dir_all(&root).unwrap();
    let unseen = root.join("fresh-document.txt");
    fs::write(&unseen, "fresh").unwrap();
    let unseen = unseen.canonicalize().unwrap();

    let data_dir = temp.path().join("data");
    let cache_file = data_dir.join("cache.txt");
    ensure_cache_layout(&data_dir, &cache_file).unwrap();
    write_cache_snapshot(&cache_file, &HashSet::new()).unwrap();

    let mut config = build_config(&root, data_dir, cache_file);
    config.refresh_ttl = Duration::from_secs(60);
    let state = AppState::new(config);
    let runtime = state.index_manager.ensure_loaded().await.unwrap();
    *runtime.last_refresh_at.lock().await = UNIX_EPOCH;
    let mut refresh_rx = state.refresh_tx.subscribe();

    let hits = state.index_manager.search("fresh").await.unwrap();
    assert!(hits.is_empty());

    let refresh_result = tokio::time::timeout(Duration::from_millis(200), refresh_rx.recv()).await;
    assert!(
        refresh_result.is_err(),
        "refresh should not run while cache mtime is fresh"
    );
    assert!(
        !runtime
            .paths
            .read()
            .await
            .contains(&unseen.to_string_lossy().to_string())
    );
}

#[tokio::test]
async fn refresh_success_updates_last_refresh_at_from_cache_mtime() {
    let temp = tempfile::tempdir().unwrap();
    let root = temp.path().join("root");
    fs::create_dir_all(&root).unwrap();
    let fresh = root.join("fresh-document.txt");
    fs::write(&fresh, "fresh").unwrap();
    let fresh = fresh.canonicalize().unwrap();

    let data_dir = temp.path().join("data");
    let cache_file = data_dir.join("cache.txt");
    ensure_cache_layout(&data_dir, &cache_file).unwrap();
    write_cache_snapshot(&cache_file, &HashSet::new()).unwrap();
    tokio::time::sleep(Duration::from_millis(25)).await;

    let state = AppState::new(build_config(&root, data_dir, cache_file.clone()));
    let runtime = state.index_manager.ensure_loaded().await.unwrap();
    let mut refresh_rx = state.refresh_tx.subscribe();

    let hits = state.index_manager.search("fresh").await.unwrap();
    assert!(hits.is_empty());

    let refresh_msg = tokio::time::timeout(Duration::from_secs(2), refresh_rx.recv())
        .await
        .unwrap()
        .unwrap();
    assert_eq!(refresh_msg, "{\"type\":\"INDEX_REFRESHED\"}");

    let deadline = Instant::now() + Duration::from_secs(2);
    loop {
        if runtime
            .paths
            .read()
            .await
            .contains(&fresh.to_string_lossy().to_string())
        {
            break;
        }
        assert!(
            Instant::now() < deadline,
            "refresh did not update runtime paths"
        );
        tokio::time::sleep(Duration::from_millis(20)).await;
    }

    let cache_mtime = fs::metadata(&cache_file).unwrap().modified().unwrap();
    let last_refresh_at = *runtime.last_refresh_at.lock().await;
    assert_eq!(last_refresh_at, cache_mtime);
}

#[tokio::test]
async fn first_use_refreshes_when_cache_was_just_created() {
    let temp = tempfile::tempdir().unwrap();
    let root = temp.path().join("root");
    fs::create_dir_all(&root).unwrap();
    let fresh = root.join("fresh-document.txt");
    fs::write(&fresh, "fresh").unwrap();
    let fresh = fresh.canonicalize().unwrap();

    let data_dir = temp.path().join("data");
    let cache_file = data_dir.join("cache.txt");
    ensure_cache_layout(&data_dir, &cache_file).unwrap();

    let mut config = build_config(&root, data_dir, cache_file);
    config.refresh_ttl = Duration::from_secs(60);
    config.force_initial_refresh = true;

    let state = AppState::new(config);
    let runtime = state.index_manager.ensure_loaded().await.unwrap();
    let mut refresh_rx = state.refresh_tx.subscribe();

    let hits = state.index_manager.search("fresh").await.unwrap();
    assert!(hits.is_empty());

    let refresh_msg = tokio::time::timeout(Duration::from_secs(2), refresh_rx.recv())
        .await
        .unwrap()
        .unwrap();
    assert_eq!(refresh_msg, "{\"type\":\"INDEX_REFRESHED\"}");

    let deadline = Instant::now() + Duration::from_secs(2);
    loop {
        if runtime
            .paths
            .read()
            .await
            .contains(&fresh.to_string_lossy().to_string())
        {
            break;
        }
        assert!(
            Instant::now() < deadline,
            "freshly created cache did not trigger bootstrap refresh"
        );
        tokio::time::sleep(Duration::from_millis(20)).await;
    }
}
