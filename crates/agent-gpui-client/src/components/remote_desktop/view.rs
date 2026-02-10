//! 远程桌面视图组件

use gpui::*;
use gpui_component::{
    button::{Button, ButtonVariants},
    h_flex,
    input::{Input, InputState},
    v_flex, ActiveTheme, Icon, IconName, Sizable,
};
use std::sync::Arc;

use super::frame::VideoQuality;
use super::session::RemoteDesktopSession;
use super::state::{RemoteDesktopEvent, RemoteDesktopState};

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
    /// Peer ID 输入框状态
    peer_id_input: Entity<InputState>,
    /// 密码输入框状态
    password_input: Entity<InputState>,
    /// 画质设置
    quality: VideoQuality,
    /// 是否暂停
    is_paused: bool,
    /// 延迟（毫秒）
    latency_ms: u32,
    /// 当前帧率
    current_fps: u32,
    /// 事件订阅
    _subscriptions: Vec<Subscription>,
}

impl EventEmitter<RemoteDesktopEvent> for RemoteDesktopView {}

impl RemoteDesktopView {
    /// 创建新的远程桌面视图
    pub fn new(window: &mut Window, cx: &mut Context<Self>) -> Self {
        let peer_id_input =
            cx.new(|cx| InputState::new(window, cx).placeholder("输入远程客户端 ID"));
        let password_input = cx.new(|cx| {
            InputState::new(window, cx)
                .placeholder("输入连接密码（可选）")
                .masked(true)
        });

        Self {
            state: RemoteDesktopState::Disconnected,
            peer_id: None,
            frame_count: 0,
            session: None,
            peer_id_input,
            password_input,
            quality: VideoQuality::default(),
            is_paused: false,
            latency_ms: 0,
            current_fps: 0,
            _subscriptions: Vec::new(),
        }
    }

