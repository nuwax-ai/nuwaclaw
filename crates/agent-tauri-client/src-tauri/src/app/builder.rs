use crate::state::{LanproxyState, MonitorState, PermissionsState, ServiceManagerState};

/// 创建并配置 Tauri 应用构建器
///
/// 包含：
/// - 所有插件注册
/// - 所有状态管理
/// - 所有命令注册（invoke_handler）
pub fn create_app() -> tauri::Builder<tauri::Wry> {
    tauri::Builder::default()
        // ========== 插件注册 ==========
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_store::Builder::new().build())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_notification::init())
        // ========== 状态管理 ==========
        .manage(PermissionsState::default())
        .manage(MonitorState::default())
        .manage(ServiceManagerState::default())
        .manage(LanproxyState::default())
        // ========== 命令注册 ==========
        .invoke_handler(tauri::generate_handler![
            crate::commands::system_greet,
            crate::commands::check_disk_access,
            crate::commands::permission_check,
            crate::commands::permission_request,
            crate::commands::permission_open_settings,
            crate::commands::permission_list,
            crate::commands::permission_monitor_start,
            crate::commands::permission_monitor_stop,
            // 依赖管理命令
            crate::commands::dependency_list,
            crate::commands::dependency_summary,
            crate::commands::dependency_install,
            crate::commands::dependency_install_all,
            crate::commands::dependency_uninstall,
            crate::commands::dependency_check,
            // nuwax-lanproxy 命令
            crate::commands::lanproxy_start,
            crate::commands::lanproxy_stop,
            crate::commands::lanproxy_restart,
            // 服务管理命令
            crate::commands::file_server_start,
            crate::commands::file_server_stop,
            crate::commands::file_server_restart,
            crate::commands::rcoder_start,
            crate::commands::rcoder_stop,
            crate::commands::rcoder_restart,
            crate::commands::mcp_proxy_start,
            crate::commands::mcp_proxy_stop,
            crate::commands::mcp_proxy_restart,
            crate::commands::services_stop_all,
            crate::commands::services_restart_all,
            crate::commands::services_status_all,
            crate::commands::service_health,
            // 预检检查命令
            crate::commands::preflight_check,
            crate::commands::preflight_fix,
            // npm 依赖管理命令
            crate::commands::dependency_npm_install,
            crate::commands::dependency_npm_query_version,
            crate::commands::dependency_npm_reinstall,
            // 初始化向导命令
            crate::commands::app_data_dir_get,
            crate::commands::cache_dir_get,
            crate::commands::config_dir_get,
            crate::commands::network_port_check,
            crate::commands::firewall_guide_get,
            crate::commands::check_network_cn,
            crate::commands::dependency_local_env_init,
            crate::commands::dependency_node_detect,
            crate::commands::node_install_auto,
            crate::commands::dependency_uv_detect,
            crate::commands::uv_install_auto,
            crate::commands::dependency_local_check,
            crate::commands::dependency_local_install,
            crate::commands::dependency_local_check_latest,
            crate::commands::dependency_shell_installer_check,
            crate::commands::dependency_shell_installer_install,
            crate::commands::dependency_npm_global_check,
            crate::commands::dependency_npm_global_install,
            crate::commands::dialog_select_directory,
            // 日志相关命令
            crate::commands::log_dir_get,
            crate::commands::open_log_directory,
            crate::commands::read_logs,
            // 开机自启动命令
            crate::commands::autolaunch_set,
            crate::commands::autolaunch_get,
            crate::commands::autolaunch_diagnose,
            // 诊断与状态命令
            crate::commands::mcp_proxy_status,
            crate::commands::permission_requirements,
            crate::commands::tray_status,
        ])
}
