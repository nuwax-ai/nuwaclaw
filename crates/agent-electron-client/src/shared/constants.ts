/**
 * 应用常量配置
 *
 * 集中管理所有硬编码值，包括端口、URL、IP 地址、默认配置值、存储键名等
 * 便于统一维护和修改
 */

import type { AgentEngineType } from "@shared/types/electron";

// ==================== 应用名称 ====================

/** 应用对外显示名称（窗口标题、关于、安装包名称等），与 package.json build.productName 保持一致 */
export const APP_DISPLAY_NAME = "NuwaClaw";

/** 应用技术标识（进程名、目录名等，小写字母），与 appId 等保持一致 */
export const APP_NAME_IDENTIFIER = "nuwaclaw";

// ==================== 端口配置 ====================

/** MCP Proxy 默认端口 */
export const DEFAULT_MCP_PROXY_PORT = 18099;

/** Agent Runner 默认端口 */
export const DEFAULT_AGENT_RUNNER_PORT = 60006;

/** File Server 默认端口 */
export const DEFAULT_FILE_SERVER_PORT = 60005;

/** Lanproxy 默认端口 */
export const DEFAULT_LANPROXY_PORT = 60002;

/** GUI Agent MCP 默认端口 */
export const DEFAULT_GUI_MCP_PORT = 60008;

/** Admin Server 默认端口（管理接口） */
export const DEFAULT_ADMIN_SERVER_PORT = 60007;

/** 开发服务器默认端口 */
export const DEFAULT_DEV_SERVER_PORT = 60173;

// ==================== 主机 / IP 配置 ====================

/** 本地回环地址 */
export const LOCALHOST_IP = "127.0.0.1";

/** localhost 主机名 */
export const LOCALHOST_HOSTNAME = "localhost";

/** 本地 HTTP 地址前缀 */
export const LOCAL_HOST_URL = "http://127.0.0.1";

// ==================== API URL 配置 ====================

/** Anthropic API 默认地址 */
export const DEFAULT_ANTHROPIC_API_URL = "https://api.anthropic.com";

/** 默认后端服务器地址 */
export const DEFAULT_SERVER_HOST = "https://agent.nuwax.com";

// ==================== AI 默认配置 ====================

/** 默认 Agent 引擎类型 */
export const DEFAULT_AI_ENGINE: AgentEngineType = "claude-code";

/** 默认 AI 模型 */
export const DEFAULT_AI_MODEL = "claude-sonnet-4-20250514";

/** 默认最大 tokens */
export const DEFAULT_MAX_TOKENS = 4096;

/** 默认温度 */
export const DEFAULT_TEMPERATURE = 0.7;

/** 可用模型选项 */
export const MODEL_OPTIONS = [
  { label: "Claude Opus 4", value: "claude-opus-4-20250514" },
  { label: "Claude Sonnet 4", value: "claude-sonnet-4-20250514" },
  { label: "Claude Haiku 3.5", value: "claude-3-5-haiku-20241022" },
] as const;

// ==================== 超时配置 ====================

/** API 请求默认超时时间 (ms) */
export const DEFAULT_API_TIMEOUT = 60000;

/** SSE 默认重试延迟 (ms) */
export const DEFAULT_SSE_RETRY_DELAY = 5000;

/** SSE 最大重试延迟 (ms) */
export const DEFAULT_SSE_MAX_RETRY_DELAY = 60000;

/** SSE 心跳间隔 (ms) */
export const DEFAULT_SSE_HEARTBEAT_INTERVAL = 30000;

/** 进程启动延迟 (ms) */
export const DEFAULT_STARTUP_DELAY = 3000;

/** 调度器每分钟间隔 (ms) */
export const DEFAULT_SCHEDULER_MINUTE_INTERVAL = 60000;

/** 应用退出清理超时 (ms)。注意：此值小于 ENGINE_DESTROY_TIMEOUT，引擎销毁可能被截断，但保证应用不会卡死 */
export const CLEANUP_TIMEOUT = 15_000;

/** 进程 SIGTERM→SIGKILL 升级超时 (ms) */
export const PROCESS_KILL_ESCALATION_TIMEOUT = 5000;

