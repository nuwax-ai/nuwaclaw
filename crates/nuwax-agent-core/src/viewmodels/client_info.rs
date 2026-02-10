//! 客户端信息 ViewModel
//!
//! 负责管理客户端信息的显示

use std::sync::Arc;
use tokio::sync::RwLock;

use async_trait::async_trait;

use super::super::api::traits::ClientInfoApi;

/// 客户端信息状态
#[derive(Debug, Clone, Default, serde::Serialize)]
pub struct ClientInfoViewModelState {
    /// 客户端 ID
    pub client_id: Option<String>,
    /// 连接状态
    pub is_connected: bool,
    /// 连接地址
    pub connection_addr: Option<String>,
    /// 客户端版本
    pub version: String,
    /// 操作系统
    pub os: String,
    /// 架构
    pub arch: String,
}

/// 客户端操作
#[derive(Debug, Clone)]
pub enum ClientInfoAction {
    /// 更新客户端 ID
    UpdateClientId(Option<String>),
    /// 设置连接状态
    SetConnected(bool),
    /// 更新连接地址
    UpdateConnectionAddr(Option<String>),
    /// 复制客户端 ID
    CopyClientId,
}

/// 客户端信息 ViewModel
#[derive(Clone)]
pub struct ClientInfoViewModel {
    /// 状态
    state: Arc<RwLock<ClientInfoViewModelState>>,
}

impl Default for ClientInfoViewModel {
    fn default() -> Self {
        Self::new()
    }
}

impl ClientInfoViewModel {
    /// 创建新的 ViewModel
    pub fn new() -> Self {
        Self {
            state: Arc::new(RwLock::new(ClientInfoViewModelState {
                client_id: None,
                is_connected: false,
                connection_addr: None,
                version: env!("CARGO_PKG_VERSION").to_string(),
                os: std::env::consts::OS.to_string(),
                arch: std::env::consts::ARCH.to_string(),
            })),
        }
    }

    /// 获取当前状态
    pub async fn get_state(&self) -> ClientInfoViewModelState {
        self.state.read().await.clone()
    }

    /// 获取客户端 ID
    pub async fn client_id(&self) -> Option<String> {
        self.state.read().await.client_id.clone()
    }

    /// 设置客户端 ID
    pub async fn set_client_id(&self, id: Option<String>) {
        let mut state = self.state.write().await;
        state.client_id = id;
    }

    /// 检查是否已连接
    pub async fn is_connected(&self) -> bool {
        self.state.read().await.is_connected
    }

    /// 设置连接状态
    pub async fn set_connected(&self, connected: bool) {
        let mut state = self.state.write().await;
        state.is_connected = connected;
    }

    /// 获取连接地址
    pub async fn connection_addr(&self) -> Option<String> {
        self.state.read().await.connection_addr.clone()
    }

    /// 更新连接地址
    pub async fn update_connection_addr(&self, addr: Option<String>) {
        let mut state = self.state.write().await;
        state.connection_addr = addr;
    }

    /// 获取客户端版本
    pub async fn version(&self) -> String {
        self.state.read().await.version.clone()
    }

    /// 处理客户端操作
    pub async fn handle_action(&self, action: ClientInfoAction) {
        match action {
            ClientInfoAction::UpdateClientId(id) => self.set_client_id(id).await,
            ClientInfoAction::SetConnected(connected) => self.set_connected(connected).await,
            ClientInfoAction::UpdateConnectionAddr(addr) => self.update_connection_addr(addr).await,
            ClientInfoAction::CopyClientId => {
                // 复制到剪贴板的操作由 UI 层处理
            }
        }
    }
}

#[async_trait]
impl ClientInfoApi for ClientInfoViewModel {
    type State = ClientInfoViewModelState;

    async fn state(&self) -> Self::State {
        self.get_state().await
    }

    fn state_snapshot(&self) -> Self::State {
        futures::executor::block_on(self.get_state())
    }

    async fn set_client_id(&self, id: Option<String>) {
        self.state.write().await.client_id = id;
    }

    async fn set_connected(&self, connected: bool) {
        self.state.write().await.is_connected = connected;
    }

    async fn update_connection_addr(&self, addr: Option<String>) {
        self.state.write().await.connection_addr = addr;
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn test_client_info_viewmodel_creation() {
        let vm = ClientInfoViewModel::new();
        let state = vm.get_state().await;

        assert!(state.client_id.is_none());
        assert!(!state.is_connected);
        assert!(state.connection_addr.is_none());
    }

    #[tokio::test]
    async fn test_set_client_id() {
        let vm = ClientInfoViewModel::new();

        assert!(vm.client_id().await.is_none());

        vm.set_client_id(Some("test-client-id".to_string())).await;
        assert_eq!(vm.client_id().await, Some("test-client-id".to_string()));
    }

    #[tokio::test]
    async fn test_set_connected() {
        let vm = ClientInfoViewModel::new();

        assert!(!vm.is_connected().await);

        vm.set_connected(true).await;
        assert!(vm.is_connected().await);
    }
}
