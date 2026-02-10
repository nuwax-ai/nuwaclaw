//! P2P/Relay 连接模块
//!
//! 处理与远程 peer 的连接，包括：
//! - P2P 打洞连接
//! - Relay 中继连接
//! - 视频帧接收
//! - 输入事件转发

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, RwLock};
use tokio::sync::mpsc;
use tracing::info;

#[cfg(feature = "remote-desktop")]
use librustdesk::client_api::Data;

/// Peer 连接事件
#[derive(Debug, Clone)]
pub enum PeerConnectionEvent {
    /// 连接中
    Connecting,
    /// 连接成功
    Connected {
        peer_id: String,
        width: u32,
        height: u32,
        /// 连接模式（P2P 或 Relay）
        mode: String,
    },
    /// 分辨率变化
    ResolutionChanged { width: u32, height: u32 },
    /// 视频帧到达
    FrameReceived {
        /// RGBA 像素数据
        data: Vec<u8>,
        width: u32,
        height: u32,
        frame_number: u64,
    },
    /// 连接断开
    Disconnected { reason: String },
    /// 错误
    Error { message: String },
    /// 需要密码
    PasswordRequired,
    /// 认证失败
    AuthFailed { message: String },
}

/// Peer 连接配置
#[derive(Debug, Clone)]
pub struct PeerConnectionConfig {
    /// 目标 Peer ID
    pub peer_id: String,
    /// 连接密码
    pub password: Option<String>,
    /// 强制使用 Relay（跳过 P2P 打洞）
    pub force_relay: bool,
    /// 连接超时（秒）
    pub timeout_secs: u64,
}

impl Default for PeerConnectionConfig {
    fn default() -> Self {
        Self {
            peer_id: String::new(),
            password: None,
            force_relay: false,
            timeout_secs: 30,
        }
    }
}

/// Peer 连接管理器
///
/// 封装 librustdesk 的 Client API，提供简化的连接接口
pub struct PeerConnection {
    /// 配置
    config: PeerConnectionConfig,
    /// 是否已连接
    connected: Arc<AtomicBool>,
    /// 是否正在运行
    running: Arc<AtomicBool>,
    /// 远程屏幕宽度
    width: Arc<RwLock<u32>>,
    /// 远程屏幕高度
    height: Arc<RwLock<u32>>,
    /// 帧序号
    frame_number: Arc<RwLock<u64>>,
    /// 事件发送
    event_tx: mpsc::Sender<PeerConnectionEvent>,
    /// 事件接收
    event_rx: Arc<tokio::sync::Mutex<mpsc::Receiver<PeerConnectionEvent>>>,
    /// 输入发送通道（用于发送键鼠事件到远程）
    input_tx: mpsc::Sender<InputEvent>,
    /// librustdesk 客户端（用于发送数据到远程）
    /// 使用 std::sync::Mutex 以匹配 librustdesk Interface trait 的 get_lch 返回类型
    #[cfg(feature = "remote-desktop")]
    client_tx: Arc<Mutex<Option<mpsc::Sender<Data>>>>,
    /// 连接模式（P2P 或 Relay）
    connection_mode: Arc<RwLock<String>>,
}

/// 输入事件
#[derive(Debug, Clone)]
pub enum InputEvent {
    /// 鼠标移动
    MouseMove { x: i32, y: i32 },
    /// 鼠标按下
    MouseDown { button: MouseButton, x: i32, y: i32 },
    /// 鼠标释放
    MouseUp { button: MouseButton, x: i32, y: i32 },
    /// 鼠标滚轮
    MouseWheel { delta_x: i32, delta_y: i32 },
    /// 键盘按下
    KeyDown { key_code: u32, modifiers: u32 },
    /// 键盘释放
    KeyUp { key_code: u32, modifiers: u32 },
}

/// 鼠标按钮
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum MouseButton {
    Left,
    Right,
    Middle,
}

/// Peer 连接管理器构造器
#[derive(Debug, Default)]
pub struct PeerConnectionBuilder {
    config: PeerConnectionConfig,
}

impl PeerConnectionBuilder {
    /// 创建新的构造器
    pub fn new() -> Self {
        Self::default()
    }

