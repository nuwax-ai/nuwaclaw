//! 状态栏 ViewModel
//!
//! 负责管理状态栏的显示和状态更新

use std::sync::Arc;
use tokio::sync::RwLock;

/// 状态栏状态
#[derive(Debug, Clone, Default)]
pub struct StatusBarViewModelState {
    /// 连接状态文本
    pub connection_text: String,
    /// Agent 状态文本
    pub agent_text: String,
    /// 依赖状态文本
    pub dependency_text: String,
    /// 是否有更新
    pub has_update: bool,
    /// 是否显示加载动画
    pub is_loading: bool,
}

/// 状态栏操作
#[derive(Debug, Clone)]
pub enum StatusBarAction {
    /// 更新连接状态
    UpdateConnection(String),
    /// 更新 Agent 状态
    UpdateAgent(String),
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
    pub async fn update_connection(&self, text: String) {
        self.state.write().await.connection_text = text;
    }

    /// 更新 Agent 状态
    pub async fn update_agent(&self, text: String) {
        self.state.write().await.agent_text = text;
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
        state.connection_text = "未连接".to_string();
        state.agent_text = "就绪".to_string();
        state.dependency_text = "依赖正常".to_string();
        state.has_update = false;
        state.is_loading = false;
    }

    /// 处理状态栏操作
    pub async fn handle_action(&self, action: StatusBarAction) {
        match action {
            StatusBarAction::UpdateConnection(text) => self.update_connection(text).await,
            StatusBarAction::UpdateAgent(text) => self.update_agent(text).await,
            StatusBarAction::UpdateDependency(text) => self.update_dependency(text).await,
            StatusBarAction::SetUpdateAvailable(available) => {
                self.set_update_available(available).await
            }
            StatusBarAction::SetLoading(loading) => self.set_loading(loading).await,
            StatusBarAction::Reset => self.reset().await,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn test_status_bar_viewmodel_creation() {
        let vm = StatusBarViewModel::new();
        let state = vm.get_state().await;

        assert_eq!(state.connection_text, "未连接");
        assert_eq!(state.agent_text, "就绪");
        assert_eq!(state.dependency_text, "依赖正常");
        assert!(!state.has_update);
        assert!(!state.is_loading);
    }

    #[tokio::test]
    async fn test_update_connection() {
        let vm = StatusBarViewModel::new();

        vm.update_connection("已连接".to_string()).await;
        let state = vm.get_state().await;

        assert_eq!(state.connection_text, "已连接");
    }

    #[tokio::test]
    async fn test_reset() {
        let vm = StatusBarViewModel::new();

        vm.update_connection("测试".to_string()).await;
        vm.update_agent("测试".to_string()).await;
        vm.reset().await;

        let state = vm.get_state().await;
        assert_eq!(state.connection_text, "未连接");
        assert_eq!(state.agent_text, "就绪");
    }
}
