//! AgentRunnerApi Trait
//!
//! 定义 Agent Runner 的本地调用接口，使 UI 层能够直接调用 agent_runner 库的功能。
//! 客户端没有 Docker 容器，只实现核心会话管理接口。

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};

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
    /// 项目 ID
    pub project_id: String,

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

    /// 模型提供商配置
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub model_config: Option<ModelProviderConfig>,

    /// 服务类型
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub service_type: Option<ServiceType>,
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
    pub project_id: String,

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

/// 附件数据源类型
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "source_type", content = "data")]
pub enum AttachmentSource {
    /// 文件路径，相对于项目目录
    #[serde(rename = "file_path")]
    FilePath { path: String },

    /// Base64 编码的数据
    #[serde(rename = "base64")]
    Base64 { data: String, mime_type: String },

    /// URL 链接
    #[serde(rename = "url")]
    Url { url: String },
}

/// 附件枚举
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", content = "content")]
pub enum Attachment {
    /// 文本附件
    #[serde(rename = "text")]
    Text(TextAttachment),

    /// 图像附件
    #[serde(rename = "image")]
    Image(ImageAttachment),

    /// 音频附件
    #[serde(rename = "audio")]
    Audio(AudioAttachment),

    /// 文档附件
    #[serde(rename = "document")]
    Document(DocumentAttachment),
}

/// 文本附件
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TextAttachment {
    pub id: String,
    pub source: AttachmentSource,
    pub filename: Option<String>,
    pub description: Option<String>,
}

/// 图像附件
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ImageAttachment {
    pub id: String,
    pub source: AttachmentSource,
    pub mime_type: String,
    pub filename: Option<String>,
    pub description: Option<String>,
}

/// 音频附件
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AudioAttachment {
    pub id: String,
    pub source: AttachmentSource,
    pub mime_type: String,
    pub filename: Option<String>,
    pub description: Option<String>,
}

/// 文档附件
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DocumentAttachment {
    pub id: String,
    pub source: AttachmentSource,
    pub mime_type: String,
    pub filename: Option<String>,
    pub description: Option<String>,
}

/// 模型提供商配置
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct ModelProviderConfig {
    /// 模型 ID
    pub id: String,

    /// 提供商名称
    pub name: String,

    /// API 基础 URL
    pub base_url: String,

    /// API 密钥
    pub api_key: String,

    /// 是否需要 OpenAI 兼容的认证
    pub requires_openai_auth: bool,

    /// 默认模型名称
    pub default_model: String,
}

/// 状态查询结果
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AgentStatusResult {
    /// Agent 状态
    pub status: AgentStatus,

    /// 是否找到
    pub is_found: bool,
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
    /// - force: 是否强制停止
    ///
    /// # 返回
    /// - Ok(()): 成功
    /// - Err(error): 错误信息
    async fn stop_agent(&self, project_id: &str, force: bool) -> Result<(), String>;
}
