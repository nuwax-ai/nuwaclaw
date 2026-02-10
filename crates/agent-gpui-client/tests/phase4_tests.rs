//! Phase 4 单元测试 - Agent 运行时
//!
//! 测试 AgentManager、消息转换、任务执行、进度回传、取消功能

#[cfg(test)]
mod agent_task_tests {
    use nuwax_agent::core::agent::{AgentTask, TaskPriority, TaskStatus};

    #[test]
    fn test_task_creation() {
        let task = AgentTask::new("run_command", vec![1, 2, 3], "admin-1");
        assert_eq!(task.task_type, "run_command");
        assert_eq!(task.payload, vec![1, 2, 3]);
        assert_eq!(task.source_id, "admin-1");
        assert!(!task.id.is_empty());
    }

    #[test]
    fn test_task_with_priority() {
        let task = AgentTask::new("test", vec![], "admin").with_priority(TaskPriority::Critical);
        assert_eq!(task.priority, TaskPriority::Critical);
    }

    #[test]
    fn test_task_with_timeout() {
        let task = AgentTask::new("test", vec![], "admin").with_timeout(5000);
        assert_eq!(task.timeout_ms, Some(5000));
    }

    #[test]
    fn test_task_serialization_roundtrip() {
        let task = AgentTask::new("install", b"{}".to_vec(), "admin")
            .with_priority(TaskPriority::High)
            .with_timeout(3000);
        let bytes = serde_json::to_vec(&task).unwrap();
        let decoded: AgentTask = serde_json::from_slice(&bytes).unwrap();
        assert_eq!(task.id, decoded.id);
        assert_eq!(task.task_type, decoded.task_type);
        assert_eq!(task.priority, decoded.priority);
        assert_eq!(task.timeout_ms, decoded.timeout_ms);
    }

    #[test]
    fn test_priority_ordering() {
        assert!(TaskPriority::Low < TaskPriority::Normal);
        assert!(TaskPriority::Normal < TaskPriority::High);
        assert!(TaskPriority::High < TaskPriority::Critical);
    }

    #[test]
    fn test_task_status_terminal() {
        assert!(!TaskStatus::Pending.is_terminal());
        assert!(!TaskStatus::Running.is_terminal());
        assert!(TaskStatus::Completed.is_terminal());
        assert!(TaskStatus::Failed.is_terminal());
        assert!(TaskStatus::Cancelled.is_terminal());
    }
}

#[cfg(test)]
mod task_progress_tests {
    use nuwax_agent::core::agent::TaskProgress;

    #[test]
    fn test_progress_creation() {
        let progress = TaskProgress::new("task-1", 50, "Processing...");
        assert_eq!(progress.task_id, "task-1");
        assert_eq!(progress.percentage, 50);
        assert_eq!(progress.message, "Processing...");
        assert!(progress.stage.is_none());
    }

    #[test]
    fn test_progress_with_stage() {
        let progress = TaskProgress::new("task-1", 75, "Almost done").with_stage("compilation");
        assert_eq!(progress.stage, Some("compilation".to_string()));
    }

    #[test]
    fn test_progress_clamped() {
        let progress = TaskProgress::new("task-1", 200, "Over 100");
        assert_eq!(progress.percentage, 100);
    }

    #[test]
    fn test_progress_serialization() {
        let progress = TaskProgress::new("task-1", 60, "Working").with_stage("step2");
        let bytes = serde_json::to_vec(&progress).unwrap();
        let decoded: TaskProgress = serde_json::from_slice(&bytes).unwrap();
        assert_eq!(progress.task_id, decoded.task_id);
        assert_eq!(progress.percentage, decoded.percentage);
        assert_eq!(progress.stage, decoded.stage);
    }
}

#[cfg(test)]
mod task_result_tests {
    use nuwax_agent::core::agent::TaskResult;

