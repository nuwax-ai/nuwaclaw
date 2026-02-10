//! 服务器事件
//!
//! ServerEvent 枚举及事件相关方法

use serde::Serialize;

use super::models::TaskProgressEvent;

/// 服务器事件
#[derive(Debug, Clone, Serialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum ServerEvent {
    /// 客户端上线
    ClientOnline(String),
    /// 客户端下线
    ClientOffline(String),
    /// 收到消息
    MessageReceived {
        client_id: String,
        message_type: String,
        payload: String,
    },
    /// 任务创建
    TaskCreated { task_id: String, client_id: String },
    /// 任务开始执行
    TaskStarted { task_id: String, client_id: String },
    /// 任务进度更新
    TaskProgress {
        task_id: String,
        client_id: String,
        event: TaskProgressEvent,
    },
    /// 任务完成
    TaskCompleted {
        task_id: String,
        client_id: String,
        result: Option<serde_json::Value>,
    },
    /// 任务失败
    TaskFailed {
        task_id: String,
        client_id: String,
        error: String,
        error_code: Option<String>,
    },
    /// 任务取消
    TaskCancelled {
        task_id: String,
        client_id: String,
        reason: Option<String>,
    },
}
