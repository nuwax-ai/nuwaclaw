use crate::models::*;
use auto_launch::AutoLaunchBuilder;

/// 创建 AutoLaunch 实例
/// 根据当前运行的应用信息构建
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
                path_str[..idx + 4].to_string() // 包含 .app
            } else {
                path_str
            }
        } else {
            path_str
        }
    };

    #[cfg(not(target_os = "macos"))]
    let app_path = exe_path.to_string_lossy().to_string();

    // 获取 bundle identifier
    let bundle_id = app.config().identifier.clone();

    // 构建 AutoLaunch
    let mut builder = AutoLaunchBuilder::new();
    builder
        .set_app_name(app_name)
        .set_app_path(&app_path)
        .set_args(&["--minimized"]); // 启动时最小化

    // macOS 特定设置
    #[cfg(target_os = "macos")]
    {
        builder.set_bundle_identifiers(&[&bundle_id]);
        builder.set_macos_launch_mode(auto_launch::MacOSLaunchMode::LaunchAgent);
    }

    // Windows 特定设置：仅当前用户
    #[cfg(target_os = "windows")]
    {
        builder.set_windows_enable_mode(auto_launch::WindowsEnableMode::CurrentUser);
    }

    builder
        .build()
        .map_err(|e| format!("创建 AutoLaunch 失败: {}", e))
}

/// 设置开机自启动
#[tauri::command]
pub async fn autolaunch_set(app: tauri::AppHandle, enabled: bool) -> Result<bool, String> {
    let auto_launch = create_auto_launch(&app)?;

    if enabled {
        auto_launch
            .enable()
            .map_err(|e| format!("启用开机自启动失败: {}", e))?;
        tracing::info!("[autolaunch_set] 已启用开机自启动");
    } else {
        auto_launch
            .disable()
            .map_err(|e| format!("禁用开机自启动失败: {}", e))?;
        tracing::info!("[autolaunch_set] 已禁用开机自启动");
    }

    Ok(enabled)
}

/// 获取开机自启动状态
#[tauri::command]
pub async fn autolaunch_get(app: tauri::AppHandle) -> Result<bool, String> {
    let auto_launch = create_auto_launch(&app)?;
    let enabled = auto_launch
        .is_enabled()
        .map_err(|e| format!("获取开机自启动状态失败: {}", e))?;
    tracing::info!("[autolaunch_get] 当前状态: {}", enabled);
    Ok(enabled)
}

/// 诊断开机自启动配置
/// 返回自启动的后端类型、配置路径和当前状态
#[tauri::command]
pub async fn autolaunch_diagnose(
    app: tauri::AppHandle,
) -> Result<AutolaunchDiagnoseResult, String> {
    let auto_launch = create_auto_launch(&app)?;
    let enabled = auto_launch
        .is_enabled()
        .map_err(|e| format!("获取状态失败: {}", e))?;

    #[cfg(target_os = "macos")]
    let (backend, config_path) = {
        let home = std::env::var("HOME").unwrap_or_default();
        let plist = std::path::PathBuf::from(&home)
            .join("Library/LaunchAgents/com.nuwax.agent-tauri-client.plist");
        (
            "LaunchAgent".to_string(),
            plist.to_string_lossy().to_string(),
        )
    };

    #[cfg(target_os = "windows")]
    let (backend, config_path) = {
        (
            "Registry (HKCU\\...\\Run)".to_string(),
            r"HKEY_CURRENT_USER\Software\Microsoft\Windows\CurrentVersion\Run".to_string(),
        )
    };

    #[cfg(target_os = "linux")]
    let (backend, config_path) = {
        let config_dir = std::env::var("XDG_CONFIG_HOME")
            .map(std::path::PathBuf::from)
            .unwrap_or_else(|_| {
                std::path::PathBuf::from(std::env::var("HOME").unwrap_or_default()).join(".config")
            });
        let path = config_dir.join("autostart/nuwax-agent.desktop");
        (
            "XDG Autostart".to_string(),
            path.to_string_lossy().to_string(),
        )
    };

    #[cfg(not(any(target_os = "macos", target_os = "windows", target_os = "linux")))]
    let (backend, config_path) = ("Unknown".to_string(), "N/A".to_string());

    let config_exists = std::path::Path::new(&config_path).exists();

    Ok(AutolaunchDiagnoseResult {
        enabled,
        backend,
        config_path,
        config_exists,
    })
}
