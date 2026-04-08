use std::path::Path;
use std::sync::Arc;

use axum::Router;
use axum::routing::{get, get_service};
use tower_http::services::{ServeDir, ServeFile};

use crate::api::download_handler;
use crate::state::AppState;
use crate::ws::ws_handler;

pub fn build_app(state: Arc<AppState>, web_dir: impl AsRef<Path>) -> Router {
    let web_dir = web_dir.as_ref().to_path_buf();
    let index_file = web_dir.join("index.html");

    Router::new()
        .route("/ws", get(ws_handler))
        .route("/download", get(download_handler))
        .fallback_service(get_service(
            ServeDir::new(web_dir).fallback(ServeFile::new(index_file)),
        ))
        .with_state(state)
}
