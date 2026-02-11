use tauri::{
    menu::{CheckMenuItem, Menu, MenuItem},
    tray::TrayIconBuilder,
    Manager,
};
use tauri_plugin_notification::NotificationExt;

use crate::commands::services_restart_all;
use crate::state::ServiceManagerState;
use crate::tray::ids::*;

/// 创建自启动配置
fn create_auto_launch(app: &tauri::AppHandle) -> Result<auto_launch::AutoLaunch, String> {
    // 从 tauri.conf.json 的 productName 获取应用名称
    let app_name = app
        .config()
        .product_name
        .as_deref()
        .unwrap_or("NuWax Agent");

    // 获取应用可执行文件路径
    let exe_path = std::env::current_exe().map_err(|e| format!("获取应用路径失败: {}", e))?;

    // macOS 上需要获取 .app bundle 路径，而不是内部的可执行文件路径
    #[cfg(target_os = "macos")]
    let app_path = {
        // 路径格式: /Applications/xxx.app/Contents/MacOS/xxx
        // 需要回退到 .app 目录
        let path_str = exe_path.to_string_lossy().to_string();
        if path_str.contains(".app/Contents/MacOS") {
            // 找到 .app 的位置并截取
            if let Some(idx) = path_str.find(".app/") {
                std::path::PathBuf::from(&path_str[..idx + 4])
            } else {
                exe_path
            }
        } else {
            exe_path
        }
    };

    #[cfg(not(target_os = "macos"))]
    let app_path = exe_path;

    auto_launch::AutoLaunchBuilder::new()
        .set_app_name(app_name)
        .set_app_path(app_path.to_string_lossy().as_ref())
        .build()
        .map_err(|e| format!("创建 AutoLaunch 失败: {}", e))
}

/// 更新托盘菜单（自动获取自启动状态和服务状态）
/// 异步版本：在已处于 async runtime 内调用时使用，避免 block_on 导致 "Cannot start a runtime from within a runtime" panic
pub async fn update_tray_menu_async(
    app_handle: &tauri::AppHandle,
) -> Result<(), Box<dyn std::error::Error>> {
    use tauri::menu::MenuItemKind;

    // 获取自启动状态
    let autolaunch_enabled = create_auto_launch(app_handle)
        .and_then(|al| Ok(al.is_enabled().unwrap_or(false)))
        .unwrap_or(false);

    // 获取服务状态（使用 await，禁止在 runtime 内使用 block_on）
    let state = app_handle.state::<ServiceManagerState>();
    let lock_result =
        tokio::time::timeout(std::time::Duration::from_millis(500), state.manager.lock()).await;

    let services_running = match lock_result {
        Ok(manager) => {
            let statuses = manager.services_status_all().await;
            statuses
                .iter()
                .any(|s| matches!(s.state, nuwax_agent_core::service::ServiceState::Running))
        }
        Err(_) => {
            warn!("[Tray] 获取服务状态超时，默认禁用停止服务");
            false
        }
    };

    // 重新创建菜单项
    let show_i = MenuItem::with_id(app_handle, SHOW, "显示主窗口", true, None::<&str>)?;
    let separator1 = tauri::menu::PredefinedMenuItem::separator(app_handle)?;
    let services_restart_i = MenuItem::with_id(
        app_handle,
        SERVICES_RESTART,
        "重启服务",
        true, // 始终启用重启服务
        None::<&str>,
    )?;
    let services_stop_i = MenuItem::with_id(
        app_handle,
        SERVICES_STOP,
        "停止服务",
        services_running, // 只有在服务运行时才启用停止
        None::<&str>,
    )?;
    let separator2 = tauri::menu::PredefinedMenuItem::separator(app_handle)?;
    let autolaunch_i = CheckMenuItem::with_id(
        app_handle,
        AUTOLAUNCH,
        "开机自启动",
        true,
        autolaunch_enabled,
        None::<&str>,
    )?;
    let separator3 = tauri::menu::PredefinedMenuItem::separator(app_handle)?;
    let quit_i = MenuItem::with_id(app_handle, QUIT, "退出", true, None::<&str>)?;

    // 构建新菜单
    let new_menu = Menu::with_items(
        app_handle,
        &[
            &MenuItemKind::MenuItem(show_i),
            &MenuItemKind::Predefined(separator1),
            &MenuItemKind::MenuItem(services_restart_i),
            &MenuItemKind::MenuItem(services_stop_i),
            &MenuItemKind::Predefined(separator2),
            &MenuItemKind::Check(autolaunch_i),
            &MenuItemKind::Predefined(separator3),
            &MenuItemKind::MenuItem(quit_i),
        ],
    )?;

    // 更新托盘图标的菜单
    match app_handle.tray_by_id("main") {
        Some(tray) => tray.set_menu(Some(new_menu))?,
        None => warn!("[Tray] 未找到 id=main 的托盘，跳过菜单更新"),
    }

    Ok(())
}

