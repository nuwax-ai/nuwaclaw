//! Agent 管理器核心逻辑

use std::sync::Arc;

use chrono::{DateTime, Utc};
use dashmap::DashMap;
use tokio::sync::{broadcast, mpsc};
use tokio_util::sync::CancellationToken;
use tracing::{debug, info};

use crate::business_channel::{BusinessChannel, BusinessMessage, MessageType};

use super::converter::CancelRequest;
use super::error::AgentError;
use super::event::{AgentEvent, AgentManagerState};
use super::executor::{DefaultTaskExecutor, TaskExecutor};
use super::task::{AgentTask, TaskProgress, TaskResult, TaskStatus};

/// 任务运行时信息（内部跟踪）
struct TaskRuntime {
    /// 任务信息
    task: AgentTask,
    /// 当前状态
    status: TaskStatus,
    /// 最新进度
    progress: Option<TaskProgress>,
    /// 取消令牌
    cancel_token: CancellationToken,
    /// 开始执行时间
    started_at: Option<DateTime<Utc>>,
    /// 结果
    result: Option<TaskResult>,
}

/// Agent 管理器
///
/// 使用 DashMap 进行并发任务管理，支持：
/// - 多任务并发执行
/// - 进度实时回传
/// - 任务取消
/// - 任务状态查询
pub struct AgentManager {
    /// 任务存储 (task_id -> TaskRuntime)
    tasks: Arc<DashMap<String, TaskRuntime>>,
    /// 事件广播通道
    event_tx: broadcast::Sender<AgentEvent>,
    /// 任务执行器
    executor: Arc<dyn TaskExecutor>,
    /// 业务通道引用（用于发送进度和结果）
    business_channel: Option<Arc<BusinessChannel>>,
    /// 最大并发任务数
    max_concurrent_tasks: usize,
    /// 当前活跃任务数
    active_count: Arc<std::sync::atomic::AtomicUsize>,
}

impl AgentManager {
    /// 创建新的 Agent 管理器
    pub fn new() -> Self {
        let (event_tx, _) = broadcast::channel(256);
        Self {
            tasks: Arc::new(DashMap::new()),
            event_tx,
            executor: Arc::new(DefaultTaskExecutor),
            business_channel: None,
            max_concurrent_tasks: 10,
            active_count: Arc::new(std::sync::atomic::AtomicUsize::new(0)),
        }
    }

    /// 设置任务执行器
    pub fn with_executor(mut self, executor: impl TaskExecutor + 'static) -> Self {
        self.executor = Arc::new(executor);
        self
    }

    /// 设置业务通道
    pub fn with_business_channel(mut self, channel: Arc<BusinessChannel>) -> Self {
        self.business_channel = Some(channel);
        self
    }

    /// 设置最大并发任务数
    pub fn with_max_concurrent(mut self, max: usize) -> Self {
        self.max_concurrent_tasks = max;
        self
    }

    /// 订阅事件
    pub fn subscribe(&self) -> broadcast::Receiver<AgentEvent> {
        self.event_tx.subscribe()
    }

    /// 提交任务
    pub async fn submit_task(&self, task: AgentTask) -> Result<String, AgentError> {
        let task_id = task.id.clone();

        // 检查并发限制
        let active = self.active_count.load(std::sync::atomic::Ordering::Acquire);
        if active >= self.max_concurrent_tasks {
            return Err(AgentError::MaxConcurrencyReached(self.max_concurrent_tasks));
        }

        // 检查重复
        if self.tasks.contains_key(&task_id) {
            return Err(AgentError::TaskAlreadyRunning(task_id));
        }

        let cancel_token = CancellationToken::new();
        let runtime = TaskRuntime {
            task: task.clone(),
            status: TaskStatus::Pending,
            progress: None,
            cancel_token: cancel_token.clone(),
            started_at: None,
            result: None,
        };

        // 使用 entry API 插入
        self.tasks.entry(task_id.clone()).or_insert(runtime);

        // 发送事件
        let _ = self.event_tx.send(AgentEvent::TaskCreated(task_id.clone()));

        // 启动执行
        self.spawn_task_execution(task, cancel_token).await;

        info!("Task submitted: {}", task_id);
        Ok(task_id)
    }

