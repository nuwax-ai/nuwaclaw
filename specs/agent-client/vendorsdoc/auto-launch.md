# auto-launch

## 项目概述

跨平台应用开机自启动库，支持 Windows、macOS 和 Linux。

**GitHub**: https://github.com/zzzgydi/auto-launch.git
**本地路径**: `vendors/auto-launch`

## 目录结构

```
auto-launch/
├── src/
│   ├── lib.rs              # 公共 API
│   ├── windows.rs          # Windows 实现
│   ├── macos.rs            # macOS 实现
│   ├── linux.rs            # Linux 实现
│   └── error.rs            # 错误处理
├── Cargo.toml
└── README.md
```

## 核心依赖

```toml
[dependencies]
thiserror = "1.0"
os_info = "7.0"

# Windows
windows-registry = "0.2"
windows-result = "0.2"

# macOS
smappservice-rs = "0.3"

# Linux
dirs = "5.0"
```

## 核心 API

### AutoLaunchBuilder

```rust
// lib.rs

pub struct AutoLaunchBuilder {
    app_name: Option<String>,
    app_path: Option<String>,
    macos_launch_mode: MacOSLaunchMode,
    bundle_identifiers: Option<Vec<String>>,
    agent_extra_config: Option<String>,
    windows_enable_mode: WindowsEnableMode,
    linux_launch_mode: LinuxLaunchMode,
    args: Option<Vec<String>>,
}

impl AutoLaunchBuilder {
    pub fn new() -> Self;

    /// 设置应用名称
    pub fn set_app_name(&mut self, name: &str) -> &mut Self;

    /// 设置应用路径
    pub fn set_app_path(&mut self, path: &str) -> &mut Self;

    /// 设置 macOS 启动模式
    pub fn set_macos_launch_mode(&mut self, mode: MacOSLaunchMode) -> &mut Self;

    /// 设置 Windows 启用模式
    pub fn set_windows_enable_mode(&mut self, mode: WindowsEnableMode) -> &mut Self;

    /// 设置 Linux 启动模式
    pub fn set_linux_launch_mode(&mut self, mode: LinuxLaunchMode) -> &mut Self;

    /// 设置启动参数
    pub fn set_args(&mut self, args: &[impl AsRef<str>]) -> &mut Self;

    /// 构建 AutoLaunch
    pub fn build(&self) -> Result<AutoLaunch>;
}
```

### AutoLaunch

```rust
pub struct AutoLaunch {
    app_name: String,
    app_path: String,
    args: Vec<String>,
    // 平台特定配置...
}

impl AutoLaunch {
    /// 启用自启动
    pub async fn enable(&self) -> Result<()>;

    /// 禁用自启动
    pub async fn disable(&self) -> Result<()>;

    /// 检查是否已启用
    pub async fn is_enabled(&self) -> Result<bool>;
}
```

### 平台特定枚举

```rust
pub enum MacOSLaunchMode {
    /// 使用 SMAppService (macOS 13+)
    SMAppService,
    /// 使用 LaunchAgent
    LaunchAgent,
    /// 使用 AppleScript
    AppleScript,
}

pub enum WindowsEnableMode {
    /// 动态尝试（系统级 -> 用户级）
    Dynamic,
    /// 仅当前用户
    CurrentUser,
    /// 所有用户（需管理员权限）
    System,
}

pub enum LinuxLaunchMode {
    /// 使用 XDG Autostart
    XdgAutostart,
    /// 使用 systemd
    Systemd,
}
```

## 使用示例

```rust
use auto_launch::AutoLaunch;

#[tokio::main]
async fn main() -> Result<()> {
    let auto = AutoLaunchBuilder::new()
        .set_app_name("nuwax-agent")
        .set_app_path("/Applications/nuwax-agent.app")
        .set_args(&["--hidden", "--minimize"])
        .set_macos_launch_mode(MacOSLaunchMode::SMAppService)
        .build()?;

    // 检查是否已启用
    let is_enabled = auto.is_enabled().await?;
    println!("Auto launch enabled: {}", is_enabled);

    // 启用自启动
    if !is_enabled {
        auto.enable().await?;
    }

    Ok(())
}
```

## 平台实现

| 平台 | 实现方式 | 配置位置 |
|------|----------|----------|
| Windows | 注册表 | `HKCU\Software\Microsoft\Windows\CurrentVersion\Run` |
| macOS | SMAppService | `~/Library/LaunchAgents/` |
| Linux | XDG | `~/.config/autostart/` |

## 与 agent-client 集成场景

### 场景1：设置界面的自启动开关

