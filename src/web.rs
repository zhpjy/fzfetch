use std::sync::Arc;

use axum::Router;
use axum::body::Body;
use axum::http::{HeaderValue, StatusCode, Uri, header};
use axum::response::{IntoResponse, Response};
use axum::routing::get;
use rust_embed::RustEmbed;

use crate::api::download_handler;
use crate::state::AppState;
use crate::ws::ws_handler;

#[derive(RustEmbed)]
#[folder = "frontend/dist"]
struct FrontendAssets;

pub fn build_app(state: Arc<AppState>) -> Router {
    Router::new()
        .route("/ws", get(ws_handler))
        .route("/download", get(download_handler))
        .fallback(static_handler)
        .with_state(state)
}

async fn static_handler(uri: Uri) -> Response {
    let path = asset_path(uri.path());
    match FrontendAssets::get(&path) {
        Some(asset) => asset_response(&path, asset.data.into_owned()),
        None => match FrontendAssets::get("index.html") {
            Some(index) => asset_response("index.html", index.data.into_owned()),
            None => StatusCode::NOT_FOUND.into_response(),
        },
    }
}

fn asset_path(path: &str) -> String {
    let trimmed = path.trim_start_matches('/');
    if trimmed.is_empty() {
        "index.html".to_string()
    } else {
        trimmed.to_string()
    }
}

fn asset_response(path: &str, bytes: Vec<u8>) -> Response {
    let content_type = mime_guess::from_path(path).first_or_octet_stream();
    let mut response = Body::from(bytes).into_response();
    response.headers_mut().insert(
        header::CONTENT_TYPE,
        HeaderValue::from_str(content_type.as_ref())
            .unwrap_or_else(|_| HeaderValue::from_static("application/octet-stream")),
    );
    response
}
