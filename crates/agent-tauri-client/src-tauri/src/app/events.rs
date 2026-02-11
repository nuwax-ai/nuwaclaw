use crate::state::ServiceManagerState;
use tauri::Manager;

/// Tauri 应用主入口
///
/// 职责：
/// 1. 修复 PATH 环境变量（macOS/Linux GUI 应用）
/// 2. 初始化 Rustls CryptoProvider
/// 3. 初始化日志系统
/// 4. 构建并运行 Tauri 应用
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // ========== 修复 macOS GUI 应用的 PATH 环境变量 ==========
    // macOS GUI 应用不继承 shell 的 PATH (如 nvm 设置的 PATH)
    // 这导致 claude-code-acp-ts, nuwaxcode 等通过 nvm 安装的命令找不到
    // 我们通过调用用户的默认 shell 来获取正确的 PATH
    #[cfg(target_os = "macos")]
    {
        match crate::utils::fix_macos_path_env() {
            Ok(()) => {
                // 验证 PATH 是否包含 nvm 目录
                if let Ok(path) = std::env::var("PATH") {
                    let has_nvm = path.contains(".nvm");
                    println!(
                        "[PATH Fix] PATH fixed successfully, has_nvm={}, entries={}",
                        has_nvm,
                        path.split(':').count()
                    );
                    if has_nvm {
                        // 打印 nvm 相关的路径
                        for p in path.split(':').filter(|p| p.contains("nvm")) {
                            println!("[PATH Fix]   nvm path: {}", p);
                        }
                    }
                }
            }
            Err(e) => {
                eprintln!("[PATH Fix] Failed to fix PATH environment: {}", e);
            }
        }
    }

    // ========== 修复 Linux GUI 应用的 PATH 环境变量 ==========
    #[cfg(target_os = "linux")]
    {
        match crate::utils::fix_linux_path_env() {
            Ok(()) => {
                if let Ok(path) = std::env::var("PATH") {
                    println!(
                        "[PATH Fix] Linux PATH fixed successfully, entries={}",
                        path.split(':').count()
                    );
                }
            }
            Err(e) => {
                eprintln!("[PATH Fix] Failed to fix Linux PATH environment: {}", e);
            }
        }
    }

    // ========== 初始化 Rustls CryptoProvider ==========
    // 必须在最前面，在任何可能使用 TLS 的代码之前
    // 这解决了 rustls 0.23 的 "Could not automatically determine the process-level CryptoProvider" 问题
    // 使用 once_cell 确保只初始化一次，避免多次调用导致 panic
    static INIT: std::sync::OnceLock<()> = std::sync::OnceLock::new();
    let _ = INIT.get_or_init(|| {
        rustls::crypto::ring::default_provider()
            .install_default()
            .expect("Failed to install rustls crypto provider");
    });

    // ========== 初始化日志系统 ==========
    // 在其他代码之前初始化日志系统，使日志写入文件
    // 日志目录：macOS ~/Library/Application Support/nuwax-agent/logs/
    //          Linux ~/.local/share/nuwax-agent/logs/
    //          Windows %APPDATA%\nuwax-agent\logs\
    if let Err(e) = nuwax_agent_core::Logger::init("nuwax-agent") {
        eprintln!("[Logger] Failed to initialize logger: {}", e);
    }

    // ========== 构建并运行 Tauri 应用 ==========
    crate::app::create_app()
        .setup(crate::app::setup_hook)
        // 窗口关闭事件处理：隐藏到托盘而非退出
        // 注意：必须使用 block_on 同步等待服务停止，否则窗口隐藏后服务可能仍在运行
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                tracing::info!("[Window] 收到 CloseRequested 事件，停止所有服务并隐藏到托盘");
                // 阻止默认关闭行为，改为隐藏窗口
                api.prevent_close();

                // 同步等待服务停止，确保窗口隐藏前所有服务已停止
                let app_handle = window.app_handle().clone();
                let state = app_handle.state::<ServiceManagerState>();
                tauri::async_runtime::block_on(async {
                    let manager = state.manager.lock().await;
                    if let Err(e) = manager.services_stop_all().await {
                        tracing::error!("[Window] 停止服务失败: {}", e);
                    }
                    drop(manager);
                    let _ = window.hide();
                    tracing::info!("[Window] 窗口已隐藏到托盘");
                });
            }
        })
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app_handle, event| {
            // 应用退出事件处理：在退出前清理所有服务
            if let tauri::RunEvent::Exit = event {
                tracing::info!("[Exit] 应用正在退出，停止所有服务...");
                // 同步阻塞等待服务停止
                let state = app_handle.state::<ServiceManagerState>();
                // 使用 tauri::async_runtime 执行异步清理
                tauri::async_runtime::block_on(async {
                    let manager = state.manager.lock().await;
                    if let Err(e) = manager.services_stop_all().await {
                        tracing::error!("[Exit] 停止服务失败: {}", e);
                    }
                });
                tracing::info!("[Exit] 所有服务已停止");
            }
        });
}
