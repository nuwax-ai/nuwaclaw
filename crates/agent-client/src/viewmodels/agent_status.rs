//! Agent 状态 ViewModel
//!
//! 专门管理 Agent 状态的 UI 展示

use std::sync::Arc;
use tokio::sync::RwLock;

/// UI 层的 Agent 状态
#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub enum UIAgentState {
    /// 空闲
    #[default]
    Idle,
    /// 运行中（活跃任务数）
    Active(usize),
    /// 执行中（当前/总数）
    Executing(usize, usize),
    /// 错误
    Error,
}

impl UIAgentState {
    /// 获取状态图标
    pub fn icon(&self) -> gpui_component::IconName {
        match self {
            Self::Idle => gpui_component::IconName::Dash,
            Self::Active(_) => gpui_component::IconName::Bot,
            Self::Executing(_, _) => gpui_component::IconName::Loader,
            Self::Error => gpui_component::IconName::TriangleAlert,
        }
    }

    /// 获取状态标签
    pub fn label(&self) -> String {
        match self {
            Self::Idle => "空闲".to_string(),
            Self::Active(count) => format!("活跃 ({})", count),
            Self::Executing(current, total) => format!("执行中 ({}/{})", current, total),
            Self::Error => "错误".to_string(),
        }
    }
}

/// Agent 状态 ViewModel 状态
#[derive(Debug, Clone, Default)]
pub struct AgentStatusViewModelState {
    /// Agent 状态
    pub agent_state: UIAgentState,
    /// 活跃任务数
    pub active_task_count: usize,
}

impl AgentStatusViewModelState {
    /// 创建默认状态
    pub fn new() -> Self {
        Self::default()
    }
}

/// Agent 状态操作
#[derive(Debug, Clone)]
pub enum AgentStatusAction {
    /// 更新 Agent 状态
    SetAgentState(UIAgentState),
    /// 更新活跃任务数
    SetActiveTaskCount(usize),
    /// 增加活跃任务
    IncrementActiveTasks,
    /// 减少活跃任务
    DecrementActiveTasks,
}

/// Agent 状态 ViewModel
///
/// 专门负责：
/// - 管理 Agent 状态的 UI 展示
/// - 处理 Agent 状态更新操作
/// - 提供只读的 Agent 状态供组件使用
#[derive(Clone)]
pub struct AgentStatusViewModel {
    /// Agent 状态
    state: Arc<RwLock<AgentStatusViewModelState>>,
}

impl AgentStatusViewModel {
    /// 创建新的 ViewModel
    pub fn new() -> Self {
        Self {
            state: Arc::new(RwLock::new(AgentStatusViewModelState::new())),
        }
    }

    /// 获取当前状态的快照
    pub async fn get_state(&self) -> AgentStatusViewModelState {
        self.state.read().await.clone()
    }

    /// 获取 Agent 状态
    pub async fn agent_state(&self) -> UIAgentState {
        self.state.read().await.agent_state.clone()
    }

    /// 获取活跃任务数
    pub async fn active_task_count(&self) -> usize {
        self.state.read().await.active_task_count
    }

    /// 处理状态更新操作
    pub async fn handle_action(&self, action: AgentStatusAction) {
        let mut state = self.state.write().await;
        match action {
            AgentStatusAction::SetAgentState(new_state) => {
                state.agent_state = new_state;
            }
            AgentStatusAction::SetActiveTaskCount(count) => {
                state.active_task_count = count;
            }
            AgentStatusAction::IncrementActiveTasks => {
                state.active_task_count += 1;
            }
            AgentStatusAction::DecrementActiveTasks => {
                state.active_task_count = state.active_task_count.saturating_sub(1);
            }
        }
    }

    /// 更新 Agent 状态
    pub async fn set_agent_state(&self, state: UIAgentState) {
        let mut inner = self.state.write().await;
        inner.agent_state = state;
    }

    /// 更新活跃任务数
    pub async fn set_active_task_count(&self, count: usize) {
        let mut inner = self.state.write().await;
        inner.active_task_count = count;
    }
}

impl Default for AgentStatusViewModel {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_ui_agent_state_icon() {
        assert_eq!(UIAgentState::Idle.icon(), gpui_component::IconName::Dash);
        assert_eq!(UIAgentState::Active(1).icon(), gpui_component::IconName::Bot);
        assert_eq!(
            UIAgentState::Executing(1, 2).icon(),
            gpui_component::IconName::Loader
        );
        assert_eq!(UIAgentState::Error.icon(), gpui_component::IconName::TriangleAlert);
    }

    #[test]
    fn test_ui_agent_state_label() {
        assert_eq!(UIAgentState::Idle.label(), "空闲");
        assert_eq!(UIAgentState::Active(3).label(), "活跃 (3)");
        assert_eq!(UIAgentState::Executing(2, 5).label(), "执行中 (2/5)");
        assert_eq!(UIAgentState::Error.label(), "错误");
    }

    #[tokio::test]
    async fn test_viewmodel_creation() {
        let vm = AgentStatusViewModel::new();
        let state = vm.get_state().await;

        assert_eq!(state.agent_state, UIAgentState::Idle);
        assert_eq!(state.active_task_count, 0);
    }

    #[tokio::test]
    async fn test_set_agent_state() {
        let vm = AgentStatusViewModel::new();

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
    async fn test_task_count_operations() {
        let vm = AgentStatusViewModel::new();

        assert_eq!(vm.active_task_count().await, 0);

        vm.set_active_task_count(5).await;
        assert_eq!(vm.active_task_count().await, 5);

        vm.handle_action(AgentStatusAction::IncrementActiveTasks).await;
        assert_eq!(vm.active_task_count().await, 6);

        vm.handle_action(AgentStatusAction::DecrementActiveTasks).await;
        assert_eq!(vm.active_task_count().await, 5);

        // 不会低于 0
        vm.handle_action(AgentStatusAction::DecrementActiveTasks).await;
        vm.handle_action(AgentStatusAction::DecrementActiveTasks).await;
        assert_eq!(vm.active_task_count().await, 3);
    }

    #[tokio::test]
    async fn test_handle_action() {
        let vm = AgentStatusViewModel::new();

        vm.handle_action(AgentStatusAction::SetAgentState(UIAgentState::Active(5)))
            .await;
        vm.handle_action(AgentStatusAction::SetActiveTaskCount(5))
            .await;

        let state = vm.get_state().await;
        assert_eq!(state.agent_state, UIAgentState::Active(5));
        assert_eq!(state.active_task_count, 5);
    }
}
