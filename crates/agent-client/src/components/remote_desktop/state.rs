//! 远程桌面状态和事件定义

/// 远程桌面连接状态
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum RemoteDesktopState {
    /// 未连接
    Disconnected,
    /// 连接中
    Connecting,
    /// 已连接
    Connected {
        peer_id: String,
        width: u32,
        height: u32,
    },
    /// 错误
    Error(String),
}

impl Default for RemoteDesktopState {
    fn default() -> Self {
        Self::Disconnected
    }
}

/// 远程桌面事件
#[derive(Debug, Clone)]
pub enum RemoteDesktopEvent {
    /// 连接状态变化
    StateChanged(RemoteDesktopState),
    /// 帧更新
    FrameUpdated,
}
