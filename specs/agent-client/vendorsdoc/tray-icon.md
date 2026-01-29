# tray-icon

## 项目概述

跨平台系统托盘图标库，基于 muda 库实现，支持 Windows、macOS 和 Linux。

**GitHub**: https://github.com/tauri-apps/tray-icon.git
**本地路径**: `vendors/tray-icon`

## 目录结构

```
tray-icon/
├── src/
│   ├── lib.rs              # 公共 API
│   ├── icon.rs             # 图标处理
│   ├── menu.rs             # 菜单构建
│   └── platform_impl/      # 平台特定实现
│       ├── mod.rs
│       ├── windows.rs
│       ├── macos.rs
│       └── linux.rs
├── Cargo.toml
└── README.md
```

## 核心依赖

```toml
[dependencies]
muda = "1.0"              # 跨平台菜单库
crossbeam-channel = "0.5"
once_cell = "1.18"
thiserror = "1.0"

# 平台依赖
objc2 = { version = "0.5", optional = true }
gtk = { version = "0.18", optional = true, features = ["v3_22"] }
libappindicator = { version = "0.8", optional = true }
windows = { version = "0.48", optional = true }
```

## 核心 API

### TrayIconBuilder

```rust
// lib.rs

pub struct TrayIconBuilder {
    id: TrayIconId,
    attrs: TrayIconAttributes,
}

impl TrayIconBuilder {
    pub fn new() -> Self;

    /// 设置托盘图标
    pub fn with_icon(mut self, icon: Icon) -> Self;

    /// 设置提示文本
    pub fn with_tooltip<S: AsRef<str>>(self, s: S) -> Self;

    /// 设置标题（macOS）
    pub fn with_title<S: AsRef<str>>(self, title: S) -> Self;

    /// 设置上下文菜单
    pub fn with_menu(mut self, menu: Box<dyn menu::ContextMenu>) -> Self;

    /// 左键点击显示菜单（默认右键）
    pub fn with_menu_on_left_click(self, enable: bool) -> Self;

    /// 设置临时目录路径
    pub fn with_temp_dir_path<P: AsRef<Path>>(self, s: P) -> Self;

    /// 构建托盘图标
    pub fn build(self) -> Result<TrayIcon>;
}
```

### TrayIcon

```rust
pub struct TrayIcon {
    id: TrayIconId,
    tray: Rc<RefCell<platform_impl::TrayIcon>>,
}

impl TrayIcon {
    /// 设置图标
    pub fn set_icon(&self, icon: Option<Icon>) -> Result<()>;

    /// 设置菜单
    pub fn set_menu(&self, menu: Option<Box<dyn menu::ContextMenu>>);

    /// 设置提示文本
    pub fn set_tooltip<S: AsRef<str>>(&self, tooltip: Option<S>) -> Result<()>;

    /// 设置可见性
    pub fn set_visible(&self, visible: bool) -> Result<()>;

    /// 获取托盘区域矩形
    pub fn rect(&self) -> Option<Rect>;
}
```

### TrayIconEvent

```rust
pub enum TrayIconEvent {
    Click {
        id: TrayIconId,
        position: Position,
        rect: Rect,
        button: MouseButton,
        button_state: ButtonState,
    },
    DoubleClick {
        id: TrayIconId,
        position: Position,
        rect: Rect,
        button: MouseButton,
    },
    Enter {
        id: TrayIconId,
        position: Position,
        rect: Rect,
    },
    Move {
        id: TrayIconId,
        position: Position,
        rect: Rect,
    },
    Leave {
        id: TrayIconId,
        position: Position,
        rect: Rect,
    },
}

impl TrayIconEvent {
    /// 获取事件接收器
    pub fn receiver() -> &'a TrayIconEventReceiver;

    /// 设置事件处理函数
    pub fn set_event_handler<F>(f: Option<F>)
    where
        F: Fn(TrayIconEvent, &dyn TrayIconHandle) + Send + 'static;
}
```

## 使用示例

```rust
use tray_icon::{TrayIconBuilder, icon::Icon, menu::MenuBuilder};

fn main() -> Result<()> {
    // 加载图标
    let icon = Icon::from_resource(1, None);

    // 创建菜单
    let menu = MenuBuilder::new()
        .item("Show Window", "show_window", true, None)?
        .separator()
        .item("Settings", "settings", true, None)?
        .separator()
        .quit("Quit")
        .build()?;

    // 创建托盘图标
    let _tray_icon = TrayIconBuilder::new()
        .with_icon(icon)
        .with_tooltip("My App")
        .with_menu(Box::new(menu))
        .with_on_tray_event(|event, tray| {
            match event {
                TrayIconEvent::Click { button, .. } => {
                    if button == MouseButton::Left {
                        show_window();
                    }
                }
                TrayIconEvent::MenuItemClick { id, .. } => {
                    match id.as_ref() {
                        "quit" => std::process::exit(0),
                        "settings" => open_settings(),
                        "show_window" => show_window(),
                        _ => {}
                    }
                }
                _ => {}
            }
        })
        .build()?;

    Ok(())
}
```

