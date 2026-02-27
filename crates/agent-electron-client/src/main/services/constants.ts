/**
 * 主进程常量 (CommonJS)
 *
 * 部分从 @shared/constants 复用，主进程与渲染进程共用同一数据源
 */

import { APP_DATA_DIR_NAME } from '@shared/constants';
export { APP_DATA_DIR_NAME };

// ==================== 应用目录 ====================

/** 日志目录名称 */
export const LOGS_DIR_NAME = 'logs';

/** MCP 日志目录名称 */
export const MCP_LOGS_DIR_NAME = 'mcp';

// ==================== 端口配置 ====================

/** @deprecated MCP Proxy 不再使用端口（nuwax-mcp-stdio-proxy 为 stdio 直通模式） */
export const DEFAULT_MCP_PROXY_PORT = 18099;

/** @deprecated MCP Proxy 不再使用监听地址（nuwax-mcp-stdio-proxy 为 stdio 直通模式） */
export const DEFAULT_MCP_PROXY_HOST = '127.0.0.1';

/** 开发服务器默认端口 */
export const DEFAULT_DEV_SERVER_PORT = 60173;

// ==================== 主机/IP 配置 ====================

/** 本地回环地址 */
export const LOCALHOST_IP = '127.0.0.1';

/** localhost 主机名 */
export const LOCALHOST_HOSTNAME = 'localhost';

// ==================== 超时配置 ====================

/** 启动延迟 (ms) */
export const DEFAULT_STARTUP_DELAY = 3000;

/** SSE 默认重试延迟 (ms) */
export const DEFAULT_SSE_RETRY_DELAY = 3000;

/** SSE 最大重试延迟 (ms) */
export const DEFAULT_SSE_MAX_RETRY_DELAY = 30000;

// ==================== 镜像源配置 ====================

/** NPM 镜像源预设 */
export const NPM_MIRRORS = {
  OFFICIAL: 'https://registry.npmjs.org/',
  TAOBAO: 'https://registry.npmmirror.com/',
  TENCENT: 'https://mirrors.cloud.tencent.com/npm/',
} as const;

/** UV (PyPI) 镜像源预设 */
export const UV_MIRRORS = {
  OFFICIAL: 'https://pypi.org/simple/',
  TUNA: 'https://pypi.tuna.tsinghua.edu.cn/simple/',
  ALIYUN: 'https://mirrors.aliyun.com/pypi/simple/',
  TENCENT: 'https://mirrors.cloud.tencent.com/pypi/simple/',
} as const;

/** 默认镜像源配置 */
export const DEFAULT_MIRROR_CONFIG = {
  npmRegistry: NPM_MIRRORS.TAOBAO,
  uvIndexUrl: UV_MIRRORS.ALIYUN,
} as const;

