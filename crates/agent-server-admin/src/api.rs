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
use tracing::{info, debug, warn};

use crate::state::{AppState, ClientInfo, ClientRegistration, PendingMessage, ServerEvent};

/// 创建路由
pub fn create_router(state: AppState) -> Router {
    Router::new()
        // 健康检查
        .route("/health", get(health_check))
        // 客户端注册和心跳（供 agent-client 调用）
        .route("/api/register", post(register_client))
        .route("/api/heartbeat", post(client_heartbeat))
        .route("/api/poll", post(poll_messages))
        .route("/api/report", post(report_message))
        // 管理端 API
        .route("/api/clients", get(list_clients))
        .route("/api/clients/online", get(list_online_clients))
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

// ============================================================================
// 客户端 API（供 agent-client 调用）
// ============================================================================

/// 注册响应
#[derive(Serialize)]
struct RegisterResponse {
    success: bool,
    message: String,
    client_info: Option<ClientInfo>,
}

/// 客户端注册
async fn register_client(
    State(state): State<AppState>,
    Json(req): Json<ClientRegistration>,
) -> Json<RegisterResponse> {
    info!("Client registration: id={}, os={}", req.client_id, req.os);

    let client = state.register_client(req);

    Json(RegisterResponse {
        success: true,
        message: "Registered successfully".to_string(),
        client_info: Some(client),
    })
}

/// 心跳请求
#[derive(Deserialize)]
struct HeartbeatRequest {
    client_id: String,
    #[serde(default)]
    latency_ms: Option<u32>,
}

/// 心跳响应
#[derive(Serialize)]
struct HeartbeatResponse {
    success: bool,
    pending_messages: usize,
}

/// 客户端心跳
async fn client_heartbeat(
    State(state): State<AppState>,
    Json(req): Json<HeartbeatRequest>,
) -> Result<Json<HeartbeatResponse>, StatusCode> {
    if !state.update_heartbeat(&req.client_id) {
        // 客户端未注册，需要先注册
        return Err(StatusCode::NOT_FOUND);
    }

    // 更新延迟
    if let Some(latency) = req.latency_ms {
        if let Some(mut client) = state.clients.get_mut(&req.client_id) {
            client.latency = Some(latency);
        }
    }

    let pending = state.pending_message_count(&req.client_id);

    Ok(Json(HeartbeatResponse {
        success: true,
        pending_messages: pending,
    }))
}

/// 轮询请求
#[derive(Deserialize)]
struct PollRequest {
    client_id: String,
    #[serde(default)]
    max_messages: Option<usize>,
}

/// 轮询响应
#[derive(Serialize)]
struct PollResponse {
    messages: Vec<PendingMessage>,
}

/// 客户端轮询消息
async fn poll_messages(
    State(state): State<AppState>,
    Json(req): Json<PollRequest>,
) -> Result<Json<PollResponse>, StatusCode> {
    // 验证客户端存在
    if state.get_client(&req.client_id).is_none() {
        return Err(StatusCode::NOT_FOUND);
    }

    // 更新心跳
    state.update_heartbeat(&req.client_id);

    // 获取待发送消息
    let mut messages = state.drain_pending_messages(&req.client_id);

    // 限制数量
    if let Some(max) = req.max_messages {
        if messages.len() > max {
            // 将多余的放回队列
            let overflow: Vec<_> = messages.drain(max..).collect();
            for msg in overflow.into_iter().rev() {
                state.enqueue_message(&req.client_id, msg);
            }
        }
    }

    debug!("Client {} polled {} messages", req.client_id, messages.len());

    Ok(Json(PollResponse { messages }))
}

/// 客户端上报消息请求
#[derive(Deserialize)]
struct ReportRequest {
    client_id: String,
    message_type: String,
    payload: serde_json::Value,
    /// 响应的消息 ID（如果是对某个消息的响应）
    #[serde(default)]
    in_reply_to: Option<String>,
}

/// 客户端上报消息响应
#[derive(Serialize)]
struct ReportResponse {
    success: bool,
    message_id: String,
}

/// 客户端上报消息（任务完成、状态更新等）
async fn report_message(
    State(state): State<AppState>,
    Json(req): Json<ReportRequest>,
) -> Result<Json<ReportResponse>, StatusCode> {
    // 验证客户端存在
    if state.get_client(&req.client_id).is_none() {
        return Err(StatusCode::NOT_FOUND);
    }

    let message_id = uuid::Uuid::new_v4().to_string();

    info!(
        "Client {} reported message: type={}, reply_to={:?}",
        req.client_id, req.message_type, req.in_reply_to
    );

    // 发送事件
    state.emit_event(ServerEvent::MessageReceived {
        client_id: req.client_id,
        message_type: req.message_type,
        payload: req.payload.to_string(),
    });

    Ok(Json(ReportResponse {
        success: true,
        message_id,
    }))
}

// ============================================================================
// 管理端 API
// ============================================================================

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

/// 获取在线客户端列表
async fn list_online_clients(State(state): State<AppState>) -> Json<ClientListResponse> {
    let clients = state.list_online_clients();
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

    // 确保桥接层已启动
    if !state.bridge.is_running() {
        if let Err(e) = state.start_bridge().await {
            return Ok(Json(ConnectResponse {
                success: false,
                message: format!("Failed to start bridge: {}", e),
                connection_id: None,
            }));
        }
    }

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
    #[serde(default)]
    timeout: Option<u64>,
}

/// 消息响应
#[derive(Serialize)]
struct MessageResponse {
    success: bool,
    message_id: String,
    queued: bool,
    error: Option<String>,
}

/// 向客户端发送消息
async fn send_message(
    State(state): State<AppState>,
    Path(id): Path<String>,
    Json(req): Json<MessageRequest>,
) -> Result<Json<MessageResponse>, StatusCode> {
    let client = state.get_client(&id).ok_or(StatusCode::NOT_FOUND)?;

    let message_id = uuid::Uuid::new_v4().to_string();

    if !client.online {
        warn!("Client {} is offline, queueing message {}", id, message_id);
    }

    debug!(
        "Sending message {} to client {}: type={}",
        message_id, id, req.message_type
    );

    // 将消息加入待发送队列
    let pending = PendingMessage {
        message_id: message_id.clone(),
        message_type: req.message_type,
        payload: req.payload,
        created_at: chrono::Utc::now(),
    };

    state.enqueue_message(&id, pending);

    Ok(Json(MessageResponse {
        success: true,
        message_id,
        queued: true,
        error: None,
    }))
}

/// SSE 事件流
async fn sse_events(
    State(state): State<AppState>,
) -> Sse<impl Stream<Item = Result<Event, Infallible>>> {
    let rx = state.subscribe_events();

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