    /// 设置 Peer ID
    pub fn peer_id(mut self, peer_id: impl Into<String>) -> Self {
        self.config.peer_id = peer_id.into();
        self
    }

    /// 设置密码
    pub fn password(mut self, password: impl Into<String>) -> Self {
        self.config.password = Some(password.into());
        self
    }

    /// 强制使用 Relay
    pub fn force_relay(mut self, force_relay: bool) -> Self {
        self.config.force_relay = force_relay;
        self
    }

    /// 设置超时
    pub fn timeout_secs(mut self, timeout_secs: u64) -> Self {
        self.config.timeout_secs = timeout_secs;
        self
    }

    /// 构建 PeerConnection
    pub fn build(self) -> PeerConnection {
        PeerConnection::new(self.config)
    }
}

impl Clone for PeerConnection {
    fn clone(&self) -> Self {
        Self {
            config: self.config.clone(),
            connected: self.connected.clone(),
            running: self.running.clone(),
            width: self.width.clone(),
            height: self.height.clone(),
            frame_number: self.frame_number.clone(),
            event_tx: self.event_tx.clone(),
            event_rx: self.event_rx.clone(),
            input_tx: self.input_tx.clone(),
            #[cfg(feature = "remote-desktop")]
            client_tx: self.client_tx.clone(),
            connection_mode: self.connection_mode.clone(),
        }
    }
}

impl PeerConnection {
    /// 创建新的 peer 连接
    pub fn new(config: PeerConnectionConfig) -> Self {
        let (event_tx, event_rx) = mpsc::channel(64);
        let (input_tx, _input_rx) = mpsc::channel(256);

        Self {
            config,
            connected: Arc::new(AtomicBool::new(false)),
            running: Arc::new(AtomicBool::new(false)),
            width: Arc::new(RwLock::new(0)),
            height: Arc::new(RwLock::new(0)),
            frame_number: Arc::new(RwLock::new(0)),
            event_tx,
            event_rx: Arc::new(tokio::sync::Mutex::new(event_rx)),
            input_tx,
            #[cfg(feature = "remote-desktop")]
            client_tx: Arc::new(Mutex::new(None)),
            connection_mode: Arc::new(RwLock::new(String::new())),
        }
    }

    /// 建立连接
    pub async fn connect(&self) -> Result<(), String> {
        if self.running.load(Ordering::SeqCst) {
            return Err("Connection already in progress".to_string());
        }

        self.running.store(true, Ordering::SeqCst);
        let _ = self.event_tx.send(PeerConnectionEvent::Connecting).await;

        info!("Connecting to peer: {}", self.config.peer_id);

        #[cfg(feature = "remote-desktop")]
        {
            // 注意: P2P 连接功能需要完整的 Interface trait 实现
            // 当前实现不完整，返回错误
            self.running.store(false, Ordering::SeqCst);
            let _ = self
                .event_tx
                .send(PeerConnectionEvent::Error {
                    message: "Peer connection not fully implemented".to_string(),
                })
                .await;
            Err(
                "Peer connection not fully implemented. Requires Interface trait implementation."
                    .to_string(),
            )
        }

        #[cfg(not(feature = "remote-desktop"))]
        {
            self.running.store(false, Ordering::SeqCst);
            let _ = self
                .event_tx
                .send(PeerConnectionEvent::Error {
                    message: "remote-desktop feature not enabled".to_string(),
                })
                .await;
            Err("remote-desktop feature not enabled".to_string())
        }
    }

    /// 断开连接
    pub async fn disconnect(&self) {
        if self.running.load(Ordering::SeqCst) {
            info!("Disconnecting from peer: {}", self.config.peer_id);

            // 发送关闭信号
            #[cfg(feature = "remote-desktop")]
            {
                let guard = self.client_tx.lock();
                if let Ok(sender_guard) = guard {
                    if let Some(sender) = sender_guard.as_ref() {
                        let sender = sender.clone();
                        tokio::spawn(async move {
                            let _ = sender.send(Data::Close).await;
                        });
                    }
                }
            }

            self.running.store(false, Ordering::SeqCst);
            self.connected.store(false, Ordering::SeqCst);
        }
    }

