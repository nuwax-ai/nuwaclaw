/**
 * 应用常量配置
 *
 * 集中管理所有硬编码值，包括端口、URL、IP 地址、默认配置值、存储键名等
 * 便于统一维护和修改
 */

import type { AgentEngineType } from '@shared/types/electron';

// ==================== 应用名称 ====================

/** 应用对外显示名称（窗口标题、关于、安装包名称等），与 package.json build.productName 保持一致 */
export const APP_DISPLAY_NAME = 'NuwaClaw';

/** 应用技术标识（进程名、目录名等，小写字母），与 appId 等保持一致 */
export const APP_NAME_IDENTIFIER = 'nuwaclaw';

// ==================== 端口配置 ====================

/** MCP Proxy 默认端口 */
export const DEFAULT_MCP_PROXY_PORT = 18099;

/** Agent Runner 默认端口 */
export const DEFAULT_AGENT_RUNNER_PORT = 60006;

/** File Server 默认端口 */
export const DEFAULT_FILE_SERVER_PORT = 60005;

/** Lanproxy 默认端口 */
export const DEFAULT_LANPROXY_PORT = 60002;

/** 开发服务器默认端口 */
export const DEFAULT_DEV_SERVER_PORT = 60173;

// ==================== 主机 / IP 配置 ====================

/** 本地回环地址 */
export const LOCALHOST_IP = '127.0.0.1';

/** localhost 主机名 */
export const LOCALHOST_HOSTNAME = 'localhost';

/** 本地 HTTP 地址前缀 */
export const LOCAL_HOST_URL = 'http://127.0.0.1';

// ==================== API URL 配置 ====================

/** Anthropic API 默认地址 */
export const DEFAULT_ANTHROPIC_API_URL = 'https://api.anthropic.com';

/** 默认后端服务器地址 */
export const DEFAULT_SERVER_HOST = 'https://agent.nuwax.com';

// ==================== AI 默认配置 ====================

/** 默认 Agent 引擎类型 */
export const DEFAULT_AI_ENGINE: AgentEngineType = 'claude-code';

/** 默认 AI 模型 */
export const DEFAULT_AI_MODEL = 'claude-sonnet-4-20250514';

/** 默认最大 tokens */
export const DEFAULT_MAX_TOKENS = 4096;

/** 默认温度 */
export const DEFAULT_TEMPERATURE = 0.7;

/** 可用模型选项 */
export const MODEL_OPTIONS = [
  { label: 'Claude Opus 4', value: 'claude-opus-4-20250514' },
  { label: 'Claude Sonnet 4', value: 'claude-sonnet-4-20250514' },
  { label: 'Claude Haiku 3.5', value: 'claude-3-5-haiku-20241022' },
] as const;

// ==================== 超时配置 ====================

/** API 请求默认超时时间 (ms) */
export const DEFAULT_API_TIMEOUT = 30000;

/** SSE 默认重试延迟 (ms) */
export const DEFAULT_SSE_RETRY_DELAY = 3000;

/** SSE 最大重试延迟 (ms) */
export const DEFAULT_SSE_MAX_RETRY_DELAY = 30000;

/** 进程启动延迟 (ms) */
export const DEFAULT_STARTUP_DELAY = 3000;

/** 调度器每分钟间隔 (ms) */
export const DEFAULT_SCHEDULER_MINUTE_INTERVAL = 60000;

// ==================== 存储键名 ====================

/** Setup & Auth 相关存储键 */
export const STORAGE_KEYS = {
  SETUP_STATE: 'setup_state',
  STEP1_CONFIG: 'step1_config',
  AUTH_USER: 'auth_user',
  API_KEY: 'anthropic_api_key',
  MCP_CONFIG: 'mcp_config',
  MCP_PROXY_CONFIG: 'mcp_proxy_config',
  MCP_PROXY_PORT: 'mcp_proxy_port',
  LANPROXY_CONFIG: 'lanproxy_config',
  AGENT_CONFIG: 'agent_config',
} as const;

/** Auth 相关存储键 */
export const AUTH_KEYS = {
  USERNAME: 'auth.username',
  PASSWORD: 'auth.password',
  CONFIG_KEY: 'auth.config_key',
  SAVED_KEY: 'auth.saved_key',
  SAVED_KEYS_PREFIX: 'auth.saved_keys.',
  USER_INFO: 'auth.user_info',
  ONLINE_STATUS: 'auth.online_status',
  LANPROXY_SERVER_HOST: 'lanproxy.server_host',
  LANPROXY_SERVER_PORT: 'lanproxy.server_port',
} as const;

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

// ==================== 应用目录 ====================

/** 应用数据目录名称（与 APP_NAME_IDENTIFIER 对应，带点号前缀） */
export const APP_DATA_DIR_NAME = `.${APP_NAME_IDENTIFIER}`;

/** 日志目录名称 */
export const LOGS_DIR_NAME = 'logs';

/** MCP 日志目录名称 */
export const MCP_LOGS_DIR_NAME = 'mcp';

// ==================== MCP Proxy 配置 ====================

/** MCP Proxy 默认监听地址 */
export const DEFAULT_MCP_PROXY_HOST = LOCALHOST_IP;

// ==================== UI 文案常量 ====================

