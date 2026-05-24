use std::fs;
use std::path::Path;
use std::sync::Arc;

use axum::Router;
use axum::body::{Body, to_bytes};
use axum::http::{Request, StatusCode, header};
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

fn content_type(response: &axum::response::Response) -> &str {
    response
        .headers()
        .get(header::CONTENT_TYPE)
        .unwrap()
        .to_str()
        .unwrap()
}

struct RestoreAsset {
    original: std::path::PathBuf,
    hidden: std::path::PathBuf,
}

impl Drop for RestoreAsset {
    fn drop(&mut self) {
        if self.hidden.exists() {
            fs::rename(&self.hidden, &self.original).unwrap();
        }
    }
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
    assert!(content_type(&response).contains("text/html"));
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
    let asset_extension = asset_path.extension().unwrap().to_string_lossy();
    let uri = format!("/assets/{asset_name}");
    let expected_body = fs::read(&asset_path).unwrap();
    let hidden_asset_path = asset_path.with_extension(format!("{asset_extension}.hidden"));
    let _restore_asset = RestoreAsset {
        original: asset_path.clone(),
        hidden: hidden_asset_path.clone(),
    };
    fs::rename(&asset_path, &hidden_asset_path).unwrap();

    let response = build_app(&root)
        .oneshot(Request::builder().uri(uri).body(Body::empty()).unwrap())
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::OK);
    let content_type = content_type(&response);
    match asset_extension.as_ref() {
        "css" => assert!(content_type.contains("text/css")),
        "js" => assert!(content_type.contains("javascript")),
        _ => assert_ne!(content_type, "application/octet-stream"),
    }
    let body = to_bytes(response.into_body(), usize::MAX).await.unwrap();
    assert!(!body.is_empty());
    assert_eq!(body, expected_body);
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