    /// 从 BusinessMessage 提交任务
    pub async fn submit_from_message(
        &self,
        message: &BusinessMessage,
    ) -> Result<String, AgentError> {
        let task = AgentTask::from_business_message(message)?;
        self.submit_task(task).await
    }

    /// 取消任务
    pub fn cancel_task(&self, task_id: &str) -> Result<(), AgentError> {
        let entry = self
            .tasks
            .get(task_id)
            .ok_or_else(|| AgentError::TaskNotFound(task_id.to_string()))?;

        if entry.status.is_terminal() {
            return Ok(()); // 已经结束
        }

        entry.cancel_token.cancel();
        drop(entry);

        // 更新状态
        if let Some(mut entry) = self.tasks.get_mut(task_id) {
            entry.status = TaskStatus::Cancelled;
        }

        let _ = self
            .event_tx
            .send(AgentEvent::TaskCancelled(task_id.to_string()));
        info!("Task cancelled: {}", task_id);
        Ok(())
    }

    /// 获取任务状态
    pub fn get_task_status(&self, task_id: &str) -> Option<TaskStatus> {
        self.tasks.get(task_id).map(|entry| entry.status)
    }

    /// 获取任务进度
    pub fn get_task_progress(&self, task_id: &str) -> Option<TaskProgress> {
        self.tasks
            .get(task_id)
            .and_then(|entry| entry.progress.clone())
    }

    /// 获取任务结果
    pub fn get_task_result(&self, task_id: &str) -> Option<TaskResult> {
        self.tasks
            .get(task_id)
            .and_then(|entry| entry.result.clone())
    }

    /// 获取所有活跃任务 ID
    pub fn active_task_ids(&self) -> Vec<String> {
        self.tasks
            .iter()
            .filter(|entry| matches!(entry.status, TaskStatus::Running | TaskStatus::Pending))
            .map(|entry| entry.key().clone())
            .collect()
    }

    /// 获取活跃任务数
    pub fn active_count(&self) -> usize {
        self.active_count.load(std::sync::atomic::Ordering::Acquire)
    }

    /// 获取总任务数
    pub fn total_count(&self) -> usize {
        self.tasks.len()
    }

    /// 获取当前管理器状态
    pub fn state(&self) -> AgentManagerState {
        let active = self.active_count();
        if active == 0 {
            AgentManagerState::Idle
        } else {
            AgentManagerState::Busy(active)
        }
    }

    /// 清理已完成的任务（保留最近的 N 个）
    pub fn cleanup_completed(&self, keep_count: usize) {
        let mut completed: Vec<(String, DateTime<Utc>)> = self
            .tasks
            .iter()
            .filter(|entry| entry.status.is_terminal())
            .map(|entry| {
                let completed_at = entry
                    .result
                    .as_ref()
                    .map(|r| r.completed_at)
                    .unwrap_or(entry.task.created_at);
                (entry.key().clone(), completed_at)
            })
            .collect();

        // 按完成时间排序，保留最新的
        completed.sort_by(|a, b| b.1.cmp(&a.1));

        for (task_id, _) in completed.into_iter().skip(keep_count) {
            self.tasks.remove(&task_id);
        }
    }

    /// 处理来自 BusinessChannel 的消息
    pub async fn handle_business_message(
        &self,
        message: BusinessMessage,
    ) -> Result<(), AgentError> {
        match message.message_type {
            MessageType::AgentTaskRequest => {
                self.submit_from_message(&message).await?;
            }
            MessageType::TaskCancel => {
                // 从 payload 提取 task_id
                let cancel_req: CancelRequest = serde_json::from_slice(&message.payload)
                    .map_err(|e| AgentError::ConversionFailed(e.to_string()))?;
                self.cancel_task(&cancel_req.task_id)?;
            }
            _ => {
                debug!(
                    "Ignoring non-agent message type: {:?}",
                    message.message_type
                );
            }
        }
        Ok(())
    }

