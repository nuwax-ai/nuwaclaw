//! 状态栏 ViewModel
//!
//! 负责管理连接状态和 Agent 状态的 UI 展示
//! 通过组合 ConnectionStatusViewModel 和 AgentStatusViewModel 实现

use std::sync::Arc;

use super::{
    agent_status::{
        AgentStatusAction, AgentStatusViewModel, AgentStatusViewModelState, UIAgentState,
    },
    connection_status::{
        ConnectionStatusAction, ConnectionStatusViewModel, ConnectionStatusViewModelState, UIConnectionState,
    },
};

/// 状态栏 ViewModel 状态
#[derive(Debug, Clone, Default)]
pub struct StatusBarViewModelState {
    /// 连接状态 ViewModel 状态快照
    pub connection_status: ConnectionStatusViewModelState,
    /// Agent 状态 ViewModel 状态快照
    pub agent_status: AgentStatusViewModelState,
    /// 依赖是否正常
    pub dependency_ok: bool,
}

impl StatusBarViewModelState {
    /// 默认状态
    pub fn new() -> Self {
        Self {
            connection_status: ConnectionStatusViewModelState::new(),
            agent_status: AgentStatusViewModelState::new(),
            dependency_ok: true,
        }
    }
}

/// 状态栏操作
#[derive(Debug, Clone)]
pub enum StatusBarAction {
    /// 更新连接状态
    SetConnectionState(UIConnectionState),
    /// 更新 Agent 状态
    SetAgentState(UIAgentState),
    /// 更新依赖状态
    SetDependencyOk(bool),
}

/// 状态栏 ViewModel
///
/// 负责：
/// - 管理连接状态和 Agent 状态的 UI 展示
/// - 处理状态更新操作
/// - 提供只读的 UI 状态供组件使用
///
/// 使用组合模式，内部包含：
/// - connection_status: 连接状态管理
/// - agent_status: Agent 状态管理
#[derive(Clone)]
pub struct StatusBarViewModel {
    /// 连接状态 ViewModel
    pub connection_status: Arc<ConnectionStatusViewModel>,
    /// Agent 状态 ViewModel
    pub agent_status: Arc<AgentStatusViewModel>,
    /// 依赖状态
    dependency_ok: Arc<std::sync::RwLock<bool>>,
}

impl StatusBarViewModel {
    /// 创建新的 ViewModel
    pub fn new() -> Self {
        Self {
            connection_status: Arc::new(ConnectionStatusViewModel::new()),
            agent_status: Arc::new(AgentStatusViewModel::new()),
            dependency_ok: Arc::new(std::sync::RwLock::new(true)),
        }
    }

    /// 获取当前状态的快照
    pub async fn get_state(&self) -> StatusBarViewModelState {
        StatusBarViewModelState {
            connection_status: self.connection_status.get_state().await,
            agent_status: self.agent_status.get_state().await,
            dependency_ok: *self.dependency_ok.read().unwrap(),
        }
    }

    /// 获取连接状态
    pub async fn connection_state(&self) -> UIConnectionState {
        self.connection_status.connection_state().await
    }

    /// 获取 Agent 状态
    pub async fn agent_state(&self) -> UIAgentState {
        self.agent_status.agent_state().await
    }

    /// 获取活跃任务数
    pub async fn active_task_count(&self) -> usize {
        self.agent_status.active_task_count().await
    }

    /// 检查依赖是否正常
    pub async fn dependency_ok(&self) -> bool {
        *self.dependency_ok.read().unwrap()
    }

    /// 处理状态更新操作
    pub async fn handle_action(&self, action: StatusBarAction) {
        match action {
            StatusBarAction::SetConnectionState(new_state) => {
                self.connection_status
                    .handle_action(ConnectionStatusAction::SetConnectionState(
                        new_state,
                    ))
                    .await;
            }
            StatusBarAction::SetAgentState(new_state) => {
                self.agent_status
                    .handle_action(AgentStatusAction::SetAgentState(new_state))
                    .await;
            }
            StatusBarAction::SetDependencyOk(ok) => {
                *self.dependency_ok.write().unwrap() = ok;
            }
        }
    }

