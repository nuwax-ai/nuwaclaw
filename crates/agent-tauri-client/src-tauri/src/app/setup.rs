use crate::state::ServiceManagerState;
use crate::tray::{setup_tray, update_tray_menu_async};
use tauri::Manager;

/// Tauri 应用 setup 钩子
///
/// 包含：
/// - updater 插件注册（仅桌面端）
/// - 系统托盘初始化
/// - CLI 参数解析与导航事件处理
/// - 跨平台信号处理器（Ctrl+C、SIGTERM 等）
pub fn setup_hook(app: &mut tauri::App) -> Result<(), Box<dyn std::error::Error>> {
    // ========== 注册 updater 插件（仅桌面端）==========
    #[cfg(desktop)]
    app.handle()
        .plugin(tauri_plugin_updater::Builder::new().build())?;

    // ========== 系统托盘初始化 ==========
    if let Err(e) = setup_tray(app) {
        log::error!("[Setup] 创建系统托盘失败: {}", e);
    } else {
        // 启动后延迟刷新托盘菜单，使「停止服务」/「开机自启动」勾选与真实状态一致
        let app_handle = app.handle().clone();
        tauri::async_runtime::spawn(async move {
            tokio::time::sleep(std::time::Duration::from_millis(600)).await;
            if let Err(e) = update_tray_menu_async(&app_handle).await {
                log::warn!("[Setup] 启动后刷新托盘菜单失败: {}", e);
            }
        });
    }

    // ========== CLI 参数解析与导航事件处理 ==========
    // 支持 --tab/-t 参数指定启动后跳转的 Tab
    // 示例: nuwax-agent --tab permissions
    //       nuwax-agent -t logs
    log::info!("[Setup] 开始解析 CLI 参数...");

    // 预定义合法的 Tab 名称列表，用于参数验证
    const VALID_TABS: &[&str] = &[
        "client",
        "settings",
        "dependencies",
        "permissions",
        "logs",
        "about",
    ];

    // 使用 tauri_plugin_cli 获取参数
    // 注意：在 tauri.conf.json 中已配置 cli args
    // 这里通过 ArgMatches 获取参数值
    #[allow(unexpected_cfgs)]
    #[cfg(feature = "cli-plugin")]
    {
        use tauri_plugin_cli::CliExt;
        let matches = app.cli().matches();

        match matches {
            Ok(matches) => {
                // 解析 --tab 参数
                if let Some(tab) = matches.value_of("tab") {
                    // 验证 Tab 名称是否合法
                    if VALID_TABS.contains(&tab) {
                        log::info!("[Setup] 检测到 CLI 参数 --tab={}", tab);

                        // 发送事件通知前端目标 Tab
                        match app.emit("navigate-to-tab", tab) {
                            Ok(()) => {
                                log::info!("[Setup] 已发送导航事件到前端，目标 Tab: {}", tab);
                            }
                            Err(e) => {
                                log::warn!("[Setup] 发送导航事件失败: {}", e);
                            }
                        }
                    } else {
                        log::warn!("[Setup] 无效的 Tab 参数: {}，有效值: {:?}", tab, VALID_TABS);
                    }
                }

                // 检查 --minimized 参数（启动时最小化）
                if matches.value_of("minimized") == Some("true")
                    || matches.occurrences_of("minimized") > 0
                {
                    log::info!("[Setup] 检测到 --minimized 参数，启动时将最小化");
                    if let Some(window) = app.get_webview_window("main") {
                        let _ = window.hide();
                        log::info!("[Setup] 窗口已隐藏到托盘");
                    }
                }
            }
            Err(e) => {
                log::warn!("[Setup] CLI 参数解析结果: {}", e);
            }
        }
    }

    // 没有 cli-plugin 时的日志提示
    #[allow(unexpected_cfgs)]
    #[cfg(not(feature = "cli-plugin"))]
    {
        log::info!("[Setup] CLI 插件未启用，命令行参数功能受限");
    }

    // ========== 跨平台信号处理器（Unix/macOS/Windows）==========
    // 当使用 Ctrl+C 或 kill 命令终止应用时，主动清理子进程
    // 这是因为子进程使用了独立的进程组（Unix）或 JobObject（Windows），
    // 不会自动收到发送给父进程的终止信号
    {
        let app_handle = app.handle().clone();
        tauri::async_runtime::spawn(async move {
            // 跨平台：等待 Ctrl+C 或终止信号
            #[cfg(unix)]
            {
                use tokio::signal::unix::{signal, SignalKind};

                let mut sigint =
                    signal(SignalKind::interrupt()).expect("Failed to register SIGINT handler");
                let mut sigterm =
                    signal(SignalKind::terminate()).expect("Failed to register SIGTERM handler");

                tokio::select! {
                    _ = sigint.recv() => {
                        log::info!("[Signal] 收到 SIGINT 信号，正在清理子进程...");
                    }
                    _ = sigterm.recv() => {
                        log::info!("[Signal] 收到 SIGTERM 信号，正在清理子进程...");
                    }
                }
            }

            #[cfg(windows)]
            {
                // Windows 上使用 ctrl_c() 处理 Ctrl+C
                if let Err(e) = tokio::signal::ctrl_c().await {
                    log::error!("[Signal] 等待 Ctrl+C 信号失败: {}", e);
                    return;
                }
                log::info!("[Signal] 收到 Ctrl+C 信号，正在清理子进程...");
            }

            // 主动停止所有服务
            let state = app_handle.state::<ServiceManagerState>();
            let manager = state.manager.lock().await;
            if let Err(e) = manager.services_stop_all().await {
                log::error!("[Signal] 停止服务失败: {}", e);
            }
            log::info!("[Signal] 子进程已清理，应用即将退出");

            // 退出应用
            app_handle.exit(0);
        });
    }

    Ok(())
}