```rust
// 在设置界面中集成自启动管理

use auto_launch::{AutoLaunch, AutoLaunchBuilder, MacOSLaunchMode};

pub struct AutoLaunchManager {
    auto_launch: AutoLaunch,
    // 当前状态（缓存，避免频繁读取）
    cached_enabled: bool,
}

impl AutoLaunchManager {
    pub fn new(app_name: &str, app_path: &str) -> Result<Self> {
        let auto = AutoLaunchBuilder::new()
            .set_app_name(app_name)
            .set_app_path(app_path)
            .set_macos_launch_mode(MacOSLaunchMode::SMAppService)  // macOS 13+
            .build()?;

        Ok(Self {
            auto_launch: auto,
            cached_enabled: false,
        })
    }

    /// 获取当前自启动状态
    pub async fn is_enabled(&self) -> Result<bool> {
        self.auto_launch.is_enabled().await
    }

    /// 启用自启动
    pub async fn enable(&self) -> Result<()> {
        self.auto_launch.enable().await
    }

    /// 禁用自启动
    pub async fn disable(&self) -> Result<()> {
        self.auto_launch.disable().await
    }

    /// 切换自启动状态
    pub async fn toggle(&self) -> Result<bool> {
        let enabled = self.is_enabled().await?;
        if enabled {
            self.disable().await?;
        } else {
            self.enable().await?;
        }
        Ok(!enabled)
    }
}

/// 设置界面中的自启动开关组件
pub struct AutoLaunchSwitch {
    manager: AutoLaunchManager,
    enabled: bool,
    loading: bool,
}

impl AutoLaunchSwitch {
    pub fn new(manager: AutoLaunchManager) -> Self {
        Self {
            manager,
            enabled: false,
            loading: true,
        }
    }

    /// 初始化时检查状态
    pub fn refresh_status(&mut self) {
        let manager = self.manager.clone();
        cx.spawn(|this, mut cx| async move {
            let enabled = manager.is_enabled().await.unwrap_or(false);
            this.update(&mut cx, |this, _| {
                this.enabled = enabled;
                this.loading = false;
            });
        });
    }
}

impl Render for AutoLaunchSwitch {
    fn render(&mut self, cx: &mut ViewContext<Self>) -> impl IntoElement {
        div()
            .flex()
            .items_center()
            .justify_between()
            .p_4()
            .rounded_md()
            .bg(cx.theme().colors.surface)
            .border_1()
            .border_color(cx.theme().colors.border)
            .child(
                div()
                    .flex()
                    .flex_col()
                    .gap_1()
                    .child(
                        div()
                            .font_medium()
                            .child("Auto Launch")
                    )
                    .child(
                        div()
                            .text_sm()
                            .text_color(cx.theme().colors.muted)
                            .child("Start application when system boots")
                    )
            )
            .child(
                match self.loading {
                    true => Loading::new().into_any_element(),
                    false => Switch::new(self.enabled, |enabled, _| {
                        // 切换自启动
                        let manager = self.manager.clone();
                        cx.spawn(|this, mut cx| async move {
                            let result = if enabled {
                                manager.disable().await
                            } else {
                                manager.enable().await
                            };

                            match result {
                                Ok(_) => {
                                    this.update(&mut cx, |this, _| {
                                        this.enabled = !enabled;
                                    });
                                }
                                Err(e) => {
                                    // 显示错误提示
                                    tracing::error!("Failed to toggle auto-launch: {}", e);
                                }
                            }
                        });
                    }).into_any_element(),
                }
            )
    }
}
```

### 场景2：应用启动时检查自启动状态

```rust
// 应用启动时的初始化逻辑

pub struct AppInitializer {
    auto_launch_manager: Option<AutoLaunchManager>,
}

impl AppInitializer {
    pub async fn initialize(&mut self, app_path: &str) -> Result<()> {
        // 1. 初始化自启动管理器
        self.auto_launch_manager = Some(
            AutoLaunchManager::new("nuwax-agent", app_path).ok()
        );

        // 2. 检查自启动是否已启用
        if let Some(manager) = &self.auto_launch_manager {
            let is_enabled = manager.is_enabled().await.unwrap_or(false);
            tracing::info!("Auto-launch enabled: {}", is_enabled);
        }

        // 3. 根据启动参数决定行为
        let args: Vec<String> = std::env::args().collect();

        // 如果是通过自启动触发的，可能需要最小化到托盘
        if args.iter().any(|arg| arg == "--minimize") {
            // 最小化到托盘，不显示主窗口
        }

        Ok(())
    }
}
```

### 场景3：跨平台注意事项

```rust
// 不同平台的自启动行为差异处理

#[cfg(target_os = "windows")]
mod windows_impl {
    use auto_launch::WindowsEnableMode;

    pub fn get_app_path() -> String {
        // Windows: 使用完整路径
        std::env::current_exe()
            .unwrap()
            .to_string_lossy()
            .into_owned()
    }

    pub fn build_auto_launch(name: &str, path: &str) -> auto_launch::AutoLaunchBuilder {
        AutoLaunchBuilder::new()
            .set_app_name(name)
            .set_app_path(path)
            .set_windows_enable_mode(WindowsEnableMode::CurrentUser)  // 当前用户
    }
}

#[cfg(target_os = "macos")]
mod macos_impl {
    use auto_launch::MacOSLaunchMode;

    pub fn get_app_path() -> String {
        // macOS: 使用 .app 路径
        std::env::current_exe()
            .unwrap()
            .to_string_lossy()
            .into_owned()
    }

    pub fn build_auto_launch(name: &str, path: &str) -> auto_launch::AutoLaunchBuilder {
        AutoLaunchBuilder::new()
            .set_app_name(name)
            .set_app_path(path)
            .set_macos_launch_mode(MacOSLaunchMode::SMAppService)  // macOS 13+
    }
}

#[cfg(target_os = "linux")]
mod linux_impl {
    use auto_launch::LinuxLaunchMode;

    pub fn get_app_path() -> String {
        std::env::current_exe()
            .unwrap()
            .to_string_lossy()
            .into_owned()
    }

    pub fn build_auto_launch(name: &str, path: &str) -> auto_launch::AutoLaunchBuilder {
        AutoLaunchBuilder::new()
            .set_app_name(name)
            .set_app_path(path)
            .set_linux_launch_mode(LinuxLaunchMode::XdgAutostart)
    }
}
```

## 在本项目中的使用

用于实现 agent-client 的开机自启动功能：

```
agent-client
    │
    └── auto-launch
            │
            ├── 检测自启动状态 (设置界面开关)
            ├── 启用自启动 (用户勾选开关)
            ├── 禁用自启动 (用户取消勾选)
            └── 应用启动时最小化到托盘
```
