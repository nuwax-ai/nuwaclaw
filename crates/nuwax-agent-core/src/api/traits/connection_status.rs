//! ConnectionStatusApi Trait
//!
//! 定义连接状态 ViewModel 的接口

use serde::Serialize;

pub use super::status_bar::UIConnectionMode;
pub use super::status_bar::UIConnectionState;

/// 连接状态 ViewModel 状态
#[derive(Debug, Clone, Default, Serialize)]
pub struct ConnectionStatusViewModelState {
    pub state: UIConnectionState,
    pub mode: Option<UIConnectionMode>,
    pub remote_id: Option<String>,
    pub quality: Option<String>,
    pub error_message: Option<String>,
}

/// ConnectionStatusApi Trait
///
/// 定义连接状态 ViewModel 的所有可用操作。
#[async_trait::async_trait]
pub trait ConnectionStatusApi {
    /// 状态类型（必须可序列化）
    type State: Serialize + Clone + Send + 'static;

    /// 获取当前状态
    async fn state(&self) -> Self::State;

    /// 同步获取状态快照（用于 Tauri 命令）
    fn state_snapshot(&self) -> Self::State;

    /// 设置连接状态
    async fn set_state(&self, state: UIConnectionState);

    /// 设置连接模式
    async fn set_mode(&self, mode: UIConnectionMode);

    /// 设置远程 ID
    async fn set_remote_id(&self, id: Option<String>);

    /// 设置连接质量
    async fn set_quality(&self, quality: Option<String>);

    /// 设置错误信息
    async fn set_error(&self, message: Option<String>);
}