/** 成功消息 */
export const MSG_SUCCESS = {
  CONFIG_SAVED: '配置已保存',
  AI_CONFIG_SAVED: 'AI 配置已保存',
  AGENT_STARTED: 'Agent 启动成功',
  AGENT_STOPPED: 'Agent 已停止',
  MCP_STARTED: 'MCP Proxy 启动成功',
  MCP_STOPPED: 'MCP Proxy 已停止',
  MCP_RESTARTED: 'MCP Proxy 重启成功',
  MCP_CONFIG_SAVED: 'MCP 配置已保存',
  SERVICES_STARTED: '服务启动成功',
  SERVICES_STOPPED: '所有服务已停止',
  LOGIN_SUCCESS: '登录成功',
  LOGOUT_SUCCESS: '已退出登录',
  SETUP_SAVED: '基础配置已保存',
  DEPENDENCIES_INSTALLED: '依赖安装完成',
} as const;

/** 错误消息 */
export const MSG_ERROR = {
  CONFIG_SAVE_FAILED: '保存配置失败',
  AI_CONFIG_SAVE_FAILED: '保存 AI 配置失败',
  START_FAILED: '启动失败',
  STOP_FAILED: '停止失败',
  RESTART_FAILED: '重启失败',
  SAVE_FAILED: '保存失败',
  LOGIN_FAILED: '登录失败',
  LOGOUT_FAILED: '退出登录失败',
  LOAD_FAILED: '加载配置失败',
  DEPENDENCIES_INSTALL_FAILED: '安装失败',
  SETUP_LOAD_FAILED: '加载设置状态失败',
  OPEN_SETTINGS_FAILED: '无法打开系统设置',
  OPEN_LOGS_FAILED: '无法打开日志目录',
  OPEN_BROWSER_FAILED: '无法打开浏览器',
  INVALID_SESSION_URL: '无法获取会话地址',
} as const;

/** 警告消息 */
export const MSG_WARNING = {
  INCOMPLETE_LOGIN_INFO: '登录信息不完整，请重新登录',
  MISSING_DEPENDENCIES: '存在缺失依赖，请先安装',
  SERVER_DOMAIN_REQUIRED: '请输入服务域名',
  AGENT_PORT_REQUIRED: '请输入 Agent 端口',
  FILE_SERVER_PORT_REQUIRED: '请输入文件服务端口',
  PROXY_PORT_REQUIRED: '请输入代理服务端口',
  WORKSPACE_DIR_REQUIRED: '请选择工作区目录',
  USERNAME_AND_OTP_REQUIRED: '请输入账号和动态认证码',
  SERVER_ID_REQUIRED: '请输入 Server ID',
  ARGS_REQUIRED: '请输入参数',
  LOGIN_FIRST: '请先登录以获取代理服务配置',
} as const;

/** 提示消息 */
export const MSG_INFO = {
  ALL_SERVICES_RUNNING: '所有可自动启动的服务已在运行',
  NO_RUNNING_SERVICES: '没有正在运行的服务',
  NO_DEPENDENCIES_TO_INSTALL: '没有需要安装的依赖',
  SERVER_ADDED_REMEMBER_SAVE: '已添加，记得保存配置',
  SERVER_REMOVED_REMEMBER_SAVE: '已移除，记得保存配置',
  LOGIN_FIRST_SILENT: '请先登录以获取代理服务配置',
  ALREADY_LATEST_VERSION: '当前已是最新版本',
} as const;

// ==================== 依赖管理文案 ====================

/** 依赖状态显示文案 */
export const DEPENDENCY_STATUS_LABELS = {
  checking: '检查中',
  installed: '已安装',
  missing: '缺失',
  outdated: '版本过低',
  installing: '安装中',
  bundled: '应用集成',
  error: '错误',
} as const;

/** 通用操作文案 */
export const ACTION_MESSAGES = {
  starting: '启动中...',
  stopping: '停止中...',
  ready: '就绪',
  needConfig: '需配置',
  allReady: '所有依赖已就绪',
  allInstalled: '已就绪',
} as const;

// ==================== 服务相关文案 ====================

/** 服务显示名称 */
export const SERVICE_NAMES = {
  NuwaxFileServer: '文件服务',
  NuwaxLanproxy: '代理服务',
  Rcoder: 'Agent 服务',
  McpProxy: 'MCP Proxy 服务',
} as const;

/** 服务描述 */
export const SERVICE_DESCRIPTIONS = {
  NuwaxFileServer: 'Agent 工作目录文件远程管理服务',
  NuwaxLanproxy: '网络通道',
  Rcoder: 'Agent 核心服务',
  McpProxy: 'MCP 协议转换工具',
} as const;

/** Agent 状态配置 */
export const AGENT_STATUS_CONFIG = {
  idle: { status: 'default' as const, text: '就绪' },
  starting: { status: 'warning' as const, text: '启动中' },
  running: { status: 'success' as const, text: '运行中' },
  busy: { status: 'success' as const, text: '繁忙' },
  stopped: { status: 'default' as const, text: '已停止' },
  error: { status: 'warning' as const, text: '错误' },
} as const;

/** 服务状态显示名称 */
export const SERVICE_STATE_NAMES = {
  Running: '运行中',
  Stopped: '已停止',
  Starting: '启动中',
  Stopping: '停止中',
  Error: '错误',
} as const;
