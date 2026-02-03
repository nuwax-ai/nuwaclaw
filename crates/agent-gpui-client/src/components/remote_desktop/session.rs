//! 远程桌面会话管理

use std::sync::Arc;
use tokio::sync::RwLock;

use nuwax_agent_core::connection::{
    MouseButton, PeerConnection, PeerConnectionConfig, PeerConnectionEvent,
};

use super::frame::FrameData;

/// 远程桌面会话 - 管理与远程 peer 的连接
pub struct RemoteDesktopSession {
    /// 目标 Peer ID
    peer_id: String,
    /// P2P 连接管理器
    peer_connection: Arc<PeerConnection>,
    /// 当前帧缓冲
    frame_buffer: Arc<RwLock<Option<FrameData>>>,
}

impl RemoteDesktopSession {
    /// 创建新会话
    pub fn new(peer_id: String) -> Self {
        let config = PeerConnectionConfig {
            peer_id: peer_id.clone(),
            password: None,
            force_relay: false,
            timeout_secs: 30,
        };

        Self {
            peer_id,
            peer_connection: Arc::new(PeerConnection::new(config)),
            frame_buffer: Arc::new(RwLock::new(None)),
        }
    }

    /// 创建新会话（带密码）
    pub fn with_password(peer_id: String, password: String) -> Self {
        let config = PeerConnectionConfig {
            peer_id: peer_id.clone(),
            password: Some(password),
            force_relay: false,
            timeout_secs: 30,
        };

        Self {
            peer_id,
            peer_connection: Arc::new(PeerConnection::new(config)),
            frame_buffer: Arc::new(RwLock::new(None)),
        }
    }

    /// 建立连接
    pub async fn connect(&self) -> Result<(u32, u32), String> {
        // 通过 PeerConnection 建立 peer 连接
        self.peer_connection.connect().await?;

        // 等待连接成功或超时
        let event_rx_arc = self.peer_connection.event_receiver();
        let mut event_rx = event_rx_arc.lock().await;
        let timeout = tokio::time::Duration::from_secs(30);
        let start = tokio::time::Instant::now();

        loop {
            if start.elapsed() > timeout {
                self.peer_connection.disconnect().await;
                return Err("Connection timeout".to_string());
            }

            match tokio::time::timeout(tokio::time::Duration::from_millis(100), event_rx.recv())
                .await
            {
                Ok(Some(event)) => match event {
                    PeerConnectionEvent::Connected {
                        width,
                        height,
                        mode,
                        ..
                    } => {
                        tracing::info!(
                            "Connected to peer {} via {} ({}x{})",
                            self.peer_id,
                            mode,
                            width,
                            height
                        );

                        // 初始化帧缓冲
                        *self.frame_buffer.write().await = Some(FrameData::empty(width, height));

                        return Ok((width, height));
                    }
                    PeerConnectionEvent::Error { message } => {
                        return Err(message);
                    }
                    PeerConnectionEvent::AuthFailed { message } => {
                        return Err(format!("Authentication failed: {}", message));
                    }
                    PeerConnectionEvent::PasswordRequired => {
                        return Err("Password required".to_string());
                    }
                    PeerConnectionEvent::Disconnected { reason } => {
                        return Err(format!("Disconnected: {}", reason));
                    }
                    _ => {
                        // 继续等待
                    }
                },
                Ok(None) => {
                    return Err("Event channel closed".to_string());
                }
                Err(_) => {
                    // 超时，继续循环
                }
            }
        }
    }

    /// 断开连接
    pub async fn disconnect(&self) {
        self.peer_connection.disconnect().await;
        *self.frame_buffer.write().await = None;
        tracing::info!("Disconnected from peer {}", self.peer_id);
    }

    /// 是否已连接
    pub fn is_connected(&self) -> bool {
        self.peer_connection.is_connected()
    }

    /// 获取 Peer ID
    pub fn peer_id(&self) -> &str {
        &self.peer_id
    }

    /// 更新帧数据（从视频解码器调用）
    pub async fn update_frame(&self, frame: FrameData) {
        *self.frame_buffer.write().await = Some(frame);
    }

    /// 获取当前帧
    pub async fn get_frame(&self) -> Option<FrameData> {
        self.frame_buffer.read().await.clone()
    }

    /// 获取屏幕分辨率
    pub fn get_resolution(&self) -> (u32, u32) {
        self.peer_connection.get_resolution()
    }

    /// 发送鼠标移动事件
    pub async fn send_mouse_move(&self, x: i32, y: i32) -> Result<(), String> {
        self.peer_connection.send_mouse_move(x, y).await
    }

    /// 发送鼠标点击事件
    pub async fn send_mouse_click(
        &self,
        button: MouseButton,
        x: i32,
        y: i32,
    ) -> Result<(), String> {
        self.peer_connection.send_mouse_click(button, x, y).await
    }

    /// 发送键盘事件
    pub async fn send_key(
        &self,
        key_code: u32,
        modifiers: u32,
        pressed: bool,
    ) -> Result<(), String> {
        self.peer_connection
            .send_key(key_code, modifiers, pressed)
            .await
    }

    /// 获取 PeerConnection 事件接收器（用于监听帧更新等事件）
    pub fn event_receiver(
        &self,
    ) -> Arc<tokio::sync::Mutex<tokio::sync::mpsc::Receiver<PeerConnectionEvent>>> {
        self.peer_connection.event_receiver()
    }
}
