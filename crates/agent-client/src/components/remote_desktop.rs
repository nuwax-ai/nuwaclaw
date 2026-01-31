//! 远程桌面组件
//!
//! 接收屏幕帧渲染 + 键鼠事件转发

use gpui::*;
use gpui_component::{v_flex, h_flex, ActiveTheme, Icon, IconName, Sizable};
use std::sync::Arc;
use tokio::sync::RwLock;

use crate::core::connection::{PeerConnection, PeerConnectionConfig, PeerConnectionEvent, InputEvent, MouseButton};

/// 帧数据 - 存储解码后的视频帧
#[derive(Clone)]
pub struct FrameData {
    /// RGBA 像素数据
    pub pixels: Vec<u8>,
    /// 宽度
    pub width: u32,
    /// 高度
    pub height: u32,
    /// 帧序号
    pub frame_number: u64,
}

impl FrameData {
    /// 创建空帧
    pub fn empty(width: u32, height: u32) -> Self {
        let size = (width * height * 4) as usize; // RGBA
        Self {
            pixels: vec![0; size],
            width,
            height,
            frame_number: 0,
        }
    }

    /// 从 RGB 数据创建（nuwax-rustdesk 解码输出）
    pub fn from_rgb(rgb_data: &[u8], width: u32, height: u32, frame_number: u64) -> Self {
        let pixel_count = (width * height) as usize;
        let mut pixels = Vec::with_capacity(pixel_count * 4);

        // 转换 RGB -> RGBA
        for i in 0..pixel_count {
            let idx = i * 3;
            if idx + 2 < rgb_data.len() {
                pixels.push(rgb_data[idx]);     // R
                pixels.push(rgb_data[idx + 1]); // G
                pixels.push(rgb_data[idx + 2]); // B
                pixels.push(255);                // A
            } else {
                pixels.extend_from_slice(&[0, 0, 0, 255]);
            }
        }

        Self {
            pixels,
            width,
            height,
            frame_number,
        }
    }
}

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

            match tokio::time::timeout(tokio::time::Duration::from_millis(100), event_rx.recv()).await {
                Ok(Some(event)) => match event {
                    PeerConnectionEvent::Connected { width, height, mode, .. } => {
                        tracing::info!("Connected to peer {} via {} ({}x{})",
                            self.peer_id, mode, width, height);

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
    pub async fn get_resolution(&self) -> (u32, u32) {
        self.peer_connection.get_resolution().await
    }

    /// 发送鼠标移动事件
    pub async fn send_mouse_move(&self, x: i32, y: i32) -> Result<(), String> {
        self.peer_connection.send_mouse_move(x, y).await
    }

    /// 发送鼠标点击事件
    pub async fn send_mouse_click(&self, button: MouseButton, x: i32, y: i32) -> Result<(), String> {
        self.peer_connection.send_mouse_click(button, x, y).await
    }

    /// 发送键盘事件
    pub async fn send_key(&self, key_code: u32, modifiers: u32, pressed: bool) -> Result<(), String> {
        self.peer_connection.send_key(key_code, modifiers, pressed).await
    }

    /// 获取 PeerConnection 事件接收器（用于监听帧更新等事件）
    pub fn event_receiver(&self) -> Arc<tokio::sync::Mutex<tokio::sync::mpsc::Receiver<PeerConnectionEvent>>> {
        self.peer_connection.event_receiver()
    }
}

/// 远程桌面视图
pub struct RemoteDesktopView {
    /// 连接状态
    state: RemoteDesktopState,
    /// 目标 peer ID
    peer_id: Option<String>,
    /// 帧计数（用于诊断）
    frame_count: u64,
    /// 当前会话
    session: Option<Arc<RemoteDesktopSession>>,
}

impl EventEmitter<RemoteDesktopEvent> for RemoteDesktopView {}

impl RemoteDesktopView {
    /// 创建新的远程桌面视图
    pub fn new() -> Self {
        Self {
            state: RemoteDesktopState::Disconnected,
            peer_id: None,
            frame_count: 0,
            session: None,
        }
    }

    /// 连接到远程桌面
    pub fn connect(&mut self, peer_id: String, cx: &mut Context<Self>) {
        self.peer_id = Some(peer_id.clone());
        self.state = RemoteDesktopState::Connecting;
        cx.emit(RemoteDesktopEvent::StateChanged(self.state.clone()));
        cx.notify();

        // 创建会话并启动连接
        let session = Arc::new(RemoteDesktopSession::new(peer_id.clone()));
        self.session = Some(session.clone());

        // 在后台任务中建立连接
        cx.spawn(async move |view, cx| {
            match session.connect().await {
                Ok((width, height)) => {
                    cx.update(|cx| {
                        if let Some(view) = view.upgrade() {
                            view.update(cx, |view, cx| {
                                view.state = RemoteDesktopState::Connected {
                                    peer_id: peer_id.clone(),
                                    width,
                                    height,
                                };
                                cx.emit(RemoteDesktopEvent::StateChanged(view.state.clone()));
                                cx.notify();
                            });
                        }
                    })
                }
                Err(e) => {
                    cx.update(|cx| {
                        if let Some(view) = view.upgrade() {
                            view.update(cx, |view, cx| {
                                view.state = RemoteDesktopState::Error(e);
                                view.session = None;
                                cx.emit(RemoteDesktopEvent::StateChanged(view.state.clone()));
                                cx.notify();
                            });
                        }
                    })
                }
            }
        })
        .detach();
    }

    /// 断开远程桌面
    pub fn disconnect(&mut self, cx: &mut Context<Self>) {
        if let Some(session) = self.session.take() {
            // 在后台任务中断开连接
            cx.spawn(async move |_view, _cx| {
                session.disconnect().await;
            })
            .detach();
        }

        self.peer_id = None;
        self.state = RemoteDesktopState::Disconnected;
        self.frame_count = 0;
        cx.emit(RemoteDesktopEvent::StateChanged(self.state.clone()));
        cx.notify();
    }

    /// 获取当前状态
    pub fn state(&self) -> &RemoteDesktopState {
        &self.state
    }

    /// 获取当前会话
    pub fn session(&self) -> Option<&Arc<RemoteDesktopSession>> {
        self.session.as_ref()
    }

    /// 通知新帧到达（由帧接收回调调用）
    pub fn notify_frame_updated(&mut self, cx: &mut Context<Self>) {
        self.frame_count += 1;
        cx.emit(RemoteDesktopEvent::FrameUpdated);
        cx.notify();
    }

    /// 获取帧计数
    pub fn frame_count(&self) -> u64 {
        self.frame_count
    }

    /// 渲染未连接状态
    fn render_disconnected(&self, cx: &mut Context<Self>) -> impl IntoElement {
        let theme = cx.theme();

        v_flex()
            .size_full()
            .items_center()
            .justify_center()
            .gap_4()
            .child(
                Icon::new(IconName::Maximize)
                    .large()
                    .text_color(theme.muted_foreground),
            )
            .child(
                div()
                    .text_xl()
                    .font_weight(FontWeight::SEMIBOLD)
                    .text_color(theme.foreground)
                    .child("远程桌面"),
            )
            .child(
                div()
                    .text_base()
                    .text_color(theme.muted_foreground)
                    .child("输入 Peer ID 连接到远程桌面"),
            )
    }

    /// 渲染连接中状态
    fn render_connecting(&self, cx: &mut Context<Self>) -> impl IntoElement {
        let theme = cx.theme();
        let peer_id = self.peer_id.clone().unwrap_or_default();

        v_flex()
            .size_full()
            .items_center()
            .justify_center()
            .gap_4()
            .child(
                div()
                    .text_xl()
                    .font_weight(FontWeight::SEMIBOLD)
                    .text_color(theme.foreground)
                    .child(format!("正在连接 {}...", peer_id)),
            )
    }

    /// 渲染已连接状态（屏幕帧渲染区域）
    fn render_connected(
        &self,
        peer_id: &str,
        width: u32,
        height: u32,
        cx: &mut Context<Self>,
    ) -> impl IntoElement {
        let theme = cx.theme();
        let frame_count = self.frame_count;

        // 帧渲染区域
        // 当有实际帧数据时，使用 gpui 的 Img 或 Canvas 渲染
        // 目前显示连接信息和帧统计
        v_flex()
            .size_full()
            .bg(theme.background)
            .child(
                // 工具栏
                h_flex()
                    .w_full()
                    .h_8()
                    .px_3()
                    .bg(theme.secondary)
                    .items_center()
                    .justify_between()
                    .child(
                        h_flex()
                            .gap_2()
                            .child(
                                div()
                                    .text_sm()
                                    .text_color(theme.foreground)
                                    .child(format!("连接到: {}", peer_id)),
                            )
                            .child(
                                div()
                                    .text_sm()
                                    .text_color(theme.muted_foreground)
                                    .child(format!("{}x{}", width, height)),
                            ),
                    )
                    .child(
                        h_flex()
                            .gap_2()
                            .child(
                                div()
                                    .text_sm()
                                    .text_color(theme.muted_foreground)
                                    .child(format!("帧: #{}", frame_count)),
                            ),
                    ),
            )
            .child(
                // 帧渲染画布
                div()
                    .flex_1()
                    .w_full()
                    .bg(rgb(0x1a1a2e))
                    .items_center()
                    .justify_center()
                    .child(
                        v_flex()
                            .items_center()
                            .gap_2()
                            .child(
                                Icon::new(IconName::Frame)
                                    .large()
                                    .text_color(theme.muted_foreground),
                            )
                            .child(
                                div()
                                    .text_sm()
                                    .text_color(theme.muted_foreground)
                                    .child("远程桌面已连接"),
                            )
                            .child(
                                div()
                                    .text_xs()
                                    .text_color(theme.muted_foreground)
                                    .child("等待视频流..."),
                            ),
                    ),
            )
    }

    /// 渲染错误状态
    fn render_error(&self, message: &str, cx: &mut Context<Self>) -> impl IntoElement {
        let theme = cx.theme();

        v_flex()
            .size_full()
            .items_center()
            .justify_center()
            .gap_4()
            .child(
                Icon::new(IconName::CircleX)
                    .large()
                    .text_color(theme.danger),
            )
            .child(
                div()
                    .text_xl()
                    .font_weight(FontWeight::SEMIBOLD)
                    .text_color(theme.danger)
                    .child("连接失败"),
            )
            .child(
                div()
                    .text_base()
                    .text_color(theme.muted_foreground)
                    .child(message.to_string()),
            )
    }
}

impl Render for RemoteDesktopView {
    fn render(&mut self, _window: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        match &self.state {
            RemoteDesktopState::Disconnected => {
                self.render_disconnected(cx).into_any_element()
            }
            RemoteDesktopState::Connecting => {
                self.render_connecting(cx).into_any_element()
            }
            RemoteDesktopState::Connected {
                peer_id,
                width,
                height,
            } => {
                let peer_id = peer_id.clone();
                let width = *width;
                let height = *height;
                self.render_connected(&peer_id, width, height, cx)
                    .into_any_element()
            }
            RemoteDesktopState::Error(msg) => {
                let msg = msg.clone();
                self.render_error(&msg, cx).into_any_element()
            }
        }
    }
}