    #[test]
    fn test_success_result() {
        let result = TaskResult::success("task-1", Some(b"ok".to_vec()), 500);
        assert!(result.success);
        assert_eq!(result.task_id, "task-1");
        assert_eq!(result.data, Some(b"ok".to_vec()));
        assert!(result.error.is_none());
        assert_eq!(result.duration_ms, 500);
    }

    #[test]
    fn test_failure_result() {
        let result = TaskResult::failure("task-1", "timeout occurred", 3000);
        assert!(!result.success);
        assert_eq!(result.error, Some("timeout occurred".to_string()));
        assert!(result.data.is_none());
    }

    #[test]
    fn test_result_serialization() {
        let result = TaskResult::success("task-1", None, 100);
        let bytes = serde_json::to_vec(&result).unwrap();
        let decoded: TaskResult = serde_json::from_slice(&bytes).unwrap();
        assert_eq!(result.task_id, decoded.task_id);
        assert_eq!(result.success, decoded.success);
    }
}

#[cfg(test)]
mod message_converter_tests {
    use nuwax_agent::core::agent::{
        AgentTask, CancelRequest, MessageConverter, TaskProgress, TaskResult,
    };
    use nuwax_agent::core::business_channel::MessageType;

    #[test]
    fn test_task_to_message_roundtrip() {
        let task = AgentTask::new("deploy", vec![42], "admin-2");
        let msg = MessageConverter::task_to_message(&task).unwrap();
        assert_eq!(msg.message_type, MessageType::AgentTaskRequest);

        let decoded = MessageConverter::message_to_task(&msg).unwrap();
        assert_eq!(task.id, decoded.id);
        assert_eq!(task.task_type, decoded.task_type);
    }

    #[test]
    fn test_progress_to_message_roundtrip() {
        let progress = TaskProgress::new("task-1", 80, "Almost done");
        let msg = MessageConverter::progress_to_message(&progress).unwrap();
        assert_eq!(msg.message_type, MessageType::TaskProgress);

        let decoded = MessageConverter::message_to_progress(&msg).unwrap();
        assert_eq!(progress.task_id, decoded.task_id);
        assert_eq!(progress.percentage, decoded.percentage);
    }

    #[test]
    fn test_result_to_message_roundtrip() {
        let result = TaskResult::failure("task-2", "out of memory", 5000);
        let msg = MessageConverter::result_to_message(&result).unwrap();
        assert_eq!(msg.message_type, MessageType::AgentTaskResponse);

        let decoded = MessageConverter::message_to_result(&msg).unwrap();
        assert_eq!(result.task_id, decoded.task_id);
        assert!(!decoded.success);
    }

    #[test]
    fn test_cancel_to_message() {
        let msg = MessageConverter::cancel_to_message("task-99").unwrap();
        assert_eq!(msg.message_type, MessageType::TaskCancel);

        let req: CancelRequest = serde_json::from_slice(&msg.payload).unwrap();
        assert_eq!(req.task_id, "task-99");
    }
}

#[cfg(test)]
mod agent_manager_tests {
    use nuwax_agent::core::agent::{
        AgentError, AgentEvent, AgentManager, AgentManagerState, AgentTask, TaskExecutor,
        TaskProgress, TaskResult,
    };
    use tokio::sync::mpsc;
    use tokio_util::sync::CancellationToken;

    #[tokio::test]
    async fn test_manager_creation() {
        let manager = AgentManager::new();
        assert_eq!(manager.active_count(), 0);
        assert_eq!(manager.total_count(), 0);
        assert_eq!(manager.state(), AgentManagerState::Idle);
    }

    #[tokio::test]
    async fn test_submit_and_complete_task() {
        let manager = AgentManager::new();
        let task = AgentTask::new("test", vec![], "admin");
        let task_id = manager.submit_task(task).await.unwrap();

        // DefaultExecutor runs quickly
        tokio::time::sleep(std::time::Duration::from_millis(600)).await;

        let status = manager.get_task_status(&task_id);
        assert!(status.is_some());
        assert!(status.unwrap().is_terminal());

        let result = manager.get_task_result(&task_id);
        assert!(result.is_some());
        assert!(result.unwrap().success);
    }

