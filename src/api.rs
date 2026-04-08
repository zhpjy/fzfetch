use std::ffi::OsString;
use std::path::{Path, PathBuf};
use std::sync::Arc;

use axum::body::Body;
use axum::extract::{Query, State};
use axum::http::HeaderValue;
use axum::http::header::{CONTENT_LENGTH, CONTENT_TYPE};
use axum::response::Response;
use serde::Deserialize;
use tokio::fs;
use tokio_util::io::ReaderStream;

use crate::error::AppError;
use crate::state::AppState;

#[derive(Debug, Deserialize)]
pub struct DownloadQuery {
    pub path: String,
}

pub async fn download_handler(
    State(state): State<Arc<AppState>>,
    Query(query): Query<DownloadQuery>,
) -> Result<Response, AppError> {
    let requested_path = PathBuf::from(query.path);

    if !requested_path.is_absolute() {
        return Err(AppError::BadRequest("path must be absolute".to_string()));
    }

    // 先用可解析到的现存祖先判断沙箱，避免根目录外缺失文件被误判为 Gone。
    let sandbox_path = resolve_path_for_sandbox(&requested_path).await?;
    if !sandbox_path.starts_with(&state.config.canonical_root_dir) {
        return Err(AppError::Forbidden);
    }

    if !path_exists(&requested_path).await? {
        return Err(AppError::Gone);
    }

    let canonical_path = fs::canonicalize(&requested_path)
        .await
        .map_err(map_io_error_for_download)?;
    if !canonical_path.starts_with(&state.config.canonical_root_dir) {
        return Err(AppError::Forbidden);
    }

    let metadata = fs::metadata(&canonical_path)
        .await
        .map_err(map_io_error_for_download)?;
    if !metadata.is_file() {
        return Err(AppError::NotFound);
    }

    let file = fs::File::open(&canonical_path)
        .await
        .map_err(map_io_error_for_download)?;
    let stream = ReaderStream::new(file);
    let content_length = HeaderValue::from_str(&metadata.len().to_string())
        .map_err(|error| AppError::Internal(error.to_string()))?;

    Response::builder()
        .header(
            CONTENT_TYPE,
            HeaderValue::from_static("application/octet-stream"),
        )
        .header(CONTENT_LENGTH, content_length)
        .body(Body::from_stream(stream))
        .map_err(|error| AppError::Internal(error.to_string()))
}

async fn path_exists(path: &Path) -> Result<bool, AppError> {
    fs::try_exists(path)
        .await
        .map_err(|error| AppError::Internal(error.to_string()))
}

async fn resolve_path_for_sandbox(path: &Path) -> Result<PathBuf, AppError> {
    let mut current = path.to_path_buf();
    let mut missing_parts = Vec::<OsString>::new();

    loop {
        if path_exists(&current).await? {
            let mut resolved = fs::canonicalize(&current)
                .await
                .map_err(map_io_error_for_download)?;
            for part in missing_parts.iter().rev() {
                resolved.push(part);
            }
            return Ok(resolved);
        }

        let Some(file_name) = current.file_name() else {
            return Err(AppError::BadRequest("path must be absolute".to_string()));
        };
        missing_parts.push(file_name.to_os_string());

        let Some(parent) = current.parent() else {
            return Err(AppError::BadRequest("path must be absolute".to_string()));
        };
        current = parent.to_path_buf();
    }
}

fn map_io_error_for_download(error: std::io::Error) -> AppError {
    if error.kind() == std::io::ErrorKind::NotFound {
        AppError::Gone
    } else {
        AppError::Internal(error.to_string())
    }
}
