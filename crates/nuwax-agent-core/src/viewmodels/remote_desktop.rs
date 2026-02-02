//! 远程桌面 ViewModel
//!
//! 负责管理远程桌面连接的状态和操作

use std::sync::Arc;
use tokio::sync::RwLock;

use async_trait::async_trait;

use super::super::api::traits::RemoteDesktopApi;

/// 远程桌面 UI 状态
#[derive(Debug, Clone, Default, serde::Serialize)]
pub struct RemoteDesktopViewModelState {
    /// 是否已连接
    pub is_connected: bool,
    /// 是否正在连接
    pub is_connecting: bool,
    /// 远程 ID
    pub remote_id: Option<String>,
    /// 连接质量
    pub quality: Option<String>,
    /// 分辨率
    pub resolution: Option<String>,
    /// 帧率
    pub frame_rate: Option<u32>,
}

/// 远程桌面操作
#[derive(Debug, Clone)]
pub enum RemoteDesktopAction {
    /// 开始连接
    Connect(String),
    /// 断开连接
    Disconnect,
    /// 全屏模式
    EnterFullscreen,
    /// 退出全屏
    ExitFullscreen,
    /// 发送 Ctrl+Alt+Del
    SendCtrlAltDel,
    /// 切换画质
    SwitchQuality(String),
}

/// 远程桌面 ViewModel
#[derive(Clone)]
pub struct RemoteDesktopViewModel {
    /// 状态
    state: Arc<RwLock<RemoteDesktopViewModelState>>,
}

impl Default for RemoteDesktopViewModel {
    fn default() -> Self {
        Self::new()
    }
}

impl RemoteDesktopViewModel {
    /// 创建新的 ViewModel
    pub fn new() -> Self {
        Self {
            state: Arc::new(RwLock::new(RemoteDesktopViewModelState::default())),
        }
    }

    /// 获取当前状态
    pub async fn get_state(&self) -> RemoteDesktopViewModelState {
        self.state.read().await.clone()
    }

    /// 检查是否已连接
    pub async fn is_connected(&self) -> bool {
        self.state.read().await.is_connected
    }

    /// 检查是否正在连接
    pub async fn is_connecting(&self) -> bool {
        self.state.read().await.is_connecting
    }

    /// 开始连接
    pub async fn connect(&self, remote_id: String) {
        let mut state = self.state.write().await;
        state.is_connecting = true;
        state.remote_id = Some(remote_id);
        state.is_connected = false;
    }

    /// 连接成功
    pub async fn set_connected(&self) {
        let mut state = self.state.write().await;
        state.is_connecting = false;
        state.is_connected = true;
    }

    /// 断开连接
    pub async fn disconnect(&self) {
        let mut state = self.state.write().await;
        state.is_connecting = false;
        state.is_connected = false;
        state.remote_id = None;
    }

    /// 处理远程桌面操作
    pub async fn handle_action(&self, action: RemoteDesktopAction) {
        match action {
            RemoteDesktopAction::Connect(id) => self.connect(id).await,
            RemoteDesktopAction::Disconnect => self.disconnect().await,
            RemoteDesktopAction::EnterFullscreen => {
                // 由 UI 层处理
            }
            RemoteDesktopAction::ExitFullscreen => {
                // 由 UI 层处理
            }
            RemoteDesktopAction::SendCtrlAltDel => {
                // 发送 Ctrl+Alt+Del 的操作由 UI 层处理
            }
            RemoteDesktopAction::SwitchQuality(quality) => {
                let mut state = self.state.write().await;
                state.quality = Some(quality);
            }
        }
    }
}

#[async_trait]
impl RemoteDesktopApi for RemoteDesktopViewModel {
    type State = RemoteDesktopViewModelState;

    async fn state(&self) -> Self::State {
        self.get_state().await
    }

    fn state_snapshot(&self) -> Self::State {
        futures::executor::block_on(self.get_state())
    }

    async fn connect(&self, remote_id: String) {
        let mut state = self.state.write().await;
        state.is_connecting = true;
        state.remote_id = Some(remote_id);
        state.is_connected = false;
    }

    async fn disconnect(&self) {
        let mut state = self.state.write().await;
        state.is_connecting = false;
        state.is_connected = false;
        state.remote_id = None;
    }
}

#[cfg(feature = "remote-desktop")]
#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn test_remote_desktop_viewmodel_creation() {
        let vm = RemoteDesktopViewModel::new();
        let state = vm.get_state().await;

        assert!(!state.is_connected);
        assert!(!state.is_connecting);
    }

    #[tokio::test]
    async fn test_connect() {
        let vm = RemoteDesktopViewModel::new();

        vm.connect("remote-123".to_string()).await;
        let state = vm.get_state().await;

        assert!(state.is_connecting);
        assert!(!state.is_connected);
        assert_eq!(state.remote_id, Some("remote-123".to_string()));
    }

    #[tokio::test]
    async fn test_disconnect() {
        let vm = RemoteDesktopViewModel::new();

        vm.connect("remote-123".to_string()).await;
        vm.disconnect().await;
        let state = vm.get_state().await;

        assert!(!state.is_connecting);
        assert!(!state.is_connected);
    }
}
