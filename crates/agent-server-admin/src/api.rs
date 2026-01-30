//! API 路由模块

use std::convert::Infallible;
use std::time::Duration;

use axum::{
    Router,
    Json,
    extract::{Path, State},
    response::sse::{Event, Sse},
    routing::{get, post},
    http::StatusCode,
};
use futures::stream::{self, Stream};
use serde::{Deserialize, Serialize};
use tokio_stream::StreamExt;
use tracing::{info, debug};

use crate::state::{AppState, ClientInfo, ServerEvent};

/// 创建路由
pub fn create_router(state: AppState) -> Router {
    Router::new()
        .route("/health", get(health_check))
        .route("/api/clients", get(list_clients))
        .route("/api/clients/:id", get(get_client))
        .route("/api/clients/:id/connect", post(connect_client))
        .route("/api/clients/:id/message", post(send_message))
        .route("/api/events", get(sse_events))
        .with_state(state)
}

/// 健康检查响应
#[derive(Serialize)]
struct HealthResponse {
    status: &'static str,
    version: &'static str,
}

/// 健康检查
async fn health_check() -> Json<HealthResponse> {
    Json(HealthResponse {
        status: "ok",
        version: env!("CARGO_PKG_VERSION"),
    })
}

/// 客户端列表响应
#[derive(Serialize)]
struct ClientListResponse {
    clients: Vec<ClientInfo>,
    total: usize,
}

/// 获取客户端列表
async fn list_clients(State(state): State<AppState>) -> Json<ClientListResponse> {
    let clients = state.list_clients();
    let total = clients.len();
    Json(ClientListResponse { clients, total })
}

/// 获取单个客户端
async fn get_client(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> Result<Json<ClientInfo>, StatusCode> {
    state
        .get_client(&id)
        .map(Json)
        .ok_or(StatusCode::NOT_FOUND)
}

/// 连接请求
#[derive(Deserialize)]
struct ConnectRequest {
    /// 连接模式
    mode: Option<String>,
}

/// 连接响应
#[derive(Serialize)]
struct ConnectResponse {
    success: bool,
    message: String,
    connection_id: Option<String>,
}

/// 连接到客户端
async fn connect_client(
    State(state): State<AppState>,
    Path(id): Path<String>,
    Json(req): Json<ConnectRequest>,
) -> Result<Json<ConnectResponse>, StatusCode> {
    let client = state.get_client(&id).ok_or(StatusCode::NOT_FOUND)?;

    if !client.online {
        return Ok(Json(ConnectResponse {
            success: false,
            message: "Client is offline".to_string(),
            connection_id: None,
        }));
    }

    let mode = req.mode.unwrap_or_else(|| "auto".to_string());
    info!("Connecting to client {} with mode: {}", id, mode);

    // TODO: 实际连接逻辑
    let connection_id = uuid::Uuid::new_v4().to_string();

    Ok(Json(ConnectResponse {
        success: true,
        message: format!("Connected to client {} via {}", id, mode),
        connection_id: Some(connection_id),
    }))
}

/// 消息请求
#[derive(Deserialize)]
struct MessageRequest {
    /// 消息类型
    message_type: String,
    /// 消息负载
    payload: serde_json::Value,
    /// 超时时间 (ms)
    timeout: Option<u64>,
}

/// 消息响应
#[derive(Serialize)]
struct MessageResponse {
    success: bool,
    message_id: String,
    response: Option<serde_json::Value>,
    error: Option<String>,
}

/// 向客户端发送消息
async fn send_message(
    State(state): State<AppState>,
    Path(id): Path<String>,
    Json(req): Json<MessageRequest>,
) -> Result<Json<MessageResponse>, StatusCode> {
    let client = state.get_client(&id).ok_or(StatusCode::NOT_FOUND)?;

    if !client.online {
        return Ok(Json(MessageResponse {
            success: false,
            message_id: "".to_string(),
            response: None,
            error: Some("Client is offline".to_string()),
        }));
    }

    let message_id = uuid::Uuid::new_v4().to_string();
    debug!(
        "Sending message {} to client {}: type={}",
        message_id, id, req.message_type
    );

    // TODO: 实际消息发送逻辑
    // 这里模拟一个响应

    Ok(Json(MessageResponse {
        success: true,
        message_id,
        response: Some(serde_json::json!({
            "status": "received",
            "timestamp": chrono::Utc::now().to_rfc3339()
        })),
        error: None,
    }))
}

/// SSE 事件流
async fn sse_events(
    State(state): State<AppState>,
) -> Sse<impl Stream<Item = Result<Event, Infallible>>> {
    let mut rx = state.subscribe_events();

    let stream = stream::unfold(rx, |mut rx| async move {
        match rx.recv().await {
            Ok(event) => {
                let event_data = match event {
                    ServerEvent::ClientOnline(id) => Event::default()
                        .event("client_online")
                        .data(serde_json::json!({ "client_id": id }).to_string()),
                    ServerEvent::ClientOffline(id) => Event::default()
                        .event("client_offline")
                        .data(serde_json::json!({ "client_id": id }).to_string()),
                    ServerEvent::MessageReceived {
                        client_id,
                        message_type,
                        payload,
                    } => Event::default()
                        .event("message")
                        .data(
                            serde_json::json!({
                                "client_id": client_id,
                                "message_type": message_type,
                                "payload": payload
                            })
                            .to_string(),
                        ),
                };
                Some((Ok(event_data), rx))
            }
            Err(_) => None,
        }
    });

    // 添加心跳
    let heartbeat = stream::repeat_with(|| {
        Ok(Event::default().comment("heartbeat"))
    })
    .throttle(Duration::from_secs(30));

    Sse::new(stream.merge(heartbeat))
        .keep_alive(
            axum::response::sse::KeepAlive::new()
                .interval(Duration::from_secs(15))
                .text("ping"),
        )
}
