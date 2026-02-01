//! 远程桌面 ViewModel
//!
//! 封装远程桌面会话的 UI 状态和操作，与业务逻辑解耦。
//! 仅在 `remote-desktop` feature 启用时可用。

#[cfg(feature = "remote-desktop")]
use std::sync::Arc;
#[cfg(feature = "remote-desktop")]
use tokio::sync::RwLock;
#[cfg(feature = "remote-desktop")]
use derive_more::Display;

#[cfg(feature = "remote-desktop")]
/// 导入远程桌面组件的类型
pub use crate::components::remote_desktop::{
    RemoteDesktopEvent, RemoteDesktopState, VideoQuality,
};

#[cfg(not(feature = "remote-desktop"))]
/// 远程桌面状态（占位类型，当 feature 未启用时）
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub enum RemoteDesktopState {
    /// 未连接
    #[default]
    Disconnected,
}

/// 当 feature 未启用时的空操作宏
#[cfg(not(feature = "remote-desktop"))]
macro_rules! not_enabled {
    () => {
        compile_error!("remote-desktop feature is not enabled")
    };
}

/// 远程桌面连接信息（UI 友好格式）
#[derive(Debug, Clone, Display)]
#[derive(Default)]
pub enum RemoteDesktopUIState {
    /// 未连接
    #[display("未连接")]
    #[default]
    Disconnected,

    /// 连接中
    #[display("连接中...")]
    Connecting,

    /// 已连接
    #[display("已连接到 {peer_id}")]
    Connected {
        /// 远程 Peer ID
        peer_id: String,
        /// 屏幕宽度
        width: u32,
        /// 屏幕高度
        height: u32,
        /// 连接延迟（毫秒）
        latency_ms: u32,
        /// 当前帧率
        fps: u32,
    },

    /// 错误
    #[display("连接失败: {message}")]
    Error {
        /// 错误信息
        message: String,
    },
}


impl RemoteDesktopUIState {
    /// 检查是否已连接
    pub fn is_connected(&self) -> bool {
        matches!(self, Self::Connected { .. })
    }

    /// 检查是否正在连接
    pub fn is_connecting(&self) -> bool {
        matches!(self, Self::Connecting)
    }

    /// 获取错误信息（如果有）
    pub fn error_message(&self) -> Option<&str> {
        match self {
            Self::Error { message } => Some(message),
            _ => None,
        }
    }
}

/// 远程桌面 ViewModel 状态
#[derive(Debug, Clone, Default)]
pub struct RemoteDesktopViewModelState {
    /// UI 状态
    pub ui_state: RemoteDesktopUIState,
    /// 画质设置
    pub quality: VideoQuality,
    /// 是否暂停
    pub is_paused: bool,
    /// 目标 Peer ID（用于重连）
    pub pending_peer_id: Option<String>,
    /// 目标密码（用于重连）
    pub pending_password: Option<String>,
}

impl RemoteDesktopViewModelState {
    /// 创建默认状态
    pub fn new() -> Self {
        Self::default()
    }
}

/// 远程桌面操作
#[derive(Debug, Clone)]
pub enum RemoteDesktopAction {
    /// 开始连接
    Connect {
        /// 目标 Peer ID
        peer_id: String,
        /// 连接密码（可选）
        password: Option<String>,
    },
    /// 断开连接
    Disconnect,
    /// 切换暂停状态
    TogglePause,
    /// 设置画质
    SetQuality(VideoQuality),
    /// 更新延迟信息
    UpdateLatency(u32),
    /// 更新帧率信息
    UpdateFps(u32),
    /// 连接成功
    ConnectionSuccess {
        /// Peer ID
        peer_id: String,
        /// 屏幕宽度
        width: u32,
        /// 屏幕高度
        height: u32,
    },
    /// 连接失败
    ConnectionFailed(String),
    /// 断开完成
    Disconnected,
}

/// 远程桌面 ViewModel
///
/// 职责：
/// - 管理远程桌面连接的 UI 状态
/// - 封装会话操作（连接/断开/暂停）
/// - 提供只读的 UI 状态供组件使用
#[derive(Clone)]
pub struct RemoteDesktopViewModel {
    /// UI 状态
    state: Arc<RwLock<RemoteDesktopViewModelState>>,
}

impl RemoteDesktopViewModel {
    /// 创建新的 ViewModel
    pub fn new() -> Self {
        Self {
            state: Arc::new(RwLock::new(RemoteDesktopViewModelState::new())),
        }
    }

    /// 获取当前状态的快照
    pub async fn get_state(&self) -> RemoteDesktopViewModelState {
        self.state.read().await.clone()
    }

    /// 获取 UI 状态
    pub async fn ui_state(&self) -> RemoteDesktopUIState {
        self.state.read().await.ui_state.clone()
    }

