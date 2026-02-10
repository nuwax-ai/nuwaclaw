//! 客户端管理 API

use axum::{
    extract::{Path, State},
    http::StatusCode,
    Json,
};
use tracing::{info, warn};

use nuwax_agent_core::business_channel::BusinessMessageType;

use crate::state::{AppState, ClientInfo, ClientRegistration, ServerEvent};

use super::dto::{
    ClientListResponse, ConnectRequest, ConnectResponse, HeartbeatRequest, HeartbeatResponse,
    MessageRequest, MessageResponse, RegisterResponse, ReportRequest, ReportResponse,
};

/// 客户端注册
pub async fn register_client(
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

/// 客户端心跳
pub async fn client_heartbeat(
    State(state): State<AppState>,
    Json(req): Json<HeartbeatRequest>,
) -> Result<Json<HeartbeatResponse>, StatusCode> {
    if !state.update_heartbeat(&req.client_id) {
        return Err(StatusCode::NOT_FOUND);
    }

    // 更新延迟
    if let Some(latency) = req.latency_ms {
        if let Some(mut client) = state.clients.get_mut(&req.client_id) {
            client.latency = Some(latency);
        }
    }

    Ok(Json(HeartbeatResponse { success: true }))
}

/// 客户端上报消息（任务完成、状态更新等）
pub async fn report_message(
    State(state): State<AppState>,
    Json(req): Json<ReportRequest>,
) -> Result<Json<ReportResponse>, StatusCode> {
    if state.get_client(&req.client_id).is_none() {
        return Err(StatusCode::NOT_FOUND);
    }

    let message_id = uuid::Uuid::new_v4().to_string();

    info!(
        "Client {} reported message: type={}, reply_to={:?}",
        req.client_id, req.message_type, req.in_reply_to
    );

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

/// 获取客户端列表
pub async fn list_clients(State(state): State<AppState>) -> Json<ClientListResponse> {
    let clients = state.list_clients();
    let total = clients.len();
    Json(ClientListResponse { clients, total })
}

/// 获取在线客户端列表
pub async fn list_online_clients(State(state): State<AppState>) -> Json<ClientListResponse> {
    let clients = state.list_online_clients();
    let total = clients.len();
    Json(ClientListResponse { clients, total })
}

/// 获取单个客户端
pub async fn get_client(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> Result<Json<ClientInfo>, StatusCode> {
    state.get_client(&id).map(Json).ok_or(StatusCode::NOT_FOUND)
}

/// 连接到客户端
///
/// 建立到客户端的 P2P 连接，用于后续消息发送
pub async fn connect_client(
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
            p2p_connected: false,
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
                p2p_connected: false,
            }));
        }
    }

    match state.connect_to_client(&id, req.password).await {
        Ok(_) => {
            let connection_id = uuid::Uuid::new_v4().to_string();
            info!("P2P connection initiated to client {}", id);
            Ok(Json(ConnectResponse {
                success: true,
                message: format!("P2P connection initiated to client {} via {}", id, mode),
                connection_id: Some(connection_id),
                p2p_connected: true,
            }))
        }
        Err(e) => {
            warn!("Failed to establish P2P connection to {}: {}", id, e);
            Ok(Json(ConnectResponse {
                success: false,
                message: format!("Failed to establish P2P connection: {}", e),
                connection_id: None,
                p2p_connected: false,
            }))
        }
    }
}

/// 向客户端发送消息
///
/// 通过 dispatcher 发送，Fail Fast — 无可用连接时返回错误
pub async fn send_message(
    State(state): State<AppState>,
    Path(id): Path<String>,
    Json(req): Json<MessageRequest>,
) -> Result<Json<MessageResponse>, StatusCode> {
    let _client = state.get_client(&id).ok_or(StatusCode::NOT_FOUND)?;

    // 将消息类型转换为 BusinessMessageType
    let biz_type = match req.message_type.as_str() {
        "AgentTaskRequest" => BusinessMessageType::AgentTaskRequest,
        "TaskCancel" => BusinessMessageType::TaskCancel,
        "Heartbeat" => BusinessMessageType::Heartbeat,
        "SystemNotify" => BusinessMessageType::SystemNotify,
        _ => BusinessMessageType::AgentTaskRequest,
    };

    match state.dispatcher.dispatch(&id, biz_type, req.payload).await {
        Ok(result) => {
            info!(
                "Message {} sent via {:?} to client {}: type={}",
                result.message_id, result.transport, id, req.message_type
            );
            Ok(Json(MessageResponse {
                success: true,
                message_id: result.message_id,
                transport: Some(format!("{:?}", result.transport)),
                error: None,
            }))
        }
        Err(e) => {
            warn!("Failed to send message to {}: {}", id, e);
            Ok(Json(MessageResponse {
                success: false,
                message_id: String::new(),
                transport: None,
                error: Some(e.to_string()),
            }))
        }
    }
}
