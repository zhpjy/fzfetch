use std::sync::Arc;
use std::sync::atomic::{AtomicU64, Ordering};

use axum::extract::State;
use axum::extract::ws::{Message, WebSocket, WebSocketUpgrade};
use axum::response::IntoResponse;
use futures::{SinkExt, StreamExt};
use serde::{Deserialize, Serialize};
use tokio::sync::mpsc;
use tokio::task::JoinSet;

use crate::search::SearchHit;
use crate::state::AppState;

const INDEX_REFRESHED_EVENT: &str = r#"{"type":"INDEX_REFRESHED"}"#;

#[derive(Debug, Deserialize)]
pub struct SearchRequest {
    pub req_id: u64,
    pub query: String,
}

#[derive(Debug, Serialize, PartialEq, Eq)]
pub struct SearchResponseItem {
    pub path: String,
    pub score: u32,
    pub size_bytes: Option<u64>,
}

#[derive(Debug, Serialize, PartialEq, Eq)]
pub struct SearchResponse {
    pub req_id: u64,
    pub data: Vec<SearchResponseItem>,
}

impl From<SearchHit> for SearchResponseItem {
    fn from(hit: SearchHit) -> Self {
        Self {
            path: hit.path,
            score: hit.score,
            size_bytes: hit.size_bytes,
        }
    }
}

pub async fn ws_handler(
    ws: WebSocketUpgrade,
    State(state): State<Arc<AppState>>,
) -> impl IntoResponse {
    ws.on_upgrade(move |socket| handle_socket(socket, state))
}

pub fn should_drop_response(latest_req_id: &AtomicU64, req_id: u64) -> bool {
    latest_req_id.load(Ordering::Acquire) != req_id
}

fn refresh_notification_message(_payload: String) -> Message {
    Message::Text(INDEX_REFRESHED_EVENT.into())
}

async fn handle_socket(socket: WebSocket, state: Arc<AppState>) {
    tracing::info!("websocket client connected");
    let latest_req_id = Arc::new(AtomicU64::new(0));
    let mut refresh_rx = state.refresh_tx.subscribe();
    let (outbound_tx, mut outbound_rx) = mpsc::channel::<Message>(64);
    let (mut socket_sender, mut socket_receiver) = socket.split();
    let mut search_tasks = JoinSet::new();

    let writer_task = tokio::spawn(async move {
        while let Some(message) = outbound_rx.recv().await {
            if socket_sender.send(message).await.is_err() {
                break;
            }
        }
    });

    loop {
        tokio::select! {
            incoming = socket_receiver.next() => {
                let Some(incoming) = incoming else {
                    break;
                };

                match incoming {
                    Ok(Message::Text(text)) => {
                        match serde_json::from_str::<SearchRequest>(&text) {
                            Ok(request) => {
                                tracing::debug!(
                                    req_id = request.req_id,
                                    query = %request.query,
                                    query_len = request.query.chars().count(),
                                    "websocket search request received"
                                );
                                latest_req_id.store(request.req_id, Ordering::Release);
                                search_tasks.spawn(run_search(
                                    state.clone(),
                                    latest_req_id.clone(),
                                    outbound_tx.clone(),
                                    request,
                                ));
                            }
                            Err(error) => {
                                tracing::warn!(?error, "invalid websocket search request");
                            }
                        }
                    }
                    Ok(Message::Ping(payload)) => {
                        tracing::debug!(payload_len = payload.len(), "websocket ping received");
                        if outbound_tx.send(Message::Pong(payload)).await.is_err() {
                            break;
                        }
                    }
                    Ok(Message::Close(_)) => {
                        tracing::info!("websocket close frame received");
                        break;
                    }
                    Ok(_) => {}
                    Err(error) => {
                        tracing::warn!(?error, "websocket receive failed");
                        break;
                    }
                }
            }
            refresh_result = refresh_rx.recv() => {
                match refresh_result {
                    Ok(payload) => {
                        tracing::debug!(payload = %payload, "websocket refresh broadcast queued");
                        if outbound_tx.send(refresh_notification_message(payload)).await.is_err() {
                            break;
                        }
                    }
                    Err(tokio::sync::broadcast::error::RecvError::Lagged(skipped)) => {
                        tracing::warn!(skipped, "websocket refresh subscriber lagged");
                    }
                    Err(tokio::sync::broadcast::error::RecvError::Closed) => break,
                }
            }
            joined = search_tasks.join_next(), if !search_tasks.is_empty() => {
                if let Some(Err(error)) = joined {
                    tracing::warn!(?error, "search task join failed");
                }
            }
        }
    }

    search_tasks.abort_all();
    drop(outbound_tx);

    while let Some(joined) = search_tasks.join_next().await {
        if let Err(error) = joined {
            tracing::warn!(?error, "search task shutdown failed");
        }
    }

    if let Err(error) = writer_task.await {
        tracing::warn!(?error, "websocket writer task failed");
    }
    tracing::info!("websocket client disconnected");
}

async fn run_search(
    state: Arc<AppState>,
    latest_req_id: Arc<AtomicU64>,
    outbound_tx: mpsc::Sender<Message>,
    request: SearchRequest,
) {
    let SearchRequest { req_id, query } = request;

    match state.index_manager.search(&query).await {
        Ok(hits) => {
            // 同连接内只保留最新 req_id 的响应，旧结果直接丢弃。
            if should_drop_response(&latest_req_id, req_id) {
                tracing::debug!(
                    req_id,
                    latest_req_id = latest_req_id.load(Ordering::Acquire),
                    "stale websocket search response dropped"
                );
                return;
            }

            tracing::debug!(
                req_id,
                result_count = hits.len(),
                "websocket search completed"
            );
            let response = SearchResponse {
                req_id,
                data: hits.into_iter().map(SearchResponseItem::from).collect(),
            };

            match serde_json::to_string(&response) {
                Ok(payload) => {
                    tracing::debug!(req_id, "websocket search response queued");
                    let _ = outbound_tx.send(Message::Text(payload.into())).await;
                }
                Err(error) => {
                    tracing::error!(?error, req_id, "failed to serialize search response");
                }
            }
        }
        Err(error) => {
            tracing::warn!(?error, req_id, "search request failed");
        }
    }
}

#[cfg(test)]
pub(crate) fn assert_stale_epoch_is_dropped() {
    let latest_req_id = AtomicU64::new(7);

    assert!(should_drop_response(&latest_req_id, 6));
    assert!(!should_drop_response(&latest_req_id, 7));
}

#[cfg(test)]
mod tests {
    use axum::extract::ws::Message;

    use super::{assert_stale_epoch_is_dropped, refresh_notification_message};

    #[test]
    fn stale_epoch_is_dropped() {
        assert_stale_epoch_is_dropped();
    }

    #[test]
    fn refresh_notification_uses_fixed_payload() {
        let message = refresh_notification_message("{\"type\":\"OTHER\"}".to_string());

        assert_eq!(
            message,
            Message::Text("{\"type\":\"INDEX_REFRESHED\"}".into())
        );
    }
}
