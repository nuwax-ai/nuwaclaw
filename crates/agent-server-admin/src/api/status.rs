//! 状态和健康检查 API

use axum::{extract::State, Json};

use crate::state::AppState;

use super::dto::{BridgeStatusResponse, HealthResponse};

/// 健康检查
pub async fn health_check() -> Json<HealthResponse> {
    Json(HealthResponse {
        status: "ok",
        version: env!("CARGO_PKG_VERSION"),
    })
}

/// 获取桥接层和服务器状态
pub async fn bridge_status(State(state): State<AppState>) -> Json<BridgeStatusResponse> {
    let all_clients = state.list_clients();
    let online_clients = all_clients.iter().filter(|c| c.online).count();
    Json(BridgeStatusResponse {
        bridge_running: state.bridge.is_running(),
        bridge_self_id: state.get_bridge_self_id().await,
        hbbs_addr: state.bridge.hbbs_addr().to_string(),
        connected_clients: all_clients.len(),
        online_clients,
        p2p_connections: state.p2p_connection_count(),
    })
}
