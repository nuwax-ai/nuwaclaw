use crate::models::*;

/// 查询系统托盘状态
#[tauri::command]
pub fn tray_status(app: tauri::AppHandle) -> TrayStatusResult {
    // 检查托盘图标是否存在
    let has_tray = app.tray_by_id("main").is_some() || app.default_window_icon().is_some();

    if has_tray {
        TrayStatusResult {
            available: true,
            reason: None,
        }
    } else {
        #[cfg(target_os = "linux")]
        let reason = "系统托盘可能不可用。请确保安装了 AppIndicator 扩展（GNOME 43+ 需要 gnome-shell-extension-appindicator）。".to_string();
        #[cfg(not(target_os = "linux"))]
        let reason = "系统托盘图标未创建".to_string();

        TrayStatusResult {
            available: false,
            reason: Some(reason),
        }
    }
}
