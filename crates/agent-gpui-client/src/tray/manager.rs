//! 托盘管理器
//!
//! 管理系统托盘图标和菜单

use std::sync::Arc;
use tokio::sync::mpsc;
use tracing::{error, info};
use tray_icon::{
    menu::{Menu, MenuEvent, MenuId, MenuItem, PredefinedMenuItem},
    Icon, TrayIcon, TrayIconBuilder, TrayIconEvent,
};

/// 托盘事件
#[derive(Debug, Clone)]
pub enum TrayEvent {
    /// 显示主窗口
    ShowWindow,
    /// 打开设置
    OpenSettings,
    /// 打开依赖管理
    OpenDependencies,
    /// 显示关于
    ShowAbout,
    /// 退出应用
    Quit,
    /// 左键点击图标
    LeftClick,
    /// 右键点击图标
    RightClick,
}

/// 托盘菜单项 ID
struct MenuIds {
    show_window: MenuId,
    settings: MenuId,
    dependencies: MenuId,
    about: MenuId,
    quit: MenuId,
}

/// 托盘管理器
pub struct TrayManager {
    /// 事件发送器
    event_tx: mpsc::Sender<TrayEvent>,
    /// 托盘图标（需要保持存活）
    _tray_icon: Option<TrayIcon>,
    /// 菜单项 ID（保持引用以供未来使用）
    #[allow(dead_code)]
    menu_ids: Arc<MenuIds>,
}

impl TrayManager {
    /// 创建新的托盘管理器
    ///
    /// 返回管理器实例和事件接收器
    pub fn new() -> anyhow::Result<(Self, mpsc::Receiver<TrayEvent>)> {
        let (event_tx, event_rx) = mpsc::channel(32);

        // 创建菜单
        let menu = Menu::new();

        let show_window = MenuItem::new("显示窗口", true, None);
        let settings = MenuItem::new("设置", true, None);
        let dependencies = MenuItem::new("依赖管理", true, None);
        let about = MenuItem::new("关于", true, None);
        let quit = MenuItem::new("退出", true, None);

        menu.append_items(&[
            &show_window,
            &PredefinedMenuItem::separator(),
            &settings,
            &dependencies,
            &PredefinedMenuItem::separator(),
            &about,
            &PredefinedMenuItem::separator(),
            &quit,
        ])
        .map_err(|e| anyhow::anyhow!("Failed to create menu: {}", e))?;

        let menu_ids = Arc::new(MenuIds {
            show_window: show_window.id().clone(),
            settings: settings.id().clone(),
            dependencies: dependencies.id().clone(),
            about: about.id().clone(),
            quit: quit.id().clone(),
        });

        // 创建托盘图标
        let icon = Self::create_default_icon()?;

        let tray_icon = TrayIconBuilder::new()
            .with_menu(Box::new(menu))
            .with_tooltip("Nuwax Agent")
            .with_icon(icon)
            .build()
            .map_err(|e| anyhow::anyhow!("Failed to create tray icon: {}", e))?;

        // 设置事件处理器
        let event_tx_clone = event_tx.clone();
        let menu_ids_clone = menu_ids.clone();
        MenuEvent::set_event_handler(Some(move |event: MenuEvent| {
            let menu_event = if event.id == menu_ids_clone.show_window {
                TrayEvent::ShowWindow
            } else if event.id == menu_ids_clone.settings {
                TrayEvent::OpenSettings
            } else if event.id == menu_ids_clone.dependencies {
                TrayEvent::OpenDependencies
            } else if event.id == menu_ids_clone.about {
                TrayEvent::ShowAbout
            } else if event.id == menu_ids_clone.quit {
                TrayEvent::Quit
            } else {
                return;
            };

            // 使用 try_send 避免阻塞
            if let Err(e) = event_tx_clone.try_send(menu_event) {
                error!("Failed to send menu event: {}", e);
            }
        }));

        let event_tx_clone = event_tx.clone();
        TrayIconEvent::set_event_handler(Some(move |event: TrayIconEvent| {
            let tray_event = match event {
                TrayIconEvent::Click {
                    button: tray_icon::MouseButton::Left,
                    ..
                } => TrayEvent::LeftClick,
                TrayIconEvent::Click {
                    button: tray_icon::MouseButton::Right,
                    ..
                } => TrayEvent::RightClick,
                TrayIconEvent::DoubleClick {
                    button: tray_icon::MouseButton::Left,
                    ..
                } => TrayEvent::ShowWindow,
                _ => return,
            };

            if let Err(e) = event_tx_clone.try_send(tray_event) {
                error!("Failed to send tray event: {}", e);
            }
        }));

        info!("Tray manager initialized");

        Ok((
            Self {
                event_tx,
                _tray_icon: Some(tray_icon),
                menu_ids,
            },
            event_rx,
        ))
    }

    /// 创建默认图标
    fn create_default_icon() -> anyhow::Result<Icon> {
        // 创建一个简单的 32x32 纯色图标
        // 实际应用中应该从资源文件加载
        let size = 32u32;
        let mut rgba = vec![0u8; (size * size * 4) as usize];

        // 填充为蓝色
        for y in 0..size {
            for x in 0..size {
                let idx = ((y * size + x) * 4) as usize;
                // 圆形图标
                let dx = x as i32 - 16;
                let dy = y as i32 - 16;
                if dx * dx + dy * dy <= 196 {
                    // 半径 14
                    rgba[idx] = 0x42; // R
                    rgba[idx + 1] = 0x9E; // G
                    rgba[idx + 2] = 0xE6; // B - 蓝色
                    rgba[idx + 3] = 0xFF; // A
                } else {
                    rgba[idx + 3] = 0x00; // 透明
                }
            }
        }

        Icon::from_rgba(rgba, size, size)
            .map_err(|e| anyhow::anyhow!("Failed to create icon: {}", e))
    }

    /// 从文件加载图标
    #[allow(dead_code)]
    pub fn load_icon_from_file(path: &std::path::Path) -> anyhow::Result<Icon> {
        let image = image::open(path)
            .map_err(|e| anyhow::anyhow!("Failed to open icon file: {}", e))?
            .into_rgba8();

        let (width, height) = image.dimensions();
        let rgba = image.into_raw();

        Icon::from_rgba(rgba, width, height)
            .map_err(|e| anyhow::anyhow!("Failed to create icon: {}", e))
    }

    /// 发送退出事件
    pub async fn request_quit(&self) -> anyhow::Result<()> {
        self.event_tx
            .send(TrayEvent::Quit)
            .await
            .map_err(|e| anyhow::anyhow!("Failed to send quit event: {}", e))
    }
}

impl Default for TrayManager {
    fn default() -> Self {
        // 这个实现不应该被使用，因为它没有事件接收器
        // 使用 new() 方法代替
        panic!("Use TrayManager::new() instead of Default");
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_create_default_icon() {
        let icon = TrayManager::create_default_icon();
        assert!(icon.is_ok());
    }
}