/** ACP 会话取消超时 (ms) */
export const ACP_ABORT_TIMEOUT = 15_000;

/**
 * 用户主动取消会话时，挂在 `Error` 上的 `code`（与 `message` 语言无关）。
 * `message` 经主进程 `t()` 本地化后，`isPromptCancellation` 仍靠此字段识别，避免误触发 MCP 重试。
 */
export const ACP_SESSION_CANCELLED_ERROR_CODE =
  "ACP_SESSION_CANCELLED" as const;

/** 引擎销毁超时 (ms) */
export const ENGINE_DESTROY_TIMEOUT = 20_000;

/** 依赖同步超时 (ms) */
export const DEPS_SYNC_TIMEOUT = 120_000;

// ==================== 存储键名 ====================

/** Setup & Auth 相关存储键 */
export const STORAGE_KEYS = {
  SETUP_STATE: "setup_state",
  STEP1_CONFIG: "step1_config",
  AUTH_USER: "auth_user",
  API_KEY: "anthropic_api_key",
  MCP_CONFIG: "mcp_config",
  MCP_PROXY_CONFIG: "mcp_proxy_config",
  MCP_PROXY_PORT: "mcp_proxy_port",
  LANPROXY_CONFIG: "lanproxy_config",
  AGENT_CONFIG: "agent_config",
} as const;

/** Auth 相关存储键 */
export const AUTH_KEYS = {
  USERNAME: "auth.username",
  PASSWORD: "auth.password",
  CONFIG_KEY: "auth.config_key",
  SAVED_KEY: "auth.saved_key",
  SAVED_KEYS_PREFIX: "auth.saved_keys.",
  USER_INFO: "auth.user_info",
  ONLINE_STATUS: "auth.online_status",
  AUTH_TOKEN: "auth.token",
  LANPROXY_SERVER_HOST: "lanproxy.server_host",
  LANPROXY_SERVER_PORT: "lanproxy.server_port",
} as const;

// ==================== 镜像源配置 ====================

/** NPM 镜像源预设 */
export const NPM_MIRRORS = {
  OFFICIAL: "https://registry.npmjs.org/",
  TAOBAO: "https://registry.npmmirror.com/",
  TENCENT: "https://mirrors.cloud.tencent.com/npm/",
} as const;

