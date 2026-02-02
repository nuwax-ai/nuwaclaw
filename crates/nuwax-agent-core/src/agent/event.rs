//! Agent 事件定义

use super::task::{TaskProgress, TaskResult};

/// Agent 事件
#[derive(Debug, Clone)]
pub enum AgentEvent {
    /// 任务已创建
    TaskCreated(String),
    /// 任务已开始
    TaskStarted(String),
    /// 任务进度更新
    TaskProgress(TaskProgress),
    /// 任务已完成
    TaskCompleted(TaskResult),
    /// 任务已取消
    TaskCancelled(String),
    /// Agent 状态变更
    StateChanged(AgentManagerState),
}

/// AgentManager 状态
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum AgentManagerState {
    /// 空闲（无活跃任务）
    Idle,
    /// 忙碌（有活跃任务）
    Busy(usize),
    /// 停止
    Stopped,
}
