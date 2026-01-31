//! 连接状态 ViewModel
//!
//! 专门管理连接状态的 UI 展示

use std::sync::Arc;
use tokio::sync::RwLock;

/// UI 层的连接状态（与业务逻辑解耦）
#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub enum UIConnectionState {
    /// 已断开
    #[default]
    Disconnected,
    /// 连接中
    Connecting,
    /// 已连接（模式，延迟 ms）
    Connected(UIConnectionMode, u32),
    /// 错误
    Error(String),
}

/// UI 层的连接模式
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum UIConnectionMode {
    /// P2P 直连
    P2P,
    /// 中继服务器
    Relay,
}

impl UIConnectionMode {
    /// 获取模式标签
    pub fn label(&self) -> &'static str {
        match self {
            Self::P2P => "P2P",
            Self::Relay => "中继",
        }
    }
}

/// 连接状态 ViewModel 状态
#[derive(Debug, Clone, Default)]
pub struct ConnectionStatusViewModelState {
    /// 连接状态
    pub connection_state: UIConnectionState,
}

impl ConnectionStatusViewModelState {
    /// 创建默认状态
    pub fn new() -> Self {
        Self::default()
    }
}

/// 连接状态操作
#[derive(Debug, Clone)]
pub enum ConnectionStatusAction {
    /// 更新连接状态
    SetConnectionState(UIConnectionState),
}

/// 连接状态 ViewModel
///
/// 专门负责：
/// - 管理连接状态的 UI 展示
/// - 处理连接状态更新操作
/// - 提供只读的连接状态供组件使用
#[derive(Clone)]
pub struct ConnectionStatusViewModel {
    /// 连接状态
    state: Arc<RwLock<ConnectionStatusViewModelState>>,
}

impl ConnectionStatusViewModel {
    /// 创建新的 ViewModel
    pub fn new() -> Self {
        Self {
            state: Arc::new(RwLock::new(ConnectionStatusViewModelState::new())),
        }
    }

    /// 获取当前状态的快照
    pub async fn get_state(&self) -> ConnectionStatusViewModelState {
        self.state.read().await.clone()
    }

    /// 获取连接状态
    pub async fn connection_state(&self) -> UIConnectionState {
        self.state.read().await.connection_state.clone()
    }

    /// 处理状态更新操作
    pub async fn handle_action(&self, action: ConnectionStatusAction) {
        let mut state = self.state.write().await;
        match action {
            ConnectionStatusAction::SetConnectionState(new_state) => {
                state.connection_state = new_state;
            }
        }
    }

    /// 更新连接状态
    pub async fn set_connection_state(&self, state: UIConnectionState) {
        let mut inner = self.state.write().await;
        inner.connection_state = state;
    }
}

impl Default for ConnectionStatusViewModel {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_ui_connection_mode_label() {
        assert_eq!(UIConnectionMode::P2P.label(), "P2P");
        assert_eq!(UIConnectionMode::Relay.label(), "中继");
    }

    #[tokio::test]
    async fn test_viewmodel_creation() {
        let vm = ConnectionStatusViewModel::new();
        let state = vm.get_state().await;

        assert_eq!(state.connection_state, UIConnectionState::Disconnected);
    }

    #[tokio::test]
    async fn test_set_connection_state() {
        let vm = ConnectionStatusViewModel::new();

        // 初始状态
        assert_eq!(vm.connection_state().await, UIConnectionState::Disconnected);

        // 更新为连接中
        vm.set_connection_state(UIConnectionState::Connecting).await;
        assert_eq!(vm.connection_state().await, UIConnectionState::Connecting);

        // 更新为已连接
        vm.set_connection_state(UIConnectionState::Connected(UIConnectionMode::P2P, 25))
            .await;
        assert_eq!(
            vm.connection_state().await,
            UIConnectionState::Connected(UIConnectionMode::P2P, 25)
        );
    }

    #[tokio::test]
    async fn test_handle_action() {
        let vm = ConnectionStatusViewModel::new();

        vm.handle_action(ConnectionStatusAction::SetConnectionState(
            UIConnectionState::Connected(UIConnectionMode::Relay, 50),
        ))
        .await;

        let state = vm.get_state().await;
        assert_eq!(
            state.connection_state,
            UIConnectionState::Connected(UIConnectionMode::Relay, 50)
        );
    }
}
