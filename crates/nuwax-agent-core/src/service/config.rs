//! 服务配置模块
//!
//! 定义各服务的配置结构体及默认实现

use super::types::*;
use std::path::PathBuf;

// ========== 配置结构体定义 ==========

/// NuwaxFileServer 配置
#[derive(Debug, Clone)]
pub struct NuwaxFileServerConfig {
    /// 可执行文件完整路径
    pub bin_path: String,
    /// 端口
    pub port: u16,
    /// 环境
    pub env: String,
    /// 项目名称
    pub init_project_name: String,
    /// 项目目录
    pub init_project_dir: String,
    /// 上传目录
    pub upload_project_dir: String,
    /// 工作空间目录
    pub project_source_dir: String,
    /// 目标目录
    pub dist_target_dir: String,
    /// 日志基础目录
    pub log_base_dir: String,
    /// 工作空间目录
    pub computer_workspace_dir: String,
    /// 计算机日志目录
    pub computer_log_dir: String,
    /// 是否将 file-server 子进程的 stdout/stderr 捕获并写入 agent 的 tracing 日志（便于排查崩溃）。
    /// 对应 subapp-deployer 的 LOG_CONSOLE_ENABLED：file-server 端控制是否打 console；本项控制 agent 是否接管管道并落盘。
    pub capture_output_to_log: bool,
}

impl Default for NuwaxFileServerConfig {
    fn default() -> Self {
        // 注意：
        // - 这里不能依赖 Tauri 的 app_data_dir 等 API，只能使用相对路径来保持跨平台性
        // - 具体的工作目录由上层（例如 Tauri 客户端）在构造 NuwaxFileServerConfig 时覆盖
        // - 默认值仅用于纯 Rust 环境或测试场景，避免将 Linux 容器内的绝对路径硬编码到所有平台
        let workspace_root = PathBuf::from("./workspace");
        let logs_root = PathBuf::from("./logs");

        Self {
            bin_path: "nuwax-file-server".to_string(),
            port: 60000,
            env: "production".to_string(),
            init_project_name: "nuwax-template".to_string(),
            // 与 Tauri 端的约定保持一致：在 workspace 目录下使用 project_* 子目录
            init_project_dir: workspace_root
                .join("project_init")
                .to_string_lossy()
                .to_string(),
            upload_project_dir: workspace_root
                .join("project_zips")
                .to_string_lossy()
                .to_string(),
            project_source_dir: workspace_root
                .join("project_workspace")
                .to_string_lossy()
                .to_string(),
            dist_target_dir: workspace_root
                .join("project_nginx")
                .to_string_lossy()
                .to_string(),
            // 日志目录统一放在相对的 ./logs 下，避免依赖 /var 等特定系统路径
            log_base_dir: logs_root
                .join("project_logs")
                .to_string_lossy()
                .to_string(),
            computer_workspace_dir: workspace_root
                .join("computer-project-workspace")
                .to_string_lossy()
                .to_string(),
            computer_log_dir: logs_root
                .join("computer_logs")
                .to_string_lossy()
                .to_string(),
            capture_output_to_log: true,
        }
    }
}

/// MCP Proxy 配置
#[derive(Debug, Clone)]
pub struct McpProxyConfig {
    /// 可执行文件路径（默认 "mcp-proxy"，假设在 PATH 中）
    pub bin_path: String,
    /// 监听端口（默认 18099）
    pub port: u16,
    /// 监听主机地址（默认 "127.0.0.1"）
    pub host: String,
    /// mcpServers 配置（JSON 字符串，直接传递给 --config 参数）
    pub config_json: String,
}

impl Default for McpProxyConfig {
    fn default() -> Self {
        Self {
            bin_path: DEFAULT_MCP_PROXY_BIN.to_string(),
            port: DEFAULT_MCP_PROXY_PORT,
            host: DEFAULT_MCP_PROXY_HOST.to_string(),
            config_json: r#"{"mcpServers":{}}"#.to_string(),
        }
    }
}