/** UV (PyPI) 镜像源预设 */
export const UV_MIRRORS = {
  OFFICIAL: "https://pypi.org/simple/",
  TUNA: "https://pypi.tuna.tsinghua.edu.cn/simple/",
  ALIYUN: "https://mirrors.aliyun.com/pypi/simple/",
  TENCENT: "https://mirrors.cloud.tencent.com/pypi/simple/",
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
export const LOGS_DIR_NAME = "logs";

/** MCP 日志目录名称 */
export const MCP_LOGS_DIR_NAME = "mcp";

// ==================== MCP Proxy 配置 ====================

/** MCP Proxy 默认监听地址 */
export const DEFAULT_MCP_PROXY_HOST = LOCALHOST_IP;

// ==================== i18n Key 常量 ====================

/**
 * i18n 翻译 key 常量
 * 格式：{Client}.{Scope}.{Domain}.{key}
 * Client: Claw (Electron 客户端)
 *
 * 用于在代码中引用翻译 key，避免拼写错误
 * 后端 /api/i18n/query 返回的翻译 map 以这些 key 为键
 */
export const I18N_KEYS = {
  // 通用错误文案 Errors（主进程 / 渲染进程均可引用 key）
  Errors: {
    SESSION_CANCELLED: "Claw.Errors.sessionCancelled",
  },

  // 通用 Common
  Common: {
    LOADING: "Claw.Common.loading",
    SAVE: "Claw.Common.save",
    CANCEL: "Claw.Common.cancel",
    CONFIRM: "Claw.Common.confirm",
    DELETE: "Claw.Common.delete",
    EDIT: "Claw.Common.edit",
    ADD: "Claw.Common.add",
    OPEN: "Claw.Common.open",
    CLOSE: "Claw.Common.close",
    RETRY: "Claw.Common.retry",
    NO_DATA: "Claw.Common.noData",
    BACK: "Claw.Common.back",
    REFRESH: "Claw.Common.refresh",
  },

  // 成功消息 Toast.Success
  Toast: {
    SUCCESS: {
      CONFIG_SAVED: "Claw.Toast.Success.configSaved",
      AI_CONFIG_SAVED: "Claw.Toast.Success.aiConfigSaved",
      AGENT_STARTED: "Claw.Toast.Success.agentStarted",
      AGENT_STOPPED: "Claw.Toast.Success.agentStopped",
      MCP_STARTED: "Claw.Toast.Success.mcpStarted",
      MCP_STOPPED: "Claw.Toast.Success.mcpStopped",
      MCP_RESTARTED: "Claw.Toast.Success.mcpRestarted",
      MCP_CONFIG_SAVED: "Claw.Toast.Success.mcpConfigSaved",
      SERVICES_STARTED: "Claw.Toast.Success.servicesStarted",
      SERVICES_STOPPED: "Claw.Toast.Success.servicesStopped",
      LOGIN_SUCCESS: "Claw.Toast.Success.loginSuccess",
      LOGOUT_SUCCESS: "Claw.Toast.Success.logoutSuccess",
      SETUP_SAVED: "Claw.Toast.Success.setupSaved",
      DEPENDENCIES_INSTALLED: "Claw.Toast.Success.dependenciesInstalled",
    },
    ERROR: {
      CONFIG_SAVE_FAILED: "Claw.Toast.Error.configSaveFailed",
      AI_CONFIG_SAVE_FAILED: "Claw.Toast.Error.aiConfigSaveFailed",
      START_FAILED: "Claw.Toast.Error.startFailed",
      STOP_FAILED: "Claw.Toast.Error.stopFailed",
      RESTART_FAILED: "Claw.Toast.Error.restartFailed",
      SAVE_FAILED: "Claw.Toast.Error.saveFailed",
      LOGIN_FAILED: "Claw.Toast.Error.loginFailed",
      LOGOUT_FAILED: "Claw.Toast.Error.logoutFailed",
      LOAD_FAILED: "Claw.Toast.Error.loadFailed",
      DEPENDENCIES_INSTALL_FAILED: "Claw.Toast.Error.dependenciesInstallFailed",
      SETUP_LOAD_FAILED: "Claw.Toast.Error.setupLoadFailed",
      OPEN_SETTINGS_FAILED: "Claw.Toast.Error.openSettingsFailed",
      OPEN_LOGS_FAILED: "Claw.Toast.Error.openLogsFailed",
      OPEN_BROWSER_FAILED: "Claw.Toast.Error.openBrowserFailed",
      INVALID_SESSION_URL: "Claw.Toast.Error.invalidSessionUrl",
    },
    WARNING: {
      INCOMPLETE_LOGIN_INFO: "Claw.Toast.Warning.incompleteLoginInfo",
      MISSING_DEPENDENCIES: "Claw.Toast.Warning.missingDependencies",
      SERVER_DOMAIN_REQUIRED: "Claw.Toast.Warning.serverDomainRequired",
      AGENT_PORT_REQUIRED: "Claw.Toast.Warning.agentPortRequired",
      FILE_SERVER_PORT_REQUIRED: "Claw.Toast.Warning.fileServerPortRequired",
      PROXY_PORT_REQUIRED: "Claw.Toast.Warning.proxyPortRequired",
      WORKSPACE_DIR_REQUIRED: "Claw.Toast.Warning.workspaceDirRequired",
      USERNAME_AND_OTP_REQUIRED: "Claw.Toast.Warning.usernameAndOtpRequired",
      SERVER_ID_REQUIRED: "Claw.Toast.Warning.serverIdRequired",
      ARGS_REQUIRED: "Claw.Toast.Warning.argsRequired",
      LOGIN_FIRST: "Claw.Toast.Warning.loginFirst",
    },
    INFO: {
      ALL_SERVICES_RUNNING: "Claw.Toast.Info.allServicesRunning",
      NO_RUNNING_SERVICES: "Claw.Toast.Info.noRunningServices",
      NO_DEPENDENCIES_TO_INSTALL: "Claw.Toast.Info.noDependenciesToInstall",
      SERVER_ADDED_REMEMBER_SAVE: "Claw.Toast.Info.serverAddedRememberSave",
      SERVER_REMOVED_REMEMBER_SAVE: "Claw.Toast.Info.serverRemovedRememberSave",
      LOGIN_FIRST_SILENT: "Claw.Toast.Info.loginFirstSilent",
      ALREADY_LATEST_VERSION: "Claw.Toast.Info.alreadyLatestVersion",
    },
  },

  // 依赖管理 Components.Dependency
  Components: {
    Dependency: {
      CHECKING: "Claw.Components.Dependency.checking",
      INSTALLED: "Claw.Components.Dependency.installed",
      MISSING: "Claw.Components.Dependency.missing",
      OUTDATED: "Claw.Components.Dependency.outdated",
      INSTALLING: "Claw.Components.Dependency.installing",
      BUNDLED: "Claw.Components.Dependency.bundled",
      ERROR: "Claw.Components.Dependency.error",
    },
    Action: {
      STARTING: "Claw.Components.Action.starting",
      STOPPING: "Claw.Components.Action.stopping",
      READY: "Claw.Components.Action.ready",
      NEED_CONFIG: "Claw.Components.Action.needConfig",
      ALL_READY: "Claw.Components.Action.allReady",
      ALL_INSTALLED: "Claw.Components.Action.allInstalled",
    },
  },

  // 服务 Pages.Service
  Pages: {
    Service: {
      FILE_SERVER: "Claw.Pages.Service.fileServer",
      PROXY: "Claw.Pages.Service.proxy",
      AGENT: "Claw.Pages.Service.agent",
      MCP_PROXY: "Claw.Pages.Service.mcpProxy",
      GUI_MCP: "Claw.Pages.Service.guiMcp",
    },
    Agent: {
      STATUS: {
        IDLE: "Claw.Pages.Agent.status.idle",
        STARTING: "Claw.Pages.Agent.status.starting",
        RUNNING: "Claw.Pages.Agent.status.running",
        BUSY: "Claw.Pages.Agent.status.busy",
        STOPPED: "Claw.Pages.Agent.status.stopped",
        ERROR: "Claw.Pages.Agent.status.error",
      },
    },
    State: {
      RUNNING: "Claw.Pages.State.running",
      STOPPED: "Claw.Pages.State.stopped",
      STARTING: "Claw.Pages.State.starting",
      STOPPING: "Claw.Pages.State.stopping",
      ERROR: "Claw.Pages.State.error",
    },

    // 依赖页面 Pages.Dependencies
    Dependencies: {
      // 标题
      SYSTEM_ENV: "Claw.Pages.Dependencies.systemEnv",
      DEPENDENCY_PACKAGES: "Claw.Pages.Dependencies.dependencyPackages",
      LOADING: "Claw.Pages.Dependencies.loading",
      CHECKING: "Claw.Pages.Dependencies.checking",
      REFRESH: "Claw.Pages.Dependencies.refresh",
      LOAD_DEPENDENCIES: "Claw.Pages.Dependencies.loadDependencies",

      // 状态
      NOT_INSTALLED: "Claw.Pages.Dependencies.notInstalled",
      INTEGRATED: "Claw.Pages.Dependencies.integrated",
      NOT_INTEGRATED: "Claw.Pages.Dependencies.notIntegrated",
      REQUIRED: "Claw.Pages.Dependencies.required",
      UPGRADING: "Claw.Pages.Dependencies.upgrading",
      UPDATING: "Claw.Pages.Dependencies.updating",
      INSTALLING: "Claw.Pages.Dependencies.installing",
      INSTALLED_COUNT: "Claw.Pages.Dependencies.installedCount",

      // 操作
      INSTALL: "Claw.Pages.Dependencies.install",
      UPDATE: "Claw.Pages.Dependencies.update",
      UPGRADE: "Claw.Pages.Dependencies.upgrade",
      INSTALL_ALL: "Claw.Pages.Dependencies.installAll",
      UPGRADE_ALL: "Claw.Pages.Dependencies.upgradeAll",
      UPDATE_TO: "Claw.Pages.Dependencies.updateTo",
      NO_DEPENDENCIES: "Claw.Pages.Dependencies.noDependencies",

      // 消息
      MSG_INSTALL_SUCCESS: "Claw.Pages.Dependencies.msgInstallSuccess",
      MSG_UPGRADE_SUCCESS: "Claw.Pages.Dependencies.msgUpgradeSuccess",
      MSG_FAILED: "Claw.Pages.Dependencies.msgFailed",
      MSG_INSTALL_ALL_COMPLETE: "Claw.Pages.Dependencies.msgInstallAllComplete",
      MSG_INSTALL_ALL_SUCCESS: "Claw.Pages.Dependencies.msgInstallAllSuccess",
      MSG_UPGRADE_ALL_COMPLETE: "Claw.Pages.Dependencies.msgUpgradeAllComplete",
      MSG_LOAD_FAILED: "Claw.Pages.Dependencies.msgLoadFailed",
      MSG_RESTARTING_SERVICES: "Claw.Pages.Dependencies.msgRestartingServices",
      MSG_RESTART_SUCCESS: "Claw.Pages.Dependencies.msgRestartSuccess",
      MSG_RESTART_FAILED: "Claw.Pages.Dependencies.msgRestartFailed",
      MSG_NO_DEPENDENCIES_TO_INSTALL:
        "Claw.Pages.Dependencies.msgNoDependenciesToInstall",
      MSG_INSTALL_FAILED: "Claw.Pages.Dependencies.msgInstallFailed",
      MSG_SYSTEM_ENV_REQUIRED: "Claw.Pages.Dependencies.msgSystemEnvRequired",

      // 依赖名称
      DEP_UV: "Claw.Pages.Dependencies.dep.uv",
      DEP_PNPM: "Claw.Pages.Dependencies.dep.pnpm",
      DEP_ANTHROPIC_SDK: "Claw.Pages.Dependencies.dep.anthropicSdk",
      DEP_CLAUDE_CODE_ACP: "Claw.Pages.Dependencies.dep.claudeCodeAcp",
      DEP_FILE_SERVER: "Claw.Pages.Dependencies.dep.fileServer",
      DEP_MCP_PROXY: "Claw.Pages.Dependencies.dep.mcpProxy",
      DEP_NUWAXCODE: "Claw.Pages.Dependencies.dep.nuwaxcode",

      // 依赖描述
      DESC_UV: "Claw.Pages.Dependencies.desc.uv",
      DESC_PNPM: "Claw.Pages.Dependencies.desc.pnpm",
      DESC_ANTHROPIC_SDK: "Claw.Pages.Dependencies.desc.anthropicSdk",
      DESC_CLAUDE_CODE_ACP: "Claw.Pages.Dependencies.desc.claudeCodeAcp",
      DESC_FILE_SERVER: "Claw.Pages.Dependencies.desc.fileServer",
      DESC_MCP_PROXY: "Claw.Pages.Dependencies.desc.mcpProxy",
      DESC_NUWAXCODE: "Claw.Pages.Dependencies.desc.nuwaxcode",

      // 版本要求
      REQ_NODE_VERSION: "Claw.Pages.Dependencies.reqNodeVersion",
      REQ_UV_VERSION: "Claw.Pages.Dependencies.reqUvVersion",
    },

    // 日志查看器 Pages.LogViewer
    LogViewer: {
      TITLE: "Claw.LogViewer.title",
      AUTO_SCROLL: "Claw.LogViewer.autoScroll",
      ALL: "Claw.LogViewer.all",
      REFRESH: "Claw.LogViewer.refresh",
      OPEN_DIR: "Claw.LogViewer.openDir",
      NO_LOGS: "Claw.LogViewer.noLogs",
      SCROLL_TO_LOAD_MORE: "Claw.LogViewer.scrollToLoadMore",
      TOTAL_LOGS: "Claw.LogViewer.totalLogs",
      AUTO_SCROLL_ENABLED: "Claw.LogViewer.autoScrollEnabled",
    },
  },
} as const;