/// 设置系统托盘
pub fn setup_tray(app: &tauri::App) -> Result<(), Box<dyn std::error::Error>> {
    use tauri::menu::MenuItemKind;

    // 获取当前自启动状态
    let autolaunch_enabled = create_auto_launch(&app.handle())
        .and_then(|al| Ok(al.is_enabled().unwrap_or(false)))
        .unwrap_or(false);

    // 创建菜单项
    let show_i = MenuItem::with_id(app, SHOW, "显示主窗口", true, None::<&str>)?;
    let separator1 = tauri::menu::PredefinedMenuItem::separator(app)?;
    let services_restart_i =
        MenuItem::with_id(app, SERVICES_RESTART, "重启服务", true, None::<&str>)?;
    let services_stop_i = MenuItem::with_id(app, SERVICES_STOP, "停止服务", true, None::<&str>)?;
    let separator2 = tauri::menu::PredefinedMenuItem::separator(app)?;
    let autolaunch_i = CheckMenuItem::with_id(
        app,
        AUTOLAUNCH,
        "开机自启动",
        true,
        autolaunch_enabled,
        None::<&str>,
    )?;
    let separator3 = tauri::menu::PredefinedMenuItem::separator(app)?;
    let quit_i = MenuItem::with_id(app, QUIT, "退出", true, None::<&str>)?;

    // 构建菜单
    let menu = Menu::with_items(
        app,
        &[
            &MenuItemKind::MenuItem(show_i),
            &MenuItemKind::Predefined(separator1),
            &MenuItemKind::MenuItem(services_restart_i),
            &MenuItemKind::MenuItem(services_stop_i),
            &MenuItemKind::Predefined(separator2),
            &MenuItemKind::Check(autolaunch_i.clone()),
            &MenuItemKind::Predefined(separator3),
            &MenuItemKind::MenuItem(quit_i),
        ],
    )?;

    // 创建托盘图标
    let _tray = TrayIconBuilder::with_id("main")
        .icon(app.default_window_icon().unwrap().clone())
        .menu(&menu)
        .show_menu_on_left_click(true) // 左键点击显示菜单
        .on_menu_event(|app, event| {
            match event.id.as_ref() {
                SHOW => {
                    if let Some(window) = app.get_webview_window("main") {
                        let _ = window.show();
                        let _ = window.set_focus();
                    }
                }
                SERVICES_RESTART => {
                    let app_handle = app.clone();
                    tauri::async_runtime::spawn(async move {
                        info!("[Tray] 重启所有服务...");
                        let state = app_handle.state::<ServiceManagerState>();
                        let lanproxy_state = app_handle.state::<crate::state::LanproxyState>();
                        match services_restart_all(app_handle.clone(), state, lanproxy_state).await {
                            Ok(_) => info!("[Tray] 所有服务已重启"),
                            Err(e) => error!("[Tray] 重启服务失败: {}", e),
                        }
                        // 无论成功失败都刷新菜单，使「停止服务」与当前服务状态一致
                        if let Err(e) = update_tray_menu_async(&app_handle).await {
                            error!("[Tray] 更新托盘菜单失败: {}", e);
                        }
                    });
                }
                SERVICES_STOP => {
                    let app_handle = app.clone();
                    tauri::async_runtime::spawn(async move {
                        let state = app_handle.state::<ServiceManagerState>();
                        let lanproxy_state = app_handle.state::<crate::state::LanproxyState>();
                        match crate::commands::services::services_stop_all(state, lanproxy_state).await {
                            Ok(_) => {
                                info!("[Tray] 所有服务已停止");
                            }
                            Err(e) => {
                                error!("[Tray] 停止服务失败: {}", e);
                            }
                        }
                        // 无论成功失败都刷新菜单，使「停止服务」与当前服务状态一致
                        if let Err(e) = update_tray_menu_async(&app_handle).await {
                            error!("[Tray] 更新托盘菜单失败: {}", e);
                        }
                    });
                }
                AUTOLAUNCH => {
                    // 切换开机自启动状态
                    let app_handle = app.clone();
                    tauri::async_runtime::spawn(async move {
                        match create_auto_launch(&app_handle) {
                            Ok(auto_launch) => {
                                let current = auto_launch.is_enabled().unwrap_or(false);
                                let result = if current {
                                    auto_launch.disable()
                                } else {
                                    auto_launch.enable()
                                };
                                match result {
                                    Ok(()) => {
                                        let new_state = !current;
                                        info!(
                                            "[Tray] 开机自启动已{}",
                                            if new_state { "启用" } else { "禁用" }
                                        );
                                        // 系统通知提示，便于用户确认已生效
                                        let body = if new_state {
                                            "已开启开机自启动"
                                        } else {
                                            "已关闭开机自启动"
                                        };
                                        if let Err(e) = app_handle
                                            .notification()
                                            .builder()
                                            .title("NuWax Agent")
                                            .body(body)
                                            .show()
                                        {
                                            tracing::warn!("[Tray] 发送开机自启动通知失败: {}", e);
                                        }
                                        // 重新创建菜单以更新勾选状态（使用 async 避免 runtime 内 block_on panic）
                                        if let Err(e) = update_tray_menu_async(&app_handle).await {
                                            error!("[Tray] 更新托盘菜单失败: {}", e);
                                        }
                                    }
                                    Err(e) => {
                                        error!("[Tray] 切换开机自启动失败: {}", e);
                                        // 失败时也通知用户，避免无反馈
                                        let _ = app_handle
                                            .notification()
                                            .builder()
                                            .title("NuWax Agent")
                                            .body("开机自启动设置失败，请检查系统权限或重试")
                                            .show();
                                        // 刷新菜单使勾选与系统实际状态一致
                                        if let Err(e) = update_tray_menu_async(&app_handle).await {
                                            error!("[Tray] 更新托盘菜单失败: {}", e);
                                        }
                                    }
                                }
                            }
                            Err(e) => {
                                error!("[Tray] 创建 AutoLaunch 失败: {}", e);
                                let _ = app_handle
                                    .notification()
                                    .builder()
                                    .title("NuWax Agent")
                                    .body("无法读取开机自启动状态，请检查应用配置")
                                    .show();
                            }
                        }
                    });
                }
                QUIT => {
                    // 停止服务后退出
                    let app_handle = app.clone();
                    tauri::async_runtime::spawn(async move {
                        let state = app_handle.state::<ServiceManagerState>();
                        let lanproxy_state = app_handle.state::<crate::state::LanproxyState>();
                        if let Err(e) = crate::commands::services::services_stop_all(state, lanproxy_state).await {
                            error!("[Tray] 退出前停止服务失败: {}", e);
                        }
                        info!("[Tray] 应用退出");
                        app_handle.exit(0);
                    });
                }
                _ => {}
            }
        })
        .build(app)?;

    info!("[Tray] 系统托盘已创建");
    Ok(())
}
