//! 状态栏 ViewModel
//!
//! 负责管理状态栏的显示和状态更新
//!
//! 注意：连接状态和 Agent 状态类型从 connection_status 和 agent_status 模块导入

use std::sync::Arc;
use tokio::sync::RwLock;

use async_trait::async_trait;

use super::super::api::traits::status_bar::{
    StatusBarApi, UIAgentState, UIConnectionMode, UIConnectionState,
};

/// 状态栏状态
#[derive(Debug, Clone, serde::Serialize)]
pub struct StatusBarViewModelState {
    /// 连接状态
    pub connection_state: UIConnectionState,
    /// 连接模式
    pub connection_mode: Option<UIConnectionMode>,
    /// 连接延迟 (毫秒)
    pub connection_latency: Option<u64>,
    /// Agent 状态
    pub agent_state: UIAgentState,
    /// Agent 任务数
    pub agent_task_count: usize,
    /// 依赖状态文本
    pub dependency_text: String,
    /// 是否有更新
    pub has_update: bool,
    /// 是否显示加载动画
    pub is_loading: bool,
}

impl Default for StatusBarViewModelState {
    fn default() -> Self {
        Self {
            connection_state: UIConnectionState::Disconnected,
            connection_mode: None,
            connection_latency: None,
            agent_state: UIAgentState::Offline,
            agent_task_count: 0,
            dependency_text: "依赖正常".to_string(),
            has_update: false,
            is_loading: false,
        }
    }
}

/// 状态栏操作
#[derive(Debug, Clone)]
pub enum StatusBarAction {
    /// 更新连接状态
    UpdateConnection(UIConnectionState),
    /// 更新连接模式
    UpdateMode(UIConnectionMode),
    /// 更新连接延迟
    UpdateLatency(Option<u64>),
    /// 更新 Agent 状态
    UpdateAgent(UIAgentState, usize),
    /// 更新依赖状态
    UpdateDependency(String),
    /// 设置更新状态
    SetUpdateAvailable(bool),
    /// 设置加载状态
    SetLoading(bool),
    /// 重置所有状态
    Reset,
}

/// 状态栏 ViewModel
#[derive(Clone)]
pub struct StatusBarViewModel {
    /// 状态
    state: Arc<RwLock<StatusBarViewModelState>>,
}

impl Default for StatusBarViewModel {
    fn default() -> Self {
        Self::new()
    }
}

impl StatusBarViewModel {
    /// 创建新的 ViewModel
    pub fn new() -> Self {
        Self {
            state: Arc::new(RwLock::new(StatusBarViewModelState::default())),
        }
    }

    /// 获取当前状态
    pub async fn get_state(&self) -> StatusBarViewModelState {
        self.state.read().await.clone()
    }

    /// 更新连接状态
    pub async fn update_connection(&self, state: UIConnectionState) {
        self.state.write().await.connection_state = state;
    }

    /// 更新连接模式
    pub async fn update_mode(&self, mode: UIConnectionMode) {
        self.state.write().await.connection_mode = Some(mode);
    }

    /// 更新连接延迟
    pub async fn update_latency(&self, latency: Option<u64>) {
        self.state.write().await.connection_latency = latency;
    }

    /// 更新 Agent 状态
    pub async fn update_agent(&self, state: UIAgentState, task_count: usize) {
        let mut s = self.state.write().await;
        s.agent_state = state;
        s.agent_task_count = task_count;
    }

    /// 更新依赖状态
    pub async fn update_dependency(&self, text: String) {
        self.state.write().await.dependency_text = text;
    }

    /// 设置是否有更新
    pub async fn set_update_available(&self, available: bool) {
        self.state.write().await.has_update = available;
    }

    /// 设置加载状态
    pub async fn set_loading(&self, loading: bool) {
        self.state.write().await.is_loading = loading;
    }

    /// 重置所有状态
    pub async fn reset(&self) {
        let mut state = self.state.write().await;
        state.connection_state = UIConnectionState::Disconnected;
        state.connection_mode = None;
        state.connection_latency = None;
        state.agent_state = UIAgentState::Offline;
        state.agent_task_count = 0;
        state.dependency_text = "依赖正常".to_string();
        state.has_update = false;
        state.is_loading = false;
    }

