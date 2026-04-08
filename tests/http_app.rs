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

fn build_app(root_dir: &Path, web_dir: &Path) -> Router {
    let state = Arc::new(AppState::new(build_config(root_dir)));
    fzfetch::web::build_app(state, web_dir)
}

#[tokio::test]
async fn app_serves_index_for_unknown_frontend_route() {
    let temp = tempfile::tempdir().unwrap();
    let root = temp.path().join("root");
    let web_dir = temp.path().join("dist");
    fs::create_dir_all(&root).unwrap();
    fs::create_dir_all(&web_dir).unwrap();
    fs::write(web_dir.join("index.html"), "<html><body>spa</body></html>").unwrap();

    let response = build_app(&root, &web_dir)
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
    assert!(String::from_utf8_lossy(&body).contains("spa"));
}

#[tokio::test]
async fn app_serves_static_asset_files() {
    let temp = tempfile::tempdir().unwrap();
    let root = temp.path().join("root");
    let web_dir = temp.path().join("dist");
    let assets_dir = web_dir.join("assets");
    fs::create_dir_all(&root).unwrap();
    fs::create_dir_all(&assets_dir).unwrap();
    fs::write(web_dir.join("index.html"), "<html><body>spa</body></html>").unwrap();
    fs::write(assets_dir.join("app.js"), "console.log('asset');").unwrap();

    let response = build_app(&root, &web_dir)
        .oneshot(
            Request::builder()
                .uri("/assets/app.js")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::OK);
    let body = to_bytes(response.into_body(), usize::MAX).await.unwrap();
    assert_eq!(body, "console.log('asset');");
}

#[tokio::test]
async fn app_keeps_download_route_reserved_for_api() {
    let temp = tempfile::tempdir().unwrap();
    let root = temp.path().join("root");
    let web_dir = temp.path().join("dist");
    fs::create_dir_all(&root).unwrap();
    fs::create_dir_all(&web_dir).unwrap();
    fs::write(web_dir.join("index.html"), "<html><body>spa</body></html>").unwrap();

    let response = build_app(&root, &web_dir)
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
