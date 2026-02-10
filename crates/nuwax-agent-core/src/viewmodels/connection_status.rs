//! 连接状态 ViewModel
//!
//! 负责管理连接状态的显示和用户交互

use std::sync::Arc;
use tokio::sync::RwLock;

use async_trait::async_trait;

pub use super::super::api::traits::connection_status::{
    ConnectionStatusApi, ConnectionStatusViewModelState, UIConnectionMode, UIConnectionState,
};

/// 连接操作
#[derive(Debug, Clone)]
pub enum ConnectionStatusAction {
    /// 断开连接
    Disconnect,
    /// 开始连接
    Connect(String),
    /// 设置连接状态
    SetState(UIConnectionState),
    /// 设置连接模式
    SetMode(UIConnectionMode),
    /// 设置远程 ID
    SetRemoteId(Option<String>),
    /// 设置连接质量
    SetQuality(Option<String>),
    /// 设置错误信息
    SetError(Option<String>),
}

/// 连接状态 ViewModel
#[derive(Clone)]
pub struct ConnectionStatusViewModel {
    /// 状态
    state: Arc<RwLock<ConnectionStatusViewModelState>>,
}

impl Default for ConnectionStatusViewModel {
    fn default() -> Self {
        Self::new()
    }
}

impl ConnectionStatusViewModel {
    /// 创建新的 ViewModel
    pub fn new() -> Self {
        Self {
            state: Arc::new(RwLock::new(ConnectionStatusViewModelState::default())),
        }
    }

    /// 获取当前状态
    pub async fn get_state(&self) -> ConnectionStatusViewModelState {
        self.state.read().await.clone()
    }

    /// 获取连接状态
    pub async fn state(&self) -> UIConnectionState {
        self.state.read().await.state
    }

    /// 设置连接状态
    pub async fn set_state(&self, state: UIConnectionState) {
        let mut s = self.state.write().await;
        s.state = state;
        if state != UIConnectionState::Error {
            s.error_message = None;
        }
    }

    /// 获取连接模式
    pub async fn mode(&self) -> Option<UIConnectionMode> {
        self.state.read().await.mode
    }

    /// 设置连接模式
    pub async fn set_mode(&self, mode: UIConnectionMode) {
        self.state.write().await.mode = Some(mode);
    }

    /// 获取远程 ID
    pub async fn remote_id(&self) -> Option<String> {
        self.state.read().await.remote_id.clone()
    }

    /// 设置远程 ID
    pub async fn set_remote_id(&self, id: Option<String>) {
        self.state.write().await.remote_id = id;
    }

    /// 获取连接质量
    pub async fn quality(&self) -> Option<String> {
        self.state.read().await.quality.clone()
    }

    /// 设置连接质量
    pub async fn set_quality(&self, quality: Option<String>) {
        self.state.write().await.quality = quality;
    }

    /// 获取错误信息
    pub async fn error_message(&self) -> Option<String> {
        self.state.read().await.error_message.clone()
    }

    /// 设置错误信息
    pub async fn set_error(&self, message: Option<String>) {
        let mut s = self.state.write().await;
        s.error_message = message.clone();
        if message.is_some() {
            s.state = UIConnectionState::Error;
        }
    }

    /// 处理连接操作
    pub async fn handle_action(&self, action: ConnectionStatusAction) {
        match action {
            ConnectionStatusAction::Disconnect => {
                self.set_state(UIConnectionState::Disconnected).await
            }
            ConnectionStatusAction::Connect(id) => {
                self.set_remote_id(Some(id)).await;
                self.set_state(UIConnectionState::Connecting).await;
            }
            ConnectionStatusAction::SetState(state) => self.set_state(state).await,
            ConnectionStatusAction::SetMode(mode) => self.set_mode(mode).await,
            ConnectionStatusAction::SetRemoteId(id) => self.set_remote_id(id).await,
            ConnectionStatusAction::SetQuality(quality) => self.set_quality(quality).await,
            ConnectionStatusAction::SetError(msg) => self.set_error(msg).await,
        }
    }

    /// 获取状态标签
    pub async fn status_label(&self) -> &'static str {
        match self.state().await {
            UIConnectionState::Disconnected => "未连接",
            UIConnectionState::Connecting => "连接中...",
            UIConnectionState::Connected => "已连接",
            UIConnectionState::Error => "连接错误",
        }
    }
}

#[async_trait]
impl ConnectionStatusApi for ConnectionStatusViewModel {
    type State = ConnectionStatusViewModelState;

    async fn state(&self) -> Self::State {
        self.state.read().await.clone()
    }

    fn state_snapshot(&self) -> Self::State {
        futures::executor::block_on(self.get_state())
    }

    async fn set_state(&self, state: UIConnectionState) {
        let mut s = self.state.write().await;
        s.state = state;
        if state != UIConnectionState::Error {
            s.error_message = None;
        }
    }

    async fn set_mode(&self, mode: UIConnectionMode) {
        self.state.write().await.mode = Some(mode);
    }

    async fn set_remote_id(&self, id: Option<String>) {
        self.state.write().await.remote_id = id;
    }

    async fn set_quality(&self, quality: Option<String>) {
        self.state.write().await.quality = quality;
    }

    async fn set_error(&self, message: Option<String>) {
        let mut s = self.state.write().await;
        s.error_message = message.clone();
        if message.is_some() {
            s.state = UIConnectionState::Error;
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn test_connection_status_viewmodel_creation() {
        let vm = ConnectionStatusViewModel::new();
        let state = vm.get_state().await;

        assert_eq!(state.state, UIConnectionState::Disconnected);
        assert!(state.mode.is_none());
        assert!(state.remote_id.is_none());
    }

    #[tokio::test]
    async fn test_set_connection_state() {
        let vm = ConnectionStatusViewModel::new();

        assert_eq!(vm.state().await, UIConnectionState::Disconnected);

        vm.set_state(UIConnectionState::Connecting).await;
        assert_eq!(vm.state().await, UIConnectionState::Connecting);

        vm.set_state(UIConnectionState::Connected).await;
        assert_eq!(vm.state().await, UIConnectionState::Connected);
    }

    #[tokio::test]
    async fn test_set_remote_id() {
        let vm = ConnectionStatusViewModel::new();

        assert!(vm.remote_id().await.is_none());

        vm.set_remote_id(Some("remote-123".to_string())).await;
        assert_eq!(vm.remote_id().await, Some("remote-123".to_string()));
    }

    #[tokio::test]
    async fn test_set_error() {
        let vm = ConnectionStatusViewModel::new();

        vm.set_error(Some("连接超时".to_string())).await;
        assert_eq!(vm.state().await, UIConnectionState::Error);
        assert_eq!(vm.error_message().await, Some("连接超时".to_string()));
    }
}