    /// 连接到远程桌面（带可选密码）
    pub fn connect_with_password(
        &mut self,
        peer_id: String,
        password: Option<String>,
        cx: &mut Context<Self>,
    ) {
        self.peer_id = Some(peer_id.clone());
        self.state = RemoteDesktopState::Connecting;
        cx.emit(RemoteDesktopEvent::StateChanged(self.state.clone()));
        cx.notify();

        // 创建会话
        let session = match &password {
            Some(pwd) if !pwd.is_empty() => Arc::new(RemoteDesktopSession::with_password(
                peer_id.clone(),
                pwd.clone(),
            )),
            _ => Arc::new(RemoteDesktopSession::new(peer_id.clone())),
        };
        self.session = Some(session.clone());

        // 在后台任务中建立连接
        cx.spawn(async move |view, cx| match session.connect().await {
            Ok((width, height)) => cx.update(|cx| {
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
            }),
            Err(e) => cx.update(|cx| {
                if let Some(view) = view.upgrade() {
                    view.update(cx, |view, cx| {
                        view.state = RemoteDesktopState::Error(e);
                        view.session = None;
                        cx.emit(RemoteDesktopEvent::StateChanged(view.state.clone()));
                        cx.notify();
                    });
                }
            }),
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
        self.is_paused = false;
        self.latency_ms = 0;
        self.current_fps = 0;
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

    /// 切换暂停状态
    fn toggle_pause(&mut self, cx: &mut Context<Self>) {
        self.is_paused = !self.is_paused;
        cx.notify();
    }

    /// 设置画质
    fn set_quality(&mut self, quality: VideoQuality, cx: &mut Context<Self>) {
        self.quality = quality;
        // TODO: 通知服务端切换画质
        cx.notify();
    }

    /// 更新延迟信息
    pub fn update_latency(&mut self, latency_ms: u32, cx: &mut Context<Self>) {
        self.latency_ms = latency_ms;
        cx.notify();
    }

    /// 更新帧率信息
    pub fn update_fps(&mut self, fps: u32, cx: &mut Context<Self>) {
        self.current_fps = fps;
        cx.notify();
    }

    /// 渲染工具栏
    fn render_toolbar(
        &self,
        peer_id: &str,
        width: u32,
        height: u32,
        cx: &mut Context<Self>,
    ) -> impl IntoElement {
        let theme = cx.theme();
        let quality = self.quality;
        let is_paused = self.is_paused;

        h_flex()
            .w_full()
            .h(px(40.0))
            .px_3()
            .bg(theme.secondary)
            .items_center()
            .justify_between()
            .child(
                // 左侧：连接信息
                h_flex()
                    .gap_3()
                    .items_center()
                    .child(
                        h_flex()
                            .gap_1()
                            .items_center()
                            .child(
                                Icon::new(IconName::Maximize)
                                    .small()
                                    .text_color(theme.success),
                            )
                            .child(
                                div()
                                    .text_sm()
                                    .text_color(theme.foreground)
                                    .child(peer_id.to_string()),
                            ),
                    )
                    .child(
                        div()
                            .text_xs()
                            .px_2()
                            .py_0p5()
                            .rounded_sm()
                            .bg(theme.muted)
                            .text_color(theme.muted_foreground)
                            .child(format!("{}x{}", width, height)),
                    ),
            )
            .child(
                // 右侧：控制按钮
                h_flex()
                    .gap_2()
                    .items_center()
                    .child(
                        // 画质按钮（简化版，点击循环切换画质）
                        Button::new("quality")
                            .label(quality.label())
                            .ghost()
                            .small()
                            .tooltip("点击切换画质")
                            .on_click(cx.listener(|this, _, _window, cx| {
                                let next = match this.quality {
                                    VideoQuality::Smooth => VideoQuality::Standard,
                                    VideoQuality::Standard => VideoQuality::HD,
                                    VideoQuality::HD => VideoQuality::Smooth,
                                };
                                this.set_quality(next, cx);
                            })),
                    )
                    .child(
                        Button::new("file-transfer")
                            .icon(Icon::new(IconName::FolderOpen).small())
                            .ghost()
                            .small()
                            .tooltip("文件传输"),
                    )
                    .child(
                        Button::new("pause")
                            .icon(
                                Icon::new(if is_paused {
                                    IconName::ArrowRight // Play
                                } else {
                                    IconName::Minus // Pause
                                })
                                .small(),
                            )
                            .ghost()
                            .small()
                            .tooltip(if is_paused { "继续" } else { "暂停" })
                            .on_click(cx.listener(|this, _, _window, cx| {
                                this.toggle_pause(cx);
                            })),
                    )
                    .child(
                        Button::new("disconnect")
                            .icon(Icon::new(IconName::Close).small())
                            .ghost()
                            .small()
                            .tooltip("断开连接")
                            .on_click(cx.listener(|this, _, _window, cx| {
                                this.disconnect(cx);
                            })),
                    ),
            )
    }

    /// 渲染状态栏
    fn render_status_bar(&self, cx: &mut Context<Self>) -> impl IntoElement {
        let theme = cx.theme();
        let latency = self.latency_ms;
        let fps = self.current_fps;
        let frame_count = self.frame_count;

        h_flex()
            .w_full()
            .h(px(24.0))
            .px_3()
            .bg(theme.sidebar)
            .items_center()
            .gap_4()
            .child(
                h_flex()
                    .gap_1()
                    .items_center()
                    .child(div().w(px(8.0)).h(px(8.0)).rounded_full().bg(theme.success))
                    .child(div().text_xs().text_color(theme.foreground).child("已连接")),
            )
            .child(
                div()
                    .text_xs()
                    .text_color(theme.muted_foreground)
                    .child(format!("延迟: {}ms", latency)),
            )
            .child(
                div()
                    .text_xs()
                    .text_color(theme.muted_foreground)
                    .child(format!("帧率: {} fps", fps)),
            )
            .child(
                div()
                    .text_xs()
                    .text_color(theme.muted_foreground)
                    .child(format!("帧: #{}", frame_count)),
            )
    }

    /// 渲染未连接状态
    fn render_disconnected(&self, cx: &mut Context<Self>) -> impl IntoElement {
        let theme = cx.theme();

        v_flex()
            .size_full()
            .items_center()
            .justify_center()
            .gap_6()
            .child(
                v_flex()
                    .items_center()
                    .gap_2()
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
                            .child("输入对方客户端 ID 发起远程连接"),
                    ),
            )
            .child(
                v_flex()
                    .w(px(320.0))
                    .gap_4()
                    .p_4()
                    .rounded_lg()
                    .bg(theme.sidebar)
                    .border_1()
                    .border_color(theme.border)
                    .child(
                        v_flex()
                            .gap_2()
                            .child(
                                div()
                                    .text_sm()
                                    .font_weight(FontWeight::MEDIUM)
                                    .text_color(theme.foreground)
                                    .child("远程客户端 ID"),
                            )
                            .child(Input::new(&self.peer_id_input).cleanable(true)),
                    )
                    .child(
                        v_flex()
                            .gap_2()
                            .child(
                                div()
                                    .text_sm()
                                    .font_weight(FontWeight::MEDIUM)
                                    .text_color(theme.foreground)
                                    .child("连接密码（可选）"),
                            )
                            .child(Input::new(&self.password_input).mask_toggle()),
                    )
                    .child(
                        Button::new("connect")
                            .label("连接")
                            .primary()
                            .w_full()
                            .on_click(cx.listener(|this, _, _window, cx| {
                                let peer_id = this.peer_id_input.read(cx).value().to_string();
                                if peer_id.is_empty() {
                                    return;
                                }
                                let password = this.password_input.read(cx).value().to_string();
                                let password = if password.is_empty() {
                                    None
                                } else {
                                    Some(password)
                                };
                                this.connect_with_password(peer_id, password, cx);
                            })),
                    ),
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
        let is_paused = self.is_paused;

        // 先提取 theme 相关的颜色值
        let theme = cx.theme();
        let bg_color = theme.background;
        let muted_fg_color = theme.muted_foreground;

        // 先渲染工具栏（需要可变借用 cx）
        let toolbar = self.render_toolbar(peer_id, width, height, cx);
        let status_bar = self.render_status_bar(cx);

        v_flex()
            .size_full()
            .bg(bg_color)
            .child(toolbar)
            .child(
                // 帧渲染画布
                div()
                    .flex_1()
                    .w_full()
                    .bg(rgb(0x1a1a2e))
                    .flex()
                    .items_center()
                    .justify_center()
                    .child(
                        v_flex()
                            .items_center()
                            .gap_2()
                            .child(
                                Icon::new(if is_paused {
                                    IconName::Minus // Paused
                                } else {
                                    IconName::Frame
                                })
                                .large()
                                .text_color(muted_fg_color),
                            )
                            .child(
                                div()
                                    .text_sm()
                                    .text_color(muted_fg_color)
                                    .child(if is_paused {
                                        "已暂停"
                                    } else {
                                        "远程桌面已连接"
                                    }),
                            )
                            .child(div().text_xs().text_color(muted_fg_color).child(
                                if is_paused {
                                    "点击继续按钮恢复画面"
                                } else {
                                    "等待视频流..."
                                },
                            )),
                    ),
            )
            .child(status_bar)
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
            .child(Button::new("retry").label("重新连接").on_click(cx.listener(
                |this, _, _window, cx| {
                    this.state = RemoteDesktopState::Disconnected;
                    cx.emit(RemoteDesktopEvent::StateChanged(this.state.clone()));
                    cx.notify();
                },
            )))
    }
}

impl Render for RemoteDesktopView {
    fn render(&mut self, _window: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        match &self.state {
            RemoteDesktopState::Disconnected => self.render_disconnected(cx).into_any_element(),
            RemoteDesktopState::Connecting => self.render_connecting(cx).into_any_element(),
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
