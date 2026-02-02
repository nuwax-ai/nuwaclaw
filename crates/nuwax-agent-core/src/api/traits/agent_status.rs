//! AgentStatusApi Trait
//!
//! 定义 Agent 状态 ViewModel 的接口

use serde::Serialize;

pub use super::status_bar::UIAgentState;

/// AgentStatusApi Trait
///
/// 定义 Agent 状态 ViewModel 的所有可用操作。
#[async_trait::async_trait]
pub trait AgentStatusApi {
    /// 状态类型（必须可序列化）
    type State: Serialize + Clone + Send + 'static;

    /// 获取当前状态
    async fn state(&self) -> Self::State;

    /// 同步获取状态快照（用于 Tauri 命令）
    fn state_snapshot(&self) -> Self::State;

    /// 设置状态
    async fn set_state(&self, state: UIAgentState);

    /// 增加任务计数
    async fn increment_task_count(&self);

    /// 重置任务计数
    async fn reset_task_count(&self);
}