    /// 获取当前画质
    pub async fn quality(&self) -> VideoQuality {
        self.state.read().await.quality
    }

    /// 检查是否暂停
    pub async fn is_paused(&self) -> bool {
        self.state.read().await.is_paused
    }

    /// 获取待连接的 Peer ID（用于重连）
    pub async fn pending_peer_id(&self) -> Option<String> {
        self.state.read().await.pending_peer_id.clone()
    }

    /// 获取待连接的密码（用于重连）
    pub async fn pending_password(&self) -> Option<String> {
        self.state.read().await.pending_password.clone()
    }

    /// 检查是否已连接
    pub async fn is_connected(&self) -> bool {
        self.ui_state().await.is_connected()
    }

    /// 检查是否正在连接
    pub async fn is_connecting(&self) -> bool {
        self.ui_state().await.is_connecting()
    }

    /// 处理状态更新操作
    pub async fn handle_action(&self, action: RemoteDesktopAction) {
        let mut state = self.state.write().await;
        match action {
            RemoteDesktopAction::Connect {
                peer_id,
                password,
            } => {
                state.pending_peer_id = Some(peer_id.clone());
                state.pending_password = password;
                state.ui_state = RemoteDesktopUIState::Connecting;
            }
            RemoteDesktopAction::Disconnect => {
                state.ui_state = RemoteDesktopUIState::Disconnected;
                state.pending_peer_id = None;
                state.pending_password = None;
            }
            RemoteDesktopAction::TogglePause => {
                state.is_paused = !state.is_paused;
            }
            RemoteDesktopAction::SetQuality(quality) => {
                state.quality = quality;
            }
            RemoteDesktopAction::UpdateLatency(new_latency) => {
                if let RemoteDesktopUIState::Connected {
                    ref mut latency_ms,
                    ..
                } = state.ui_state
                {
                    *latency_ms = new_latency;
                }
            }
            RemoteDesktopAction::UpdateFps(new_fps) => {
                if let RemoteDesktopUIState::Connected {
                    ref mut fps,
                    ..
                } = state.ui_state
                {
                    *fps = new_fps;
                }
            }
            RemoteDesktopAction::ConnectionSuccess {
                peer_id,
                width,
                height,
            } => {
                state.ui_state = RemoteDesktopUIState::Connected {
                    peer_id,
                    width,
                    height,
                    latency_ms: 0,
                    fps: 0,
                };
            }
            RemoteDesktopAction::ConnectionFailed(message) => {
                state.ui_state = RemoteDesktopUIState::Error {
                    message: message.clone(),
                };
            }
            RemoteDesktopAction::Disconnected => {
                state.ui_state = RemoteDesktopUIState::Disconnected;
            }
        }
    }

    /// 从 RemoteDesktopState 转换为 UI 状态
    pub async fn sync_from_state(&self, remote_state: &RemoteDesktopState) {
        let ui_state = match remote_state {
            RemoteDesktopState::Disconnected => RemoteDesktopUIState::Disconnected,
            RemoteDesktopState::Connecting => RemoteDesktopUIState::Connecting,
            RemoteDesktopState::Connected {
                peer_id,
                width,
                height,
            } => RemoteDesktopUIState::Connected {
                peer_id: peer_id.clone(),
                width: *width,
                height: *height,
                latency_ms: 0,
                fps: 0,
            },
            RemoteDesktopState::Error(message) => RemoteDesktopUIState::Error {
                message: message.clone(),
            },
        };

        let mut state = self.state.write().await;
        state.ui_state = ui_state;
    }
}

impl Default for RemoteDesktopViewModel {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_ui_state_display() {
        assert_eq!(
            RemoteDesktopUIState::Disconnected.to_string(),
            "未连接"
        );
        assert_eq!(
            RemoteDesktopUIState::Connecting.to_string(),
            "连接中..."
        );
        assert_eq!(
            RemoteDesktopUIState::Connected {
                peer_id: "test-id".to_string(),
                width: 1920,
                height: 1080,
                latency_ms: 25,
                fps: 30
            }
            .to_string(),
            "已连接到 test-id"
        );
        assert_eq!(
            RemoteDesktopUIState::Error {
                message: "connection refused".to_string()
            }
            .to_string(),
            "连接失败: connection refused"
        );
    }