    /// 启动任务执行（异步）
    async fn spawn_task_execution(&self, task: AgentTask, cancel_token: CancellationToken) {
        let task_id = task.id.clone();
        let tasks = self.tasks.clone();
        let executor = self.executor.clone();
        let event_tx = self.event_tx.clone();
        let active_count = self.active_count.clone();
        let business_channel = self.business_channel.clone();

        // 增加活跃计数
        active_count.fetch_add(1, std::sync::atomic::Ordering::Release);

        // 更新状态为 Running
        if let Some(mut entry) = tasks.get_mut(&task_id) {
            entry.status = TaskStatus::Running;
            entry.started_at = Some(Utc::now());
        }
        let _ = event_tx.send(AgentEvent::TaskStarted(task_id.clone()));

        tokio::spawn(async move {
            // 创建进度通道
            let (progress_tx, mut progress_rx) = mpsc::channel::<TaskProgress>(64);

            // 启动进度转发
            let progress_tasks = tasks.clone();
            let progress_event_tx = event_tx.clone();
            let progress_biz = business_channel.clone();
            let progress_task_id = task_id.clone();
            let progress_handle = tokio::spawn(async move {
                while let Some(progress) = progress_rx.recv().await {
                    // 更新内部状态
                    if let Some(mut entry) = progress_tasks.get_mut(&progress_task_id) {
                        entry.progress = Some(progress.clone());
                    }
                    // 发送事件
                    let _ = progress_event_tx.send(AgentEvent::TaskProgress(progress.clone()));
                    // 通过业务通道转发
                    if let Some(ref channel) = progress_biz {
                        if let Ok(msg) = progress.to_business_message() {
                            let _ = channel.send(msg).await;
                        }
                    }
                }
            });

            // 执行任务
            let result = if let Some(timeout_ms) = task.timeout_ms {
                let timeout = std::time::Duration::from_millis(timeout_ms);
                match tokio::time::timeout(
                    timeout,
                    executor.execute(&task, progress_tx.clone(), cancel_token.clone()),
                )
                .await
                {
                    Ok(r) => r,
                    Err(_) => Err(AgentError::ExecutionFailed("任务执行超时".to_string())),
                }
            } else {
                executor
                    .execute(&task, progress_tx.clone(), cancel_token.clone())
                    .await
            };

            // 等待进度转发完成
            progress_handle.abort();

            // 更新任务状态
            let (status, task_result) = match result {
                Ok(result) => (TaskStatus::Completed, result),
                Err(AgentError::TaskCancelled) => {
                    let result = TaskResult::failure(&task_id, "任务已取消", 0);
                    (TaskStatus::Cancelled, result)
                }
                Err(e) => {
                    let result = TaskResult::failure(&task_id, e.to_string(), 0);
                    (TaskStatus::Failed, result)
                }
            };

            if let Some(mut entry) = tasks.get_mut(&task_id) {
                entry.status = status;
                entry.result = Some(task_result.clone());
            }

            // 发送结果事件
            let _ = event_tx.send(AgentEvent::TaskCompleted(task_result.clone()));

            // 通过业务通道发送结果
            if let Some(ref channel) = business_channel {
                if let Ok(msg) = task_result.to_business_message() {
                    let _ = channel.send(msg).await;
                }
            }

            // 减少活跃计数
            active_count.fetch_sub(1, std::sync::atomic::Ordering::Release);

            debug!(
                "Task execution completed: {} (status: {:?})",
                task_id, status
            );
        });
    }
}

impl Default for AgentManager {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::agent::task::TaskPriority;

    #[test]
    fn test_task_creation() {
        let task = AgentTask::new("test_type", vec![1, 2, 3], "admin-1");
        assert_eq!(task.task_type, "test_type");
        assert_eq!(task.payload, vec![1, 2, 3]);
        assert_eq!(task.source_id, "admin-1");
        assert_eq!(task.priority, TaskPriority::Normal);
        assert!(task.timeout_ms.is_none());
    }

    #[test]
    fn test_task_with_options() {
        let task = AgentTask::new("test", vec![], "admin")
            .with_priority(TaskPriority::High)
            .with_timeout(5000);
        assert_eq!(task.priority, TaskPriority::High);
        assert_eq!(task.timeout_ms, Some(5000));
    }

