//! StatusBarApi Trait
//!
//! 定义状态栏 ViewModel 的接口

use serde::Serialize;

/// 连接状态枚举
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize)]
pub enum UIConnectionState {
    #[default]
    Disconnected,
    Connecting,
    Connected,
    Error,
}

/// 连接模式枚举
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize)]
pub enum UIConnectionMode {
    #[default]
    Direct,
    Relay,
    P2P,
}

/// Agent 状态枚举
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize)]
pub enum UIAgentState {
    #[default]
    Offline,
    Idle,
    Connecting,
    Executing,
    Paused,
    Completed,
    Error,
}

/// 状态栏状态
#[derive(Debug, Clone, Default, Serialize)]
pub struct StatusBarViewModelState {
    pub connection_state: UIConnectionState,
    pub connection_mode: Option<UIConnectionMode>,
    pub connection_latency: Option<u64>,
    pub agent_state: UIAgentState,
    pub agent_task_count: usize,
    pub dependency_text: String,
    pub has_update: bool,
    pub is_loading: bool,
}

/// StatusBarApi Trait
///
/// 定义状态栏 ViewModel 的所有可用操作。
#[async_trait::async_trait]
pub trait StatusBarApi {
    /// 状态类型（必须可序列化）
    type State: Serialize + Clone + Send + 'static;

    /// 获取当前状态
    async fn state(&self) -> Self::State;

    /// 同步获取状态快照（用于 Tauri 命令）
    fn state_snapshot(&self) -> Self::State;

    /// 更新连接状态
    async fn update_connection(&self, state: UIConnectionState);

    /// 更新连接模式
    async fn update_mode(&self, mode: UIConnectionMode);

    /// 更新连接延迟
    async fn update_latency(&self, latency: Option<u64>);

    /// 更新 Agent 状态
    async fn update_agent(&self, state: UIAgentState, task_count: usize);

    /// 更新依赖状态文本
    async fn update_dependency(&self, text: String);

    /// 设置是否有更新
    async fn set_update_available(&self, available: bool);

    /// 设置加载状态
    async fn set_loading(&self, loading: bool);

    /// 重置所有状态
    async fn reset(&self);
}