    /// 更新连接状态
    pub async fn set_connection_state(&self, state: UIConnectionState) {
        self.connection_status.set_connection_state(state).await;
    }

    /// 更新 Agent 状态
    pub async fn set_agent_state(&self, state: UIAgentState) {
        self.agent_status.set_agent_state(state).await;
    }

    /// 更新依赖状态
    pub async fn set_dependency_ok(&self, ok: bool) {
        *self.dependency_ok.write().unwrap() = ok;
    }

    /// 获取连接状态 ViewModel（用于直接访问）
    pub fn connection_status_viewmodel(&self) -> &Arc<ConnectionStatusViewModel> {
        &self.connection_status
    }

    /// 获取 Agent 状态 ViewModel（用于直接访问）
    pub fn agent_status_viewmodel(&self) -> &Arc<AgentStatusViewModel> {
        &self.agent_status
    }
}

impl Default for StatusBarViewModel {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn test_viewmodel_creation() {
        let vm = StatusBarViewModel::new();
        let state = vm.get_state().await;

        assert_eq!(state.connection_status.connection_state, UIConnectionState::Disconnected);
        assert_eq!(state.agent_status.agent_state, UIAgentState::Idle);
        assert!(state.dependency_ok);
    }

    #[tokio::test]
    async fn test_set_connection_state() {
        let vm = StatusBarViewModel::new();

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
    async fn test_set_agent_state() {
        let vm = StatusBarViewModel::new();

        // 初始状态
        assert_eq!(vm.agent_state().await, UIAgentState::Idle);

        // 更新为活跃
        vm.set_agent_state(UIAgentState::Active(2)).await;
        assert_eq!(vm.agent_state().await, UIAgentState::Active(2));

        // 更新为执行中
        vm.set_agent_state(UIAgentState::Executing(1, 3)).await;
        assert_eq!(vm.agent_state().await, UIAgentState::Executing(1, 3));

        // 更新为错误
        vm.set_agent_state(UIAgentState::Error).await;
        assert_eq!(vm.agent_state().await, UIAgentState::Error);
    }

    #[tokio::test]
    async fn test_set_dependency_ok() {
        let vm = StatusBarViewModel::new();

        // 初始状态
        assert!(vm.dependency_ok().await);

        // 更新为 false
        vm.set_dependency_ok(false).await;
        assert!(!vm.dependency_ok().await);

        // 更新回 true
        vm.set_dependency_ok(true).await;
        assert!(vm.dependency_ok().await);
    }

    #[tokio::test]
    async fn test_handle_action() {
        let vm = StatusBarViewModel::new();

        // 使用 handle_action 更新状态
        vm.handle_action(StatusBarAction::SetConnectionState(UIConnectionState::Connecting))
            .await;
        vm.handle_action(StatusBarAction::SetAgentState(UIAgentState::Active(5)))
            .await;
        vm.handle_action(StatusBarAction::SetDependencyOk(false))
            .await;

        let state = vm.get_state().await;
        assert_eq!(state.connection_status.connection_state, UIConnectionState::Connecting);
        assert_eq!(state.agent_status.agent_state, UIAgentState::Active(5));
        assert!(!state.dependency_ok);
    }

    #[tokio::test]
    async fn test_sub_viewmodels() {
        let vm = StatusBarViewModel::new();

        // 测试直接访问子 ViewModel
        vm.connection_status
            .set_connection_state(UIConnectionState::Connected(UIConnectionMode::Relay, 100))
            .await;
        vm.agent_status
            .set_agent_state(UIAgentState::Executing(2, 5))
            .await;

        assert_eq!(
            vm.connection_state().await,
            UIConnectionState::Connected(UIConnectionMode::Relay, 100)
        );
        assert_eq!(vm.agent_state().await, UIAgentState::Executing(2, 5));
    }
}