    #[test]
    fn test_task_serialization_roundtrip() {
        let task = AgentTask::new("install_deps", b"{}".to_vec(), "admin-1")
            .with_priority(TaskPriority::Critical);
        let bytes = serde_json::to_vec(&task).unwrap();
        let decoded: AgentTask = serde_json::from_slice(&bytes).unwrap();
        assert_eq!(task.id, decoded.id);
        assert_eq!(task.task_type, decoded.task_type);
        assert_eq!(task.priority, decoded.priority);
    }

    #[test]
    fn test_progress_creation() {
        let progress = TaskProgress::new("task-1", 50, "处理中").with_stage("parsing");
        assert_eq!(progress.task_id, "task-1");
        assert_eq!(progress.percentage, 50);
        assert_eq!(progress.stage, Some("parsing".to_string()));
    }

    #[test]
    fn test_progress_clamped_to_100() {
        let progress = TaskProgress::new("task-1", 150, "完成");
        assert_eq!(progress.percentage, 100);
    }

    #[test]
    fn test_task_result_success() {
        let result = TaskResult::success("task-1", Some(b"ok".to_vec()), 1500);
        assert!(result.success);
        assert!(result.error.is_none());
        assert_eq!(result.duration_ms, 1500);
    }

    #[test]
    fn test_task_result_failure() {
        let result = TaskResult::failure("task-1", "timeout", 3000);
        assert!(!result.success);
        assert_eq!(result.error, Some("timeout".to_string()));
    }

    #[test]
    fn test_task_status_terminal() {
        assert!(!TaskStatus::Pending.is_terminal());
        assert!(!TaskStatus::Running.is_terminal());
        assert!(TaskStatus::Completed.is_terminal());
        assert!(TaskStatus::Failed.is_terminal());
        assert!(TaskStatus::Cancelled.is_terminal());
    }

    #[test]
    fn test_message_converter_task_roundtrip() {
        use crate::agent::converter::MessageConverter;
        let task = AgentTask::new("test", vec![42], "admin");
        let msg = MessageConverter::task_to_message(&task).unwrap();
        assert_eq!(msg.message_type, MessageType::AgentTaskRequest);
        let decoded = MessageConverter::message_to_task(&msg).unwrap();
        assert_eq!(task.id, decoded.id);
        assert_eq!(task.task_type, decoded.task_type);
    }

    #[test]
    fn test_message_converter_progress() {
        use crate::agent::converter::MessageConverter;
        let progress = TaskProgress::new("task-1", 75, "Almost done");
        let msg = MessageConverter::progress_to_message(&progress).unwrap();
        assert_eq!(msg.message_type, MessageType::TaskProgress);
        let decoded = MessageConverter::message_to_progress(&msg).unwrap();
        assert_eq!(progress.task_id, decoded.task_id);
        assert_eq!(progress.percentage, decoded.percentage);
    }

    #[test]
    fn test_message_converter_result() {
        use crate::agent::converter::MessageConverter;
        let result = TaskResult::success("task-1", None, 100);
        let msg = MessageConverter::result_to_message(&result).unwrap();
        assert_eq!(msg.message_type, MessageType::AgentTaskResponse);
        let decoded = MessageConverter::message_to_result(&msg).unwrap();
        assert_eq!(result.task_id, decoded.task_id);
        assert!(decoded.success);
    }

    #[test]
    fn test_message_converter_cancel() {
        use crate::agent::converter::CancelRequest;
        use crate::agent::converter::MessageConverter;
        let msg = MessageConverter::cancel_to_message("task-123").unwrap();
        assert_eq!(msg.message_type, MessageType::TaskCancel);
        let req: CancelRequest = serde_json::from_slice(&msg.payload).unwrap();
        assert_eq!(req.task_id, "task-123");
    }

    #[tokio::test]
    async fn test_agent_manager_creation() {
        let manager = AgentManager::new();
        assert_eq!(manager.active_count(), 0);
        assert_eq!(manager.total_count(), 0);
        assert_eq!(manager.state(), AgentManagerState::Idle);
    }