    /// 检查是否已连接
    pub fn is_connected(&self) -> bool {
        self.connected.load(Ordering::SeqCst)
    }

    /// 检查是否正在运行
    pub fn is_running(&self) -> bool {
        self.running.load(Ordering::SeqCst)
    }

    /// 获取配置
    pub fn config(&self) -> &PeerConnectionConfig {
        &self.config
    }

    /// 获取事件接收器
    pub fn event_receiver(&self) -> Arc<tokio::sync::Mutex<mpsc::Receiver<PeerConnectionEvent>>> {
        self.event_rx.clone()
    }

    /// 获取屏幕分辨率
    pub fn get_resolution(&self) -> (u32, u32) {
        let width = self.width.read().map(|g| *g).unwrap_or(0);
        let height = self.height.read().map(|g| *g).unwrap_or(0);
        (width, height)
    }

    /// 获取帧序号
    pub fn get_frame_number(&self) -> u64 {
        self.frame_number.read().map(|g| *g).unwrap_or(0)
    }

    /// 发送输入事件
    ///
    /// 注意：实际的输入事件发送需要通过 librustdesk 内部的 io_loop 处理，
    /// 这里提供存根实现。完整的实现需要在 Interface trait 的上下文中处理。
    #[cfg(feature = "remote-desktop")]
    pub async fn send_input(&self, event: InputEvent) -> Result<(), String> {
        if !self.is_connected() {
            return Err("Not connected".to_string());
        }

        debug!("Input event queued: {:?}", event);

        // 输入事件通过 client_tx 通道发送，由 io_loop 处理
        // 使用 std::sync::Mutex::lock() 返回 Result
        let guard = self.client_tx.lock();
        match guard {
            Ok(sender_guard) => {
                if let Some(sender) = sender_guard.as_ref() {
                    // sender.send 是异步的，需要在 tokio 运行时中执行
                    // 这里使用 spawn 来发送，因为我们在异步上下文中
                    let sender = sender.clone();
                    tokio::spawn(async move {
                        let _ = sender.send(Data::Close).await;
                    });
                    Ok(())
                } else {
                    Err("Client sender not initialized".to_string())
                }
            }
            Err(e) => Err(format!("Failed to lock client_tx: {}", e)),
        }
    }

    #[cfg(not(feature = "remote-desktop"))]
    pub async fn send_input(&self, _event: InputEvent) -> Result<(), String> {
        Err("Remote desktop feature not enabled".to_string())
    }

    /// 发送鼠标移动
    pub async fn send_mouse_move(&self, x: i32, y: i32) -> Result<(), String> {
        self.send_input(InputEvent::MouseMove { x, y }).await
    }

    /// 发送鼠标点击
    pub async fn send_mouse_click(
        &self,
        button: MouseButton,
        x: i32,
        y: i32,
    ) -> Result<(), String> {
        self.send_input(InputEvent::MouseDown { button, x, y })
            .await?;
        self.send_input(InputEvent::MouseUp { button, x, y }).await
    }

    /// 发送键盘事件
    pub async fn send_key(
        &self,
        key_code: u32,
        modifiers: u32,
        pressed: bool,
    ) -> Result<(), String> {
        if pressed {
            self.send_input(InputEvent::KeyDown {
                key_code,
                modifiers,
            })
            .await
        } else {
            self.send_input(InputEvent::KeyUp {
                key_code,
                modifiers,
            })
            .await
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn test_new_connection() {
        let config = PeerConnectionConfig {
            peer_id: "test-peer".to_string(),
            password: None,
            force_relay: false,
            timeout_secs: 30,
        };

        let conn = PeerConnection::new(config);
        assert!(!conn.is_connected());
        assert!(!conn.is_running());
    }

    #[test]
    fn test_builder() {
        let conn = PeerConnectionBuilder::new()
            .peer_id("test-peer")
            .password("password")
            .force_relay(true)
            .timeout_secs(60)
            .build();

        assert_eq!(conn.config.peer_id, "test-peer");
        assert_eq!(conn.config.password, Some("password".to_string()));
        assert!(conn.config.force_relay);
        assert_eq!(conn.config.timeout_secs, 60);
    }
}
