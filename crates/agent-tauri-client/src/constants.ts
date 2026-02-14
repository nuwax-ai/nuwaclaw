/**
 * 全局默认常量
 * 所有服务的默认端口、地址等配置集中管理
 */

// ========== 默认端口 ==========

/** 文件服务 (nuwax-file-server) 默认端口 */
export const DEFAULT_FILE_SERVER_PORT = 60000;

/** Agent 服务 (rcoder backend) 默认端口 */
export const DEFAULT_AGENT_PORT = 60001;

/** 代理服务 (rcoder proxy) 默认端口 */
export const DEFAULT_PROXY_PORT = 60002;

/** VNC 服务默认端口 */
export const DEFAULT_VNC_PORT = 5900;

/** MCP Proxy 服务默认端口 */
export const DEFAULT_MCP_PROXY_PORT = 18099;

// ========== 默认地址 ==========

/** 本地默认主机 */
export const DEFAULT_LOCAL_HOST = "127.0.0.1";

/** 默认 API 服务器地址 */
export const DEFAULT_SERVER_HOST = "https://agent.nuwax.com";

/** 默认 HTTPS 端口 */
export const DEFAULT_SERVER_PORT = 443;

/** 默认请求超时（毫秒） */
export const DEFAULT_TIMEOUT = 30000;

// ========== MCP Proxy 默认配置 ==========

/** MCP Proxy 默认 mcpServers 配置 */
export const DEFAULT_MCP_PROXY_CONFIG = JSON.stringify({
  mcpServers: {
    "chrome-devtools": {
      command: "npx",
      args: ["-y", "chrome-devtools-mcp@latest"],
    },
  },
});

// ========== 服务名称 ==========

/** 服务显示名称 */
export const SERVICE_NAMES = {
  NuwaxFileServer: "文件服务",
  NuwaxLanproxy: "代理服务",
  Rcoder: "Agent 服务",
  McpProxy: "MCP Proxy 服务",
} as const;

// ========== 服务描述 ==========

/** 服务描述 */
export const SERVICE_DESCRIPTIONS = {
  NuwaxFileServer: "Agent 工作目录文件远程管理服务",
  NuwaxLanproxy: "网络通道",
  Rcoder: "Agent 核心服务",
  McpProxy: "MCP 协议转换工具",
} as const;

// ========== Agent 状态文案 ==========

/** Agent 状态配置 */
export const AGENT_STATUS_CONFIG = {
  idle: { status: "default" as const, text: "就绪" },
  starting: { status: "warning" as const, text: "启动中" },
  running: { status: "success" as const, text: "运行中" },
  busy: { status: "success" as const, text: "繁忙" },
  stopped: { status: "default" as const, text: "已停止" },
  error: { status: "warning" as const, text: "错误" },
} as const;

// ========== 服务状态文案 ==========

/** 服务状态显示名称 */
export const SERVICE_STATE_NAMES = {
  Running: "运行中",
  Stopped: "已停止",
  Starting: "启动中",
  Stopping: "停止中",
  Error: "错误",
} as const;

// ========== 日志级别文案 ==========

/** 日志级别显示文案 */
export const LOG_LEVEL_LABELS = {
  all: "全部",
  info: "信息",
  success: "成功",
  warning: "警告",
  error: "错误",
} as const;

// ========== 依赖状态文案 ==========

/** 依赖状态显示文案 */
export const DEPENDENCY_STATUS_LABELS = {
  checking: "检查中",
  installed: "已安装",
  missing: "缺失",
  outdated: "版本过低",
  installing: "安装中",
  bundled: "应用集成",
  error: "错误",
} as const;

// ========== 通用操作文案 ==========

/** 通用操作文案 */
export const ACTION_MESSAGES = {
  starting: "启动中...",
  stopping: "停止中...",
  ready: "就绪",
  needConfig: "需配置",
  allReady: "所有依赖已就绪",
  allInstalled: "已就绪",
} as const;