## 与 agent-client 集成场景

### 场景1：完整的托盘管理器

```rust
// agent-client 托盘管理器

use tray_icon::{TrayIconBuilder, icon::Icon, menu::{Menu, MenuItem, MenuBuilder}};
use std::sync::atomic::{AtomicBool, Ordering};

pub struct TrayManager {
    // 托盘图标
    tray_icon: Option<TrayIcon>,
    // 是否显示主窗口
    window_visible: AtomicBool,
    // 连接状态
    connection_state: Arc<dyn ConnectionStatusProvider>,
    // 应用退出标志
    exit_flag: Arc<AtomicBool>,
}

impl TrayManager {
    pub fn new(
        connection_state: Arc<dyn ConnectionStatusProvider>,
        exit_flag: Arc<AtomicBool>,
    ) -> Result<Self> {
        let icon = Self::load_icon()?;

        let menu = MenuBuilder::new()
            .item("Show Window", "show_window", true, None)?
            .separator()
            .item("Agent Status", "status", true, None)?
            .item("Open Settings", "settings", true, None)?
            .separator()
            .item("Quit", "quit", true, None)?
            .build()?;

        let tray_icon = TrayIconBuilder::new()
            .with_icon(icon)
            .with_tooltip("nuwax-agent")
            .with_menu(Box::new(menu))
            .with_menu_on_left_click(true)  // 左键也显示菜单
            .build()?;

        Ok(Self {
            tray_icon: Some(tray_icon),
            window_visible: AtomicBool::new(true),
            connection_state,
            exit_flag,
        })
    }

    fn load_icon() -> Result<Icon> {
        // 从资源文件加载图标
        let icon_data = include_bytes!("../../assets/tray_icon.png");
        let image = image::load_from_memory(icon_data)?
            .to_rgba8()
            .into_raw();

        Icon::from_rgba(icon_data.to_vec(), 32, 32)
    }

    /// 设置托盘事件处理
    pub fn setup_event_handler(&self) {
        TrayIconEvent::set_event_handler(Some(move |event, _tray| {
            match event {
                TrayIconEvent::Click { button, .. } => {
                    if button == MouseButton::Left {
                        // 左键点击切换窗口可见性
                        // 发送事件到主窗口
                    }
                }
                TrayIconEvent::MenuItemClick { id, .. } => {
                    match id.as_ref() {
                        "show_window" => {
                            // 显示主窗口
                        }
                        "settings" => {
                            // 打开设置窗口
                        }
                        "quit" => {
                            // 退出应用
                        }
                        _ => {}
                    }
                }
                _ => {}
            }
        }));
    }

    /// 更新托盘图标（根据连接状态）
    pub fn update_icon(&self, status: &ConnectionState) {
        let icon = match status {
            ConnectionState::Connected { .. } => self.load_connected_icon(),
            ConnectionState::Connecting => self.load_loading_icon(),
            ConnectionState::Disconnected { .. } => self.load_disconnected_icon(),
            ConnectionState::Error { .. } => self.load_error_icon(),
        };

        if let Some(tray) = &self.tray_icon {
            tray.set_icon(Some(icon)).ok();
        }
    }

    /// 更新托盘提示文本
    pub fn update_tooltip(&self, text: &str) {
        if let Some(tray) = &self.tray_icon {
            tray.set_tooltip(Some(text)).ok();
        }
    }

    /// 销毁托盘
    pub fn destroy(&mut self) {
        if let Some(tray) = self.tray_icon.take() {
            tray.set_visible(false).ok();
        }
    }
}
```

### 场景2：托盘菜单与主窗口通信

