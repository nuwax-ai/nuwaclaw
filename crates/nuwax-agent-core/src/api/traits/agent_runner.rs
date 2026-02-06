//! AgentRunnerApi Trait
//!
//! 定义 Agent Runner 的本地调用接口，使 UI 层能够直接调用 agent_runner 库的功能。
//! 客户端没有 Docker 容器，只实现核心会话管理接口。

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};

// 重新导出 shared_types 中的类型
pub use shared_types::{Attachment, ChatAgentConfig, ModelProviderConfig};

/// Agent 状态（UI 层使用）
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Default)]
#[serde(rename_all = "lowercase")]
pub enum AgentStatus {
    /// 等待处理
    #[default]
    Pending,
    /// 活跃状态
    Active,
    /// 空闲状态
    Idle,
    /// 正在终止
    Terminating,
}

/// 聊天请求
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ChatRequest {
    /// 项目 ID（可选，若未提供则自动生成 UUID）
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub project_id: Option<String>,

    /// 会话 ID（可选，如果没有则自动创建）
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub session_id: Option<String>,

    /// 提示内容
    pub prompt: String,

    /// 请求 ID，用于标识和追踪请求
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub request_id: Option<String>,

    /// 附件列表
    #[serde(default)]
    pub attachments: Vec<Attachment>,

    /// 数据源附件列表
    #[serde(default)]
    pub data_source_attachments: Vec<String>,

    /// 模型提供商配置
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub model_config: Option<ModelProviderConfig>,

    /// Agent 配置覆盖
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub agent_config_override: Option<ChatAgentConfig>,

    /// 系统提示覆盖
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub system_prompt_override: Option<String>,

    /// 用户提示模板覆盖
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub user_prompt_template_override: Option<String>,
}

/// 聊天响应
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ChatResponse {
    /// 是否成功
    pub success: bool,

    /// 错误信息
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,

    /// 错误码
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub error_code: Option<String>,

    /// 项目 ID
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub project_id: Option<String>,

    /// 会话 ID
    pub session_id: String,

    /// 请求 ID
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub request_id: Option<String>,
}

/// 服务类型
#[derive(Debug, Clone, Copy, Serialize, Deserialize, Default)]
#[serde(rename_all = "lowercase")]
pub enum ServiceType {
    /// Rcoder 服务
    #[default]
    Rcoder,
    /// Agent Runner 服务
    AgentRunner,
}

/// 状态查询结果
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AgentStatusResult {
    /// Agent 状态
    pub status: AgentStatus,

    /// 是否找到
    pub is_found: bool,
}

/// Agent 信息（用于列表展示）
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AgentInfo {
    /// 项目 ID
    pub project_id: String,
    /// 会话 ID
    pub session_id: String,
    /// Agent 状态
    pub status: AgentStatus,
    /// 最后活动时间
    pub last_active_at: DateTime<Utc>,
}

/// 进度消息类型
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum ProgressMessageType {
    /// 用户发送 prompt 开始
    SessionPromptStart,
    /// Agent 执行结束
    SessionPromptEnd,
    /// Agent 执行过程中的更新
    AgentSessionUpdate,
    /// SSE 连接心跳消息
    Heartbeat,
}

/// 进度消息
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProgressMessage {
    /// 会话 ID
    pub session_id: String,
    /// 消息类型
    pub message_type: ProgressMessageType,
    /// 消息子类型
    pub sub_type: String,
    /// 具体数据内容
    pub data: serde_json::Value,
    /// 时间戳
    pub timestamp: DateTime<Utc>,
}

/// AgentRunnerApi Trait
///
/// 定义 Agent Runner 的所有可用操作。
/// 客户端没有 Docker 容器，只实现核心会话管理接口。
#[async_trait::async_trait]
pub trait AgentRunnerApi: Send + Sync {
    /// 发送聊天请求
    ///
    /// # 参数
    /// - request: 聊天请求
    ///
    /// # 返回
    /// - Ok(ChatResponse): 成功响应
    /// - Err(error): 错误信息
    async fn chat(&self, request: ChatRequest) -> Result<ChatResponse, String>;

    /// 订阅进度流
    ///
    /// # 参数
    /// - session_id: 会话 ID
    ///
    /// # 返回
    /// - Ok(Receiver<ProgressMessage>): 进度消息接收器
    /// - Err(error): 错误信息
    async fn subscribe_progress(
        &self,
        session_id: &str,
    ) -> Result<tokio::sync::mpsc::Receiver<ProgressMessage>, String>;

    /// 取消会话
    ///
    /// # 参数
    /// - session_id: 会话 ID
    /// - project_id: 项目 ID
    ///
    /// # 返回
    /// - Ok(()): 成功
    /// - Err(error): 错误信息
    async fn cancel_session(&self, session_id: &str, project_id: &str) -> Result<(), String>;

    /// 获取 Agent 状态
    ///
    /// # 参数
    /// - session_id: 会话 ID
    /// - project_id: 项目 ID
    ///
    /// # 返回
    /// - Ok(AgentStatusResult): 状态查询结果
    /// - Err(error): 错误信息
    async fn get_status(
        &self,
        session_id: &str,
        project_id: &str,
    ) -> Result<AgentStatusResult, String>;

    /// 停止 Agent
    ///
    /// # 参数
    /// - project_id: 项目 ID
    ///
    /// # 返回
    /// - Ok(()): 成功
    /// - Err(error): 错误信息
    async fn stop_agent(&self, project_id: &str) -> Result<(), String>;

    /// 获取所有活跃的 Agent 列表
    ///
    /// # 返回
    /// - Ok(Vec<AgentInfo>): 活跃 agent 列表
    /// - Err(error): 错误信息
    async fn get_all_agents(&self) -> Result<Vec<AgentInfo>, String>;
}
