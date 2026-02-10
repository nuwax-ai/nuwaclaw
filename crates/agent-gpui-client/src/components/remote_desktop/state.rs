//! 远程桌面状态和事件定义

/// 远程桌面连接状态
#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub enum RemoteDesktopState {
    /// 未连接
    #[default]
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

/// 远程桌面事件
#[derive(Debug, Clone)]
pub enum RemoteDesktopEvent {
    /// 连接状态变化
    StateChanged(RemoteDesktopState),
    /// 帧更新
    FrameUpdated,
}