    #[test]
    fn test_ui_state_helpers() {
        assert!(!RemoteDesktopUIState::Disconnected.is_connected());
        assert!(!RemoteDesktopUIState::Disconnected.is_connecting());
        assert!(RemoteDesktopUIState::Disconnected.error_message().is_none());

        assert!(!RemoteDesktopUIState::Connecting.is_connected());
        assert!(RemoteDesktopUIState::Connecting.is_connecting());

        assert!(RemoteDesktopUIState::Connected {
            peer_id: "id".to_string(),
            width: 800,
            height: 600,
            latency_ms: 0,
            fps: 0
        }
        .is_connected());
        assert!(!RemoteDesktopUIState::Connected {
            peer_id: "id".to_string(),
            width: 800,
            height: 600,
            latency_ms: 0,
            fps: 0
        }
        .is_connecting());

        assert_eq!(
            RemoteDesktopUIState::Error {
                message: "test error".to_string()
            }
            .error_message(),
            Some("test error")
        );
    }

    #[tokio::test]
    async fn test_viewmodel_creation() {
        let vm = RemoteDesktopViewModel::new();
        let state = vm.get_state().await;

        assert!(matches!(state.ui_state, RemoteDesktopUIState::Disconnected));
        assert_eq!(state.quality, VideoQuality::default());
        assert!(!state.is_paused);
    }

    #[tokio::test]
    async fn test_handle_connect_action() {
        let vm = RemoteDesktopViewModel::new();

        vm.handle_action(RemoteDesktopAction::Connect {
            peer_id: "target-123".to_string(),
            password: Some("secret".to_string()),
        })
        .await;

        let state = vm.get_state().await;
        assert!(matches!(state.ui_state, RemoteDesktopUIState::Connecting));
        assert_eq!(state.pending_peer_id, Some("target-123".to_string()));
        assert_eq!(state.pending_password, Some("secret".to_string()));
    }

    #[tokio::test]
    async fn test_handle_disconnect_action() {
        let vm = RemoteDesktopViewModel::new();

        // 先连接
        vm.handle_action(RemoteDesktopAction::Connect {
            peer_id: "target-123".to_string(),
            password: None,
        })
        .await;

        // 再断开
        vm.handle_action(RemoteDesktopAction::Disconnect).await;

        let state = vm.get_state().await;
        assert!(matches!(state.ui_state, RemoteDesktopUIState::Disconnected));
        assert!(state.pending_peer_id.is_none());
    }

    #[tokio::test]
    async fn test_handle_toggle_pause() {
        let vm = RemoteDesktopViewModel::new();

        assert!(!vm.is_paused().await);

        vm.handle_action(RemoteDesktopAction::TogglePause).await;
        assert!(vm.is_paused().await);

        vm.handle_action(RemoteDesktopAction::TogglePause).await;
        assert!(!vm.is_paused().await);
    }

    #[tokio::test]
    async fn test_handle_connection_success() {
        let vm = RemoteDesktopViewModel::new();

        vm.handle_action(RemoteDesktopAction::ConnectionSuccess {
            peer_id: "remote-peer".to_string(),
            width: 1920,
            height: 1080,
        })
        .await;

        assert!(vm.is_connected().await);
        assert!(!vm.is_connecting().await);

        let ui_state = vm.ui_state().await;
        match ui_state {
            RemoteDesktopUIState::Connected {
                peer_id,
                width,
                height,
                ..
            } => {
                assert_eq!(peer_id, "remote-peer");
                assert_eq!(width, 1920);
                assert_eq!(height, 1080);
            }
            _ => panic!("Expected Connected state"),
        }
    }

    #[tokio::test]
    async fn test_handle_connection_failed() {
        let vm = RemoteDesktopViewModel::new();

        vm.handle_action(RemoteDesktopAction::ConnectionFailed(
            "Connection timeout".to_string(),
        ))
        .await;

        assert!(!vm.is_connected().await);
        assert!(!vm.is_connecting().await);

        let ui_state = vm.ui_state().await;
        match ui_state {
            RemoteDesktopUIState::Error { message } => {
                assert_eq!(message, "Connection timeout");
            }
            _ => panic!("Expected Error state"),
        }
    }

    #[tokio::test]
    async fn test_sync_from_state() {
        let vm = RemoteDesktopViewModel::new();

        // 从 Disconnected 同步
        vm.sync_from_state(&RemoteDesktopState::Disconnected).await;
        assert!(matches!(
            vm.ui_state().await,
            RemoteDesktopUIState::Disconnected
        ));

        // 从 Connecting 同步
        vm.sync_from_state(&RemoteDesktopState::Connecting).await;
        assert!(matches!(
            vm.ui_state().await,
            RemoteDesktopUIState::Connecting
        ));

        // 从 Connected 同步
        vm.sync_from_state(&RemoteDesktopState::Connected {
            peer_id: "test-peer".to_string(),
            width: 1366,
            height: 768,
        })
        .await;
        assert!(vm.is_connected().await);

        // 从 Error 同步
        vm.sync_from_state(&RemoteDesktopState::Error("Test error".to_string()))
            .await;
        assert_eq!(vm.ui_state().await.error_message(), Some("Test error"));
    }
}
