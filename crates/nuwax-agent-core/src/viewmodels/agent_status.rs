//! Agent 状态 ViewModel
//!
//! 负责管理 Agent 状态的显示和用户交互

use std::sync::Arc;
use tokio::sync::RwLock;

use async_trait::async_trait;

pub use super::super::api::traits::agent_status::{AgentStatusApi, UIAgentState};

/// Agent 状态 ViewModel
#[derive(Clone)]
pub struct AgentStatusViewModel {
    /// 状态
    state: Arc<RwLock<UIAgentState>>,
    /// 任务数量
    task_count: Arc<RwLock<u32>>,
    /// 最后活动时间
    #[allow(dead_code)]
    last_active: Arc<RwLock<Option<chrono::DateTime<chrono::Utc>>>>,
}

impl Default for AgentStatusViewModel {
    fn default() -> Self {
        Self::new()
    }
}

impl AgentStatusViewModel {
    /// 创建新的 ViewModel
    pub fn new() -> Self {
        Self {
            state: Arc::new(RwLock::new(UIAgentState::Offline)),
            task_count: Arc::new(RwLock::new(0)),
            last_active: Arc::new(RwLock::new(None)),
        }
    }

    /// 获取当前状态
    pub async fn state(&self) -> UIAgentState {
        *self.state.read().await
    }

    /// 设置状态
    pub async fn set_state(&self, state: UIAgentState) {
        *self.state.write().await = state;
    }

    /// 获取任务数量
    pub async fn task_count(&self) -> u32 {
        *self.task_count.read().await
    }

    /// 增加任务计数
    pub async fn increment_task_count(&self) {
        let mut count = self.task_count.write().await;
        *count += 1;
    }

    /// 重置任务计数
    pub async fn reset_task_count(&self) {
        *self.task_count.write().await = 0;
    }

    /// 获取状态标签
    pub async fn status_label(&self) -> &'static str {
        match self.state().await {
            UIAgentState::Idle => "空闲",
            UIAgentState::Connecting => "连接中...",
            UIAgentState::Executing => "执行中",
            UIAgentState::Paused => "已暂停",
            UIAgentState::Completed => "已完成",
            UIAgentState::Error => "错误",
            UIAgentState::Offline => "离线",
        }
    }
}

/// Agent 操作
#[derive(Debug, Clone)]
pub enum AgentStatusAction {
    /// 切换到空闲状态
    SetIdle,
    /// 切换到连接中状态
    SetConnecting,
    /// 开始执行
    StartExecuting,
    /// 暂停执行
    PauseExecuting,
    /// 完成执行
    CompleteExecuting,
    /// 设置错误状态
    SetError(String),
    /// 设置离线状态
    SetOffline,
    /// 增加任务计数
    IncrementTask,
    /// 重置任务计数
    ResetTask,
}

/// Agent 状态 ViewModel
pub type AgentStatusViewModelState = UIAgentState;

#[async_trait]
impl AgentStatusApi for AgentStatusViewModel {
    type State = UIAgentState;

    async fn state(&self) -> Self::State {
        *self.state.read().await
    }

    fn state_snapshot(&self) -> Self::State {
        futures::executor::block_on(self.state())
    }

    async fn set_state(&self, state: UIAgentState) {
        *self.state.write().await = state;
    }

    async fn increment_task_count(&self) {
        let mut count = self.task_count.write().await;
        *count += 1;
    }

    async fn reset_task_count(&self) {
        *self.task_count.write().await = 0;
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn test_agent_status_viewmodel() {
        let vm = AgentStatusViewModel::new();
        assert_eq!(vm.state().await, UIAgentState::Offline);
    }

    #[tokio::test]
    async fn test_set_agent_state() {
        let vm = AgentStatusViewModel::new();

        vm.set_state(UIAgentState::Executing).await;
        assert_eq!(vm.state().await, UIAgentState::Executing);

        vm.set_state(UIAgentState::Idle).await;
        assert_eq!(vm.state().await, UIAgentState::Idle);
    }

    #[tokio::test]
    async fn test_task_count() {
        let vm = AgentStatusViewModel::new();
        assert_eq!(vm.task_count().await, 0);

        vm.increment_task_count().await;
        assert_eq!(vm.task_count().await, 1);

        vm.increment_task_count().await;
        assert_eq!(vm.task_count().await, 2);

        vm.reset_task_count().await;
        assert_eq!(vm.task_count().await, 0);
    }
}
