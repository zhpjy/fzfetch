use std::net::SocketAddr;
use std::sync::Arc;

use axum::Router;
use axum::routing::get;
use tracing_subscriber::EnvFilter;

use fzfetch::api::download_handler;
use fzfetch::cache::{CacheLayoutStatus, ensure_cache_layout};
use fzfetch::config::AppConfig;
use fzfetch::state::AppState;
use fzfetch::ws::ws_handler;

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    tracing_subscriber::fmt()
        .with_env_filter(EnvFilter::from_default_env())
        .init();

    let mut config = AppConfig::from_env()?;
    config.canonicalize_root_dir()?;
    tracing::info!(
        root_dir = %config.canonical_root_dir.display(),
        cache_file = %config.cache_file.display(),
        refresh_ttl_secs = config.refresh_ttl.as_secs(),
        idle_ttl_secs = config.idle_ttl.as_secs(),
        cleanup_interval_secs = config.cleanup_interval.as_secs(),
        top_k = config.top_k,
        "backend configuration loaded"
    );

    let cache_status = ensure_cache_layout(&config.data_dir, &config.cache_file)?;
    config.force_initial_refresh = cache_status == CacheLayoutStatus::Created;
    tracing::info!(
        cache_file = %config.cache_file.display(),
        cache_created = cache_status == CacheLayoutStatus::Created,
        "cache layout prepared"
    );

    let state = Arc::new(AppState::new(config));
    let cleanup_manager = state.index_manager.clone();
    tracing::info!("index cleanup loop started");
    tokio::spawn(async move {
        cleanup_manager.run_cleanup_loop().await;
    });

    let app = Router::new()
        .route("/ws", get(ws_handler))
        .route("/download", get(download_handler))
        .with_state(state);
    let addr = SocketAddr::from(([127, 0, 0, 1], 3000));
    let listener = tokio::net::TcpListener::bind(addr).await?;
    tracing::info!(%addr, "fzfetch backend listening");
    axum::serve(listener, app).await?;

    Ok(())
}
