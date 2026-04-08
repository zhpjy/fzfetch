use std::fs;
use std::path::Path;
use std::sync::Arc;

use axum::Router;
use axum::body::Body;
use axum::http::{Request, StatusCode};
use axum::routing::get;
use fzfetch::api::download_handler;
use fzfetch::config::AppConfig;
use fzfetch::state::AppState;
use tower::ServiceExt;

fn build_config(root_dir: &Path) -> AppConfig {
    let mut config = AppConfig::default_for(root_dir.to_path_buf());
    config.canonical_root_dir = root_dir.canonicalize().unwrap();
    config
}

fn build_app(root_dir: &Path) -> Router {
    let state = Arc::new(AppState::new(build_config(root_dir)));
    Router::new()
        .route("/download", get(download_handler))
        .with_state(state)
}

#[tokio::test]
async fn download_rejects_path_outside_root() {
    let temp = tempfile::tempdir().unwrap();
    let root = temp.path().join("root");
    let outside_dir = temp.path().join("outside");
    let outside = outside_dir.join("missing.txt");
    fs::create_dir_all(&root).unwrap();
    fs::create_dir_all(&outside_dir).unwrap();

    let app = build_app(&root);
    let request = Request::builder()
        .uri(format!("/download?path={}", outside.to_string_lossy()))
        .body(Body::empty())
        .unwrap();

    let response = app.oneshot(request).await.unwrap();

    assert_eq!(response.status(), StatusCode::FORBIDDEN);
}

#[tokio::test]
async fn download_returns_410_for_ghost_file() {
    let temp = tempfile::tempdir().unwrap();
    let root = temp.path().join("root");
    let ghost = root.join("ghost.txt");
    fs::create_dir_all(&root).unwrap();
    fs::write(&ghost, "ghost").unwrap();
    fs::remove_file(&ghost).unwrap();

    let app = build_app(&root);
    let request = Request::builder()
        .uri(format!("/download?path={}", ghost.to_string_lossy()))
        .body(Body::empty())
        .unwrap();

    let response = app.oneshot(request).await.unwrap();

    assert_eq!(response.status(), StatusCode::GONE);
}
