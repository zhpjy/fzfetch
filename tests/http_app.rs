use std::fs;
use std::path::Path;
use std::sync::Arc;

use axum::Router;
use axum::body::{Body, to_bytes};
use axum::http::{Request, StatusCode};
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
    fzfetch::web::build_app(state)
}

#[tokio::test]
async fn app_serves_index_for_unknown_frontend_route() {
    let temp = tempfile::tempdir().unwrap();
    let root = temp.path().join("root");
    fs::create_dir_all(&root).unwrap();

    let response = build_app(&root)
        .oneshot(
            Request::builder()
                .uri("/search")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::OK);
    let body = to_bytes(response.into_body(), usize::MAX).await.unwrap();
    assert!(String::from_utf8_lossy(&body).contains("<!doctype html"));
}

#[tokio::test]
async fn app_serves_static_asset_files() {
    let temp = tempfile::tempdir().unwrap();
    let root = temp.path().join("root");
    fs::create_dir_all(&root).unwrap();

    let asset_path = fs::read_dir("frontend/dist/assets")
        .unwrap()
        .next()
        .unwrap()
        .unwrap()
        .path();
    let asset_name = asset_path.file_name().unwrap().to_string_lossy();
    let uri = format!("/assets/{asset_name}");

    let response = build_app(&root)
        .oneshot(Request::builder().uri(uri).body(Body::empty()).unwrap())
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::OK);
    let body = to_bytes(response.into_body(), usize::MAX).await.unwrap();
    assert!(!body.is_empty());
}

#[tokio::test]
async fn app_keeps_download_route_reserved_for_api() {
    let temp = tempfile::tempdir().unwrap();
    let root = temp.path().join("root");
    fs::create_dir_all(&root).unwrap();

    let response = build_app(&root)
        .oneshot(
            Request::builder()
                .uri("/download")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::BAD_REQUEST);
}
