//! 任务执行器 trait 和默认实现

use tokio::sync::mpsc;
use tokio_util::sync::CancellationToken;
use tracing::info;

use super::error::AgentError;
use super::task::{AgentTask, TaskProgress, TaskResult};

/// Agent 任务执行器 trait
///
/// 实现此 trait 以支持不同的执行后端：
/// - 本地子进程执行
/// - gRPC 连接到 agent_runner
/// - 模拟执行（测试用）
#[async_trait::async_trait]
pub trait TaskExecutor: Send + Sync {
    /// 执行任务
    async fn execute(
        &self,
        task: &AgentTask,
        progress_tx: mpsc::Sender<TaskProgress>,
        cancel_token: CancellationToken,
    ) -> Result<TaskResult, AgentError>;
}

/// 默认任务执行器（模拟执行，用于开发/测试）
pub struct DefaultTaskExecutor;

#[async_trait::async_trait]
impl TaskExecutor for DefaultTaskExecutor {
    async fn execute(
        &self,
        task: &AgentTask,
        progress_tx: mpsc::Sender<TaskProgress>,
        cancel_token: CancellationToken,
    ) -> Result<TaskResult, AgentError> {
        let task_id = task.id.clone();
        let task_type = task.task_type.clone();

        info!("Executing task: {} (type: {})", task_id, task_type);
        let start = std::time::Instant::now();

        // 模拟分阶段执行
        let stages = ["初始化", "处理中", "完成"];
        for (i, stage) in stages.iter().enumerate() {
            // 检查取消
            if cancel_token.is_cancelled() {
                return Err(AgentError::TaskCancelled);
            }

            let percentage = ((i + 1) * 100 / stages.len()) as u8;
            let progress = TaskProgress::new(&task_id, percentage, format!("阶段: {}", stage))
                .with_stage(stage.to_string());
            let _ = progress_tx.send(progress).await;

            // 模拟执行时间
            tokio::select! {
                _ = tokio::time::sleep(std::time::Duration::from_millis(100)) => {}
                _ = cancel_token.cancelled() => {
                    return Err(AgentError::TaskCancelled);
                }
            }
        }

        let duration_ms = start.elapsed().as_millis() as u64;
        Ok(TaskResult::success(&task_id, None, duration_ms))
    }
}
