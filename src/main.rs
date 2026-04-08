use std::net::{IpAddr, Ipv4Addr, SocketAddr};
use std::path::PathBuf;
use std::sync::Arc;

use tracing_subscriber::EnvFilter;

use fzfetch::cache::{CacheLayoutStatus, ensure_cache_layout};
use fzfetch::config::AppConfig;
use fzfetch::state::AppState;
use fzfetch::web::build_app;

fn build_env_filter() -> EnvFilter {
    EnvFilter::try_from_default_env().unwrap_or_else(|_| EnvFilter::new("info"))
}

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    tracing_subscriber::fmt()
        .with_env_filter(build_env_filter())
        .init();

    let mut config = AppConfig::from_env()?;
    config.ensure_runtime_dirs()?;
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

    let app = build_app(state, PathBuf::from("frontend/dist"));
    let addr = SocketAddr::from((IpAddr::V4(Ipv4Addr::UNSPECIFIED), 3000));
    let listener = tokio::net::TcpListener::bind(addr).await?;
    tracing::info!(%addr, "fzfetch backend listening");
    axum::serve(listener, app).await?;

    Ok(())
}

#[cfg(test)]
mod tests {
    use std::sync::{Mutex, OnceLock};

    use super::build_env_filter;

    fn env_lock() -> &'static Mutex<()> {
        static LOCK: OnceLock<Mutex<()>> = OnceLock::new();
        LOCK.get_or_init(|| Mutex::new(()))
    }

    #[test]
    fn build_env_filter_defaults_to_info_when_missing() {
        let _guard = env_lock().lock().unwrap_or_else(|error| error.into_inner());
        unsafe {
            std::env::remove_var("RUST_LOG");
        }

        let filter = build_env_filter();

        assert_eq!(filter.to_string(), "info");
    }

    #[test]
    fn build_env_filter_uses_valid_rust_log_value() {
        let _guard = env_lock().lock().unwrap_or_else(|error| error.into_inner());
        unsafe {
            std::env::set_var("RUST_LOG", "debug");
        }

        let filter = build_env_filter();

        assert_eq!(filter.to_string(), "debug");

        unsafe {
            std::env::remove_var("RUST_LOG");
        }
    }

    #[test]
    fn build_env_filter_falls_back_to_info_when_rust_log_is_invalid() {
        let _guard = env_lock().lock().unwrap_or_else(|error| error.into_inner());
        unsafe {
            std::env::set_var("RUST_LOG", "[invalid");
        }

        let filter = build_env_filter();

        assert_eq!(filter.to_string(), "info");

        unsafe {
            std::env::remove_var("RUST_LOG");
        }
    }
}