    #[tokio::test]
    async fn test_agent_manager_submit_and_execute() {
        let manager = AgentManager::new();
        let task = AgentTask::new("test", vec![], "admin");
        let task_id = manager.submit_task(task).await.unwrap();

        // 等待执行完成
        tokio::time::sleep(std::time::Duration::from_millis(500)).await;

        let status = manager.get_task_status(&task_id).unwrap();
        assert_eq!(status, TaskStatus::Completed);

        let result = manager.get_task_result(&task_id).unwrap();
        assert!(result.success);
    }

    #[tokio::test]
    async fn test_agent_manager_cancel() {
        // 使用慢执行器测试取消
        struct SlowExecutor;

        #[async_trait::async_trait]
        impl TaskExecutor for SlowExecutor {
            async fn execute(
                &self,
                task: &AgentTask,
                _progress_tx: mpsc::Sender<TaskProgress>,
                cancel_token: CancellationToken,
            ) -> Result<TaskResult, AgentError> {
                tokio::select! {
                    _ = tokio::time::sleep(std::time::Duration::from_secs(10)) => {
                        Ok(TaskResult::success(&task.id, None, 10000))
                    }
                    _ = cancel_token.cancelled() => {
                        Err(AgentError::TaskCancelled)
                    }
                }
            }
        }

        let manager = AgentManager::new().with_executor(SlowExecutor);
        let task = AgentTask::new("slow_task", vec![], "admin");
        let task_id = manager.submit_task(task).await.unwrap();

        // 等待任务开始
        tokio::time::sleep(std::time::Duration::from_millis(50)).await;

        // 取消
        manager.cancel_task(&task_id).unwrap();

        // 等待取消生效
        tokio::time::sleep(std::time::Duration::from_millis(100)).await;

        let status = manager.get_task_status(&task_id).unwrap();
        assert_eq!(status, TaskStatus::Cancelled);
    }

    #[tokio::test]
    async fn test_agent_manager_events() {
        let manager = AgentManager::new();
        let mut rx = manager.subscribe();

        let task = AgentTask::new("test", vec![], "admin");
        let _task_id = manager.submit_task(task).await.unwrap();

        // 应该收到 TaskCreated 事件
        let event = tokio::time::timeout(std::time::Duration::from_millis(100), rx.recv()).await;
        assert!(event.is_ok());
        assert!(matches!(
            event.unwrap().unwrap(),
            AgentEvent::TaskCreated(_)
        ));
    }

    #[tokio::test]
    async fn test_agent_manager_max_concurrency() {
        struct NeverFinishExecutor;

        #[async_trait::async_trait]
        impl TaskExecutor for NeverFinishExecutor {
            async fn execute(
                &self,
                _task: &AgentTask,
                _progress_tx: mpsc::Sender<TaskProgress>,
                cancel_token: CancellationToken,
            ) -> Result<TaskResult, AgentError> {
                cancel_token.cancelled().await;
                Err(AgentError::TaskCancelled)
            }
        }

        let manager = AgentManager::new()
            .with_executor(NeverFinishExecutor)
            .with_max_concurrent(2);

        // 提交 2 个任务应该成功
        let t1 = AgentTask::new("task1", vec![], "admin");
        let t2 = AgentTask::new("task2", vec![], "admin");
        manager.submit_task(t1).await.unwrap();
        manager.submit_task(t2).await.unwrap();

        // 等待任务开始
        tokio::time::sleep(std::time::Duration::from_millis(50)).await;

        // 第 3 个应该失败
        let t3 = AgentTask::new("task3", vec![], "admin");
        let result = manager.submit_task(t3).await;
        assert!(matches!(result, Err(AgentError::MaxConcurrencyReached(2))));
    }

    #[test]
    fn test_agent_manager_cleanup() {
        let rt = tokio::runtime::Runtime::new().unwrap();
        rt.block_on(async {
            let manager = AgentManager::new();

            // 提交多个任务
            for i in 0..5 {
                let task = AgentTask::new(format!("task-{}", i), vec![], "admin");
                manager.submit_task(task).await.unwrap();
            }

            // 等待全部完成
            tokio::time::sleep(std::time::Duration::from_secs(1)).await;

            assert_eq!(manager.total_count(), 5);

            // 清理，只保留 2 个
            manager.cleanup_completed(2);
            assert_eq!(manager.total_count(), 2);
        });
    }
}
