//! 状态栏组件

/// 连接状态
#[derive(Debug, Clone, PartialEq)]
pub enum ConnectionState {
    /// 已断开
    Disconnected,
    /// 连接中
    Connecting,
    /// 已连接（模式，延迟 ms）
    Connected(ConnectionMode, u32),
    /// 错误
    Error(String),
}

/// 连接模式
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ConnectionMode {
    P2P,
    Relay,
}

/// Agent 状态
#[derive(Debug, Clone, PartialEq)]
pub enum AgentState {
    /// 空闲
    Idle,
    /// 运行中（活跃任务数）
    Active(usize),
    /// 执行中（当前/总数）
    Executing(usize, usize),
    /// 错误
    Error,
}

/// 状态栏组件
pub struct StatusBar {
    /// 连接状态
    pub connection_state: ConnectionState,
    /// Agent 状态
    pub agent_state: AgentState,
    /// 依赖是否正常
    pub dependency_ok: bool,
}

impl Default for StatusBar {
    fn default() -> Self {
        Self {
            connection_state: ConnectionState::Disconnected,
            agent_state: AgentState::Idle,
            dependency_ok: true,
        }
    }
}
