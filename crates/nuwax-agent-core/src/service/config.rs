//! 服务配置模块
//!
//! 定义各服务的配置结构体及默认实现

use super::types::*;

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
        Self {
            bin_path: "nuwax-file-server".to_string(),
            port: 60000,
            env: "production".to_string(),
            init_project_name: "nuwax-template".to_string(),
            init_project_dir: "/data/init".to_string(),
            upload_project_dir: "/data/zips".to_string(),
            project_source_dir: "/data/workspace".to_string(),
            dist_target_dir: "/var/www/nginx".to_string(),
            log_base_dir: "/var/logs/project_logs".to_string(),
            computer_workspace_dir: "/data/computer".to_string(),
            computer_log_dir: "/var/logs/computer".to_string(),
            capture_output_to_log: true,
        }
    }
}

/// NuwaxLanproxy 配置
#[derive(Debug, Clone)]
pub struct NuwaxLanproxyConfig {
    /// 可执行文件完整路径
    pub bin_path: String,
    /// 服务器 IP
    pub server_ip: String,
    /// 服务器端口
    pub server_port: u16,
    /// 客户端密钥
    pub client_key: String,
}

impl Default for NuwaxLanproxyConfig {
    fn default() -> Self {
        Self {
            bin_path: "nuwax-lanproxy".to_string(),
            server_ip: "127.0.0.1".to_string(),
            server_port: 60003,
            client_key: "test_key".to_string(),
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
