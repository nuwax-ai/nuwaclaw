//! Agent 管理模块
//!
//! 管理 Agent 任务的生命周期，包括：
//! - 任务创建、执行、取消
//! - 进度回传
//! - 消息转换（BusinessChannel <-> AgentTask）
//! - 并发任务管理（使用 DashMap）

pub mod converter;
pub mod error;
pub mod event;
pub mod executor;
pub mod manager;
pub mod task;

// 重导出常用类型，保持向后兼容
pub use converter::{CancelRequest, MessageConverter};
pub use error::AgentError;
pub use event::{AgentEvent, AgentManagerState};
pub use executor::{DefaultTaskExecutor, TaskExecutor};
pub use manager::AgentManager;
pub use task::{AgentTask, TaskPriority, TaskProgress, TaskResult, TaskStatus};
