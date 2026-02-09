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

/** Lanproxy 远程代理默认端口 */
export const DEFAULT_LANPROXY_PORT = 60003;

/** MCP Server 默认端口 */
export const DEFAULT_MCP_SERVER_PORT = 60004;

/** VNC 服务默认端口 */
export const DEFAULT_VNC_PORT = 5900;

// ========== 默认地址 ==========

/** 本地默认主机 */
export const DEFAULT_LOCAL_HOST = "127.0.0.1";

/** 默认 API 服务器地址 */
export const DEFAULT_SERVER_HOST = "https://agent.nuwax.com";

/** 默认 HTTPS 端口 */
export const DEFAULT_SERVER_PORT = 443;

/** 默认请求超时（毫秒） */
export const DEFAULT_TIMEOUT = 30000;
