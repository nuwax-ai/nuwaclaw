//! 任务管理方法
//!
//! AppState 上的任务创建、查询、状态更新等操作

use chrono::Utc;
use tracing::info;

use super::events::ServerEvent;
use super::models::{
    default_service_type, AgentStatus, CreateTaskRequest, TaskInfo, TaskProgressEvent, TaskStatus,
};
use super::AppState;

impl AppState {
    /// 创建新任务
    ///
    /// 使用 entry API 避免并发问题
    pub fn create_task(&self, request: CreateTaskRequest) -> TaskInfo {
        let task = TaskInfo::new(
            request.client_id.clone(),
            request.project_id,
            request.prompt,
        )
        .with_session_id(request.session_id.clone())
        .with_service_type(request.service_type.unwrap_or_else(default_service_type))
        .with_model_config(request.model_config)
        .with_attachments(request.attachments);

        let task_id = task.task_id.clone();
        let client_id = task.client_id.clone();

        // 存储任务
        self.tasks.insert(task_id.clone(), task.clone());

        // 更新 session_tasks 映射
        if let Some(session_id) = &request.session_id {
            self.session_tasks
                .insert(session_id.clone(), task_id.clone());
        }

        // 更新 client_tasks 映射（使用 entry API）
        self.client_tasks
            .entry(client_id.clone())
            .or_default()
            .push(task_id.clone());

        // 发送事件
        let _ = self
            .event_tx
            .send(ServerEvent::TaskCreated { task_id, client_id });

        task
    }

    /// 获取任务
    pub fn get_task(&self, task_id: &str) -> Option<TaskInfo> {
        self.tasks.get(task_id).map(|entry| entry.value().clone())
    }

    /// 获取任务列表
    pub fn list_tasks(&self) -> Vec<TaskInfo> {
        self.tasks
            .iter()
            .map(|entry| entry.value().clone())
            .collect()
    }

    /// 按客户端 ID 获取任务列表
    pub fn list_tasks_by_client(&self, client_id: &str) -> Vec<TaskInfo> {
        self.client_tasks
            .get(client_id)
            .map(|task_ids| {
                task_ids
                    .value()
                    .iter()
                    .filter_map(|id| self.get_task(id))
                    .collect()
            })
            .unwrap_or_default()
    }

    /// 按状态获取任务列表
    pub fn list_tasks_by_status(&self, status: TaskStatus) -> Vec<TaskInfo> {
        self.tasks
            .iter()
            .filter(|entry| entry.value().status == status)
            .map(|entry| entry.value().clone())
            .collect()
    }

    /// 更新任务状态
    pub fn update_task_status(&self, task_id: &str, status: TaskStatus) -> bool {
        if let Some(mut task) = self.tasks.get_mut(task_id) {
            let old_status = task.status;
            task.status = status;

            // 更新时间戳
            match status {
                TaskStatus::Running if task.started_at.is_none() => {
                    task.started_at = Some(Utc::now());
                }
                TaskStatus::Completed | TaskStatus::Failed | TaskStatus::Cancelled => {
                    task.completed_at = Some(Utc::now());
                }
                _ => {}
            }

            // 发送状态变更事件
            let client_id = task.client_id.clone();
            drop(task); // 释放锁

            match status {
                TaskStatus::Running => {
                    let _ = self.event_tx.send(ServerEvent::TaskStarted {
                        task_id: task_id.to_string(),
                        client_id,
                    });
                }
                TaskStatus::Completed => {
                    let result = self.get_task(task_id).and_then(|t| t.result);
                    let _ = self.event_tx.send(ServerEvent::TaskCompleted {
                        task_id: task_id.to_string(),
                        client_id,
                        result,
                    });
                }
                TaskStatus::Failed => {
                    let task = self.get_task(task_id);
                    let error = task
                        .as_ref()
                        .and_then(|t| t.error.clone())
                        .unwrap_or_default();
                    let error_code = task.and_then(|t| t.error_code);
                    let _ = self.event_tx.send(ServerEvent::TaskFailed {
                        task_id: task_id.to_string(),
                        client_id,
                        error,
                        error_code,
                    });
                }
                TaskStatus::Cancelled => {
                    let _ = self.event_tx.send(ServerEvent::TaskCancelled {
                        task_id: task_id.to_string(),
                        client_id,
                        reason: None,
                    });
                }
                _ => {}
            }

            info!(
                "Task {} status changed: {:?} -> {:?}",
                task_id, old_status, status
            );
            true
        } else {
            false
        }
    }

    /// 添加任务进度事件
    pub fn add_task_progress(&self, task_id: &str, event: TaskProgressEvent) -> bool {
        if let Some(mut task) = self.tasks.get_mut(task_id) {
            let client_id = task.client_id.clone();
            task.progress_events.push(event.clone());
            drop(task);

            let _ = self.event_tx.send(ServerEvent::TaskProgress {
                task_id: task_id.to_string(),
                client_id,
                event,
            });
            true
        } else {
            false
        }
    }

    /// 设置任务结果
    pub fn set_task_result(&self, task_id: &str, result: serde_json::Value) -> bool {
        if let Some(mut task) = self.tasks.get_mut(task_id) {
            task.result = Some(result);
            true
        } else {
            false
        }
    }

    /// 设置任务错误
    pub fn set_task_error(&self, task_id: &str, error: String, error_code: Option<String>) -> bool {
        if let Some(mut task) = self.tasks.get_mut(task_id) {
            task.error = Some(error);
            task.error_code = error_code;
            true
        } else {
            false
        }
    }

    /// 取消任务
    pub fn cancel_task(&self, task_id: &str, reason: Option<String>) -> bool {
        if let Some(mut task) = self.tasks.get_mut(task_id) {
            // 只能取消未完成的任务
            if task.status.is_terminal() {
                return false;
            }

            let client_id = task.client_id.clone();
            task.status = TaskStatus::Cancelled;
            task.completed_at = Some(Utc::now());
            task.error = reason.clone();
            drop(task);

            let _ = self.event_tx.send(ServerEvent::TaskCancelled {
                task_id: task_id.to_string(),
                client_id,
                reason,
            });
            true
        } else {
            false
        }
    }

    /// 获取客户端 Agent 状态
    ///
    /// 根据客户端是否有正在执行的任务判断
    pub fn get_agent_status(&self, client_id: &str) -> AgentStatus {
        let has_running_task = self
            .client_tasks
            .get(client_id)
            .map(|task_ids| {
                task_ids.value().iter().any(|id| {
                    self.tasks
                        .get(id)
                        .map(|t| t.status == TaskStatus::Running)
                        .unwrap_or(false)
                })
            })
            .unwrap_or(false);

        if has_running_task {
            AgentStatus::Busy
        } else {
            AgentStatus::Idle
        }
    }

    /// 通过 session_id 获取任务
    pub fn get_task_by_session(&self, session_id: &str) -> Option<TaskInfo> {
        self.session_tasks
            .get(session_id)
            .and_then(|task_id| self.get_task(task_id.value()))
    }
}