```rust
// 使用 channel 进行托盘事件通信

use tokio::sync::mpsc;

pub enum TrayEvent {
    ShowWindow,
    OpenSettings,
    Quit,
}

pub struct TrayEventChannel {
    sender: mpsc::UnboundedSender<TrayEvent>,
    receiver: Arc<Mutex<mpsc::UnboundedReceiver<TrayEvent>>>,
}

impl TrayEventChannel {
    pub fn new() -> Self {
        let (sender, receiver) = mpsc::unbounded_channel();
        Self {
            sender,
            receiver: Arc::new(Mutex::new(receiver)),
        }
    }

    pub fn sender(&self) -> mpsc::UnboundedSender<TrayEvent> {
        self.sender.clone()
    }

    pub fn receiver(&self) -> Arc<Mutex<mpsc::UnboundedReceiver<TrayEvent>>> {
        self.receiver.clone()
    }
}

/// 在托盘事件中发送消息
fn setup_tray_events(channel: &TrayEventChannel) {
    TrayIconEvent::set_event_handler(Some(move |event, _tray| {
        if let TrayIconEvent::MenuItemClick { id, .. } = event {
            let event = match id.as_ref() {
                "show_window" => TrayEvent::ShowWindow,
                "settings" => TrayEvent::OpenSettings,
                "quit" => TrayEvent::Quit,
                _ => return,
            };
            channel.sender().send(event).ok();
        }
    }));
}

/// 在主窗口中监听托盘事件
async fn handle_tray_events(channel: &TrayEventChannel, window: &WindowHandle) {
    let mut receiver = channel.receiver().lock().await;
    while let Some(event) = receiver.recv().await {
        match event {
            TrayEvent::ShowWindow => {
                window.activate().ok();
            }
            TrayEvent::OpenSettings => {
                // 打开设置窗口
            }
            TrayEvent::Quit => {
                // 退出应用
                std::process::exit(0);
            }
        }
    }
}
```

### 场景3：动态托盘菜单

```rust
// 根据状态动态更新菜单

pub struct DynamicTrayMenu {
    menu: Menu,
    status_item: MenuItem,
    settings_item: MenuItem,
}

impl DynamicTrayMenu {
    pub fn new() -> Result<Self> {
        let menu = MenuBuilder::new()
            .item("Show Window", "show_window", true, None)?
            .separator()
            .item("Status: Disconnected", "status", true, None)?
            .item("Open Settings", "settings", true, None)?
            .separator()
            .item("Quit", "quit", true, None)?
            .build()?;

        // 获取子菜单项的引用
        let status_item = menu.items().find(|item| item.id() == "status").unwrap();
        let settings_item = menu.items().find(|item| item.id() == "settings").unwrap();

        Ok(Self {
            menu,
            status_item,
            settings_item,
        })
    }

    /// 更新状态文本
    pub fn update_status(&mut self, status: &ConnectionState) {
        let text = match status {
            ConnectionState::Connected { mode, latency } => {
                match mode {
                    ConnectionMode::P2P => format!("Status: Connected (P2P) - {}ms", latency),
                    ConnectionMode::Relay => format!("Status: Connected (Relay) - {}ms", latency),
                }
            }
            ConnectionState::Connecting => "Status: Connecting...".into(),
            ConnectionState::Disconnected { .. } => "Status: Disconnected".into(),
            ConnectionState::Error { .. } => "Status: Error".into(),
        };

        // 更新菜单项文本（如果支持）
        // self.status_item.set_text(Some(&text));
    }

    /// 根据连接状态启用/禁用菜单项
    pub fn update_items(&mut self, connected: bool) {
        // 如果已连接，可能禁用某些选项
        // 如果未连接，可能启用重连选项
    }
}
```

### 场景4：托盘图标动画

```rust
// 连接状态动画图标

pub struct AnimatedTrayIcon {
    frames: Vec<Icon>,
    current_frame: usize,
    timer: Option<JoinHandle<()>>,
}

impl AnimatedTrayIcon {
    pub fn new_loading_animation() -> Result<Self> {
        // 创建加载动画帧
        let frames = (0..8).map(|i| {
            let degrees = i * 45;
            Self::create_rotated_icon(degrees)
        }).collect::<Result<Vec<_>>>()?;

        Ok(Self {
            frames,
            current_frame: 0,
            timer: None,
        })
    }

    /// 开始动画
    pub fn start_animation(&mut self, tray: &TrayIcon) {
        let tray = tray.clone();
        self.timer = Some(tokio::spawn(async move {
            let mut interval = tokio::time::interval(Duration::from_millis(100));
            loop {
                interval.tick().await;
                // 下一帧
            }
        }));
    }

    /// 停止动画
    pub fn stop_animation(&mut self) {
        if let Some(timer) = self.timer.take() {
            timer.abort();
        }
    }

    fn create_rotated_icon(degrees: u32) -> Result<Icon> {
        // 创建旋转后的图标
        // 使用图像处理库生成旋转帧
        Ok(Icon::from_rgba(vec![], 32, 32).unwrap())
    }
}
```

## 在本项目中的使用

用于实现 agent-client 的任务栏常驻和托盘菜单功能：

```
agent-client
    │
    ├── tray-icon (托盘图标)
    │       │
    │       ├── 托盘图标显示 (根据连接状态变化)
    │       ├── 右键菜单 (显示窗口、设置、退出)
    │       ├── 左键点击 (切换窗口可见性)
    │       └── 动态提示文本 (显示连接状态)
    │
    └── muda (菜单系统)
            │
            ├── Show Window
            ├── Agent Status (只读)
            ├── Open Settings
            └── Quit
```