    /// 处理状态栏操作
    pub async fn handle_action(&self, action: StatusBarAction) {
        match action {
            StatusBarAction::UpdateConnection(state) => self.update_connection(state).await,
            StatusBarAction::UpdateMode(mode) => self.update_mode(mode).await,
            StatusBarAction::UpdateLatency(latency) => self.update_latency(latency).await,
            StatusBarAction::UpdateAgent(state, count) => self.update_agent(state, count).await,
            StatusBarAction::UpdateDependency(text) => self.update_dependency(text).await,
            StatusBarAction::SetUpdateAvailable(available) => {
                self.set_update_available(available).await
            }
            StatusBarAction::SetLoading(loading) => self.set_loading(loading).await,
            StatusBarAction::Reset => self.reset().await,
        }
    }
}

#[async_trait]
impl StatusBarApi for StatusBarViewModel {
    type State = StatusBarViewModelState;

    async fn state(&self) -> Self::State {
        self.get_state().await
    }

    fn state_snapshot(&self) -> Self::State {
        futures::executor::block_on(self.get_state())
    }

    async fn update_connection(&self, state: UIConnectionState) {
        self.state.write().await.connection_state = state;
    }

    async fn update_mode(&self, mode: UIConnectionMode) {
        self.state.write().await.connection_mode = Some(mode);
    }

    async fn update_latency(&self, latency: Option<u64>) {
        self.state.write().await.connection_latency = latency;
    }

    async fn update_agent(&self, state: UIAgentState, task_count: usize) {
        let mut s = self.state.write().await;
        s.agent_state = state;
        s.agent_task_count = task_count;
    }

    async fn update_dependency(&self, text: String) {
        self.state.write().await.dependency_text = text;
    }

    async fn set_update_available(&self, available: bool) {
        self.state.write().await.has_update = available;
    }

    async fn set_loading(&self, loading: bool) {
        self.state.write().await.is_loading = loading;
    }

    async fn reset(&self) {
        let mut state = self.state.write().await;
        state.connection_state = UIConnectionState::Disconnected;
        state.connection_mode = None;
        state.connection_latency = None;
        state.agent_state = UIAgentState::Offline;
        state.agent_task_count = 0;
        state.dependency_text = "依赖正常".to_string();
        state.has_update = false;
        state.is_loading = false;
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn test_status_bar_viewmodel_creation() {
        let vm = StatusBarViewModel::new();
        let state = vm.get_state().await;

        assert_eq!(state.connection_state, UIConnectionState::Disconnected);
        assert_eq!(state.agent_state, UIAgentState::Offline);
        assert_eq!(state.agent_task_count, 0);
        assert_eq!(state.dependency_text, "依赖正常");
        assert!(!state.has_update);
        assert!(!state.is_loading);
    }

    #[tokio::test]
    async fn test_update_connection() {
        let vm = StatusBarViewModel::new();

        vm.update_connection(UIConnectionState::Connected).await;
        let state = vm.get_state().await;

        assert_eq!(state.connection_state, UIConnectionState::Connected);
    }

    #[tokio::test]
    async fn test_update_agent_with_tasks() {
        let vm = StatusBarViewModel::new();

        vm.update_agent(UIAgentState::Executing, 5).await;
        let state = vm.get_state().await;

        assert_eq!(state.agent_state, UIAgentState::Executing);
        assert_eq!(state.agent_task_count, 5);
    }

    #[tokio::test]
    async fn test_reset() {
        let vm = StatusBarViewModel::new();

        vm.update_connection(UIConnectionState::Connected).await;
        vm.update_agent(UIAgentState::Executing, 3).await;
        vm.reset().await;

        let state = vm.get_state().await;
        assert_eq!(state.connection_state, UIConnectionState::Disconnected);
        assert_eq!(state.agent_state, UIAgentState::Offline);
        assert_eq!(state.agent_task_count, 0);
    }
}