    #[tokio::test]
    async fn test_cancel_task() {
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
                    _ = tokio::time::sleep(std::time::Duration::from_secs(30)) => {
                        Ok(TaskResult::success(&task.id, None, 30000))
                    }
                    _ = cancel_token.cancelled() => {
                        Err(AgentError::TaskCancelled)
                    }
                }
            }
        }

        let manager = AgentManager::new().with_executor(SlowExecutor);
        let task = AgentTask::new("slow", vec![], "admin");
        let task_id = manager.submit_task(task).await.unwrap();

        tokio::time::sleep(std::time::Duration::from_millis(50)).await;
        manager.cancel_task(&task_id).unwrap();

        tokio::time::sleep(std::time::Duration::from_millis(100)).await;
        let status = manager.get_task_status(&task_id);
        assert!(matches!(
            status,
            Some(nuwax_agent::core::agent::TaskStatus::Cancelled)
        ));
    }

    #[tokio::test]
    async fn test_event_subscription() {
        let manager = AgentManager::new();
        let mut rx = manager.subscribe();

        let task = AgentTask::new("test", vec![], "admin");
        let _id = manager.submit_task(task).await.unwrap();

        let event = tokio::time::timeout(std::time::Duration::from_millis(200), rx.recv()).await;
        assert!(event.is_ok());
        match event.unwrap().unwrap() {
            AgentEvent::TaskCreated(_) => {} // expected
            other => panic!("Expected TaskCreated, got {:?}", other),
        }
    }

    #[tokio::test]
    async fn test_max_concurrency() {
        struct BlockingExecutor;

        #[async_trait::async_trait]
        impl TaskExecutor for BlockingExecutor {
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
            .with_executor(BlockingExecutor)
            .with_max_concurrent(2);

        let t1 = AgentTask::new("task1", vec![], "admin");
        let t2 = AgentTask::new("task2", vec![], "admin");
        manager.submit_task(t1).await.unwrap();
        manager.submit_task(t2).await.unwrap();

        tokio::time::sleep(std::time::Duration::from_millis(50)).await;

        let t3 = AgentTask::new("task3", vec![], "admin");
        let result = manager.submit_task(t3).await;
        assert!(result.is_err());
    }

    #[tokio::test]
    async fn test_active_task_ids() {
        struct BlockingExecutor;

        #[async_trait::async_trait]
        impl TaskExecutor for BlockingExecutor {
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

        let manager = AgentManager::new().with_executor(BlockingExecutor);
        let t1 = AgentTask::new("task1", vec![], "admin");
        let t2 = AgentTask::new("task2", vec![], "admin");
        let id1 = manager.submit_task(t1).await.unwrap();
        let id2 = manager.submit_task(t2).await.unwrap();

        tokio::time::sleep(std::time::Duration::from_millis(50)).await;

        let active = manager.active_task_ids();
        assert!(active.contains(&id1));
        assert!(active.contains(&id2));
    }

    #[tokio::test]
    async fn test_cleanup_completed() {
        let manager = AgentManager::new();

        for i in 0..5 {
            let task = AgentTask::new(format!("task-{}", i), vec![], "admin");
            manager.submit_task(task).await.unwrap();
        }

        tokio::time::sleep(std::time::Duration::from_secs(1)).await;
        assert_eq!(manager.total_count(), 5);

        manager.cleanup_completed(2);
        assert_eq!(manager.total_count(), 2);
    }

    #[test]
    fn test_cancel_nonexistent_task() {
        let manager = AgentManager::new();
        let result = manager.cancel_task("nonexistent");
        assert!(result.is_err());
    }
}
