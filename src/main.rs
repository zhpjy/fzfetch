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

    let cache_status = ensure_cache_layout(&config.data_dir, &config.cache_file)?;
    config.force_initial_refresh = cache_status == CacheLayoutStatus::Created;

    let state = Arc::new(AppState::new(config));
    let cleanup_manager = state.index_manager.clone();
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
