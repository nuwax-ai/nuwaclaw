//! 服务类型定义模块
//!
//! 定义服务相关的枚举类型、常量和类型别名

// 类型别名，解决 trait object 类型推断问题
pub(crate) type ChildWrapperType = Box<dyn process_wrap::tokio::ChildWrapper>;

// ========== 默认常量 ==========

/// MCP Proxy 默认监听端口
pub const DEFAULT_MCP_PROXY_PORT: u16 = 18099;

/// MCP Proxy 默认监听地址
pub const DEFAULT_MCP_PROXY_HOST: &str = "127.0.0.1";

/// MCP Proxy 默认可执行文件名
pub const DEFAULT_MCP_PROXY_BIN: &str = "mcp-proxy";

// ========== 服务枚举定义 ==========

/// 服务类型
#[derive(Debug, Clone, PartialEq)]
pub enum ServiceType {
    /// nuwax-file-server 服务
    NuwaxFileServer,
    /// nuwax-lanproxy 服务
    NuwaxLanproxy,
    /// HTTP Server (rcoder) 服务
    Rcoder,
    /// MCP Proxy 服务
    McpProxy,
}

/// 服务状态
#[derive(Debug, Clone, PartialEq)]
pub enum ServiceState {
    /// 停止
    Stopped,
    /// 运行中
    Running,
    /// 启动中
    Starting,
    /// 停止中
    Stopping,
    /// 错误
    Error(String),
}

/// 服务信息
#[derive(Debug, Clone)]
pub struct ServiceInfo {
    /// 服务类型
    pub service_type: ServiceType,
    /// 服务状态
    pub state: ServiceState,
    /// 进程 PID（如果是运行中）
    pub pid: Option<u32>,
}
