/**
 * 启动前端口配置 - 聚合定义与解析
 *
 * 所有「需检查占用的本地端口」的默认值与配置键集中在此，
 * 通过 resolvePortsFromSettings(getSetting) 从任意配置源解析出当前端口，
 * 供 main 进程、脚本、文档脚本共用，避免多处硬编码。
 */

import {
  DEFAULT_AGENT_RUNNER_PORT,
  DEFAULT_FILE_SERVER_PORT,
  DEFAULT_MCP_PROXY_PORT,
  DEFAULT_LANPROXY_PORT,
  DEFAULT_DEV_SERVER_PORT,
  STORAGE_KEYS,
} from './constants';

// ==================== 端口默认值（与 constants 保持一致，此处聚合引用） ====================

export const STARTUP_PORT_DEFAULTS = {
  /** Agent / ComputerServer */
  agent: DEFAULT_AGENT_RUNNER_PORT,
  /** File Server */
  fileServer: DEFAULT_FILE_SERVER_PORT,
  /** MCP Proxy */
  mcp: DEFAULT_MCP_PROXY_PORT,
  /** Lanproxy 相关本地端口（如 Agent Runner 代理） */
  lanproxyLocal: DEFAULT_LANPROXY_PORT,
  /** Vite 开发服务器（仅开发模式） */
  vite: DEFAULT_DEV_SERVER_PORT,
} as const;

export type StartupPorts = {
  agent: number;
  fileServer: number;
  mcp: number;
  lanproxyLocal: number;
  vite: number;
};

/** 本地需检查占用的服务名（用于日志/脚本输出） */
export const STARTUP_PORT_LABELS: Record<keyof StartupPorts, string> = {
  agent: 'Agent(ComputerServer)',
  fileServer: 'FileServer',
  mcp: 'MCP Proxy',
  lanproxyLocal: 'Lanproxy',
  vite: 'Vite',
};

// ==================== 从配置解析端口（聚合逻辑） ====================

export type GetSettingFn = (key: string) => unknown;

/**
 * 从任意配置源解析出当前应使用的端口（不依赖 main/db，可被 main、脚本、测试复用）
 * @param getSetting 读配置函数，如 main 的 readSetting 或脚本内对 SQLite 的封装
 */
export function resolvePortsFromSettings(getSetting: GetSettingFn): StartupPorts {
  const step1 = getSetting(STORAGE_KEYS.STEP1_CONFIG) as { agentPort?: number; fileServerPort?: number } | null;
  const agent = step1?.agentPort ?? STARTUP_PORT_DEFAULTS.agent;
  const fileServer = step1?.fileServerPort ?? STARTUP_PORT_DEFAULTS.fileServer;

  const mcpRaw = getSetting(STORAGE_KEYS.MCP_PROXY_PORT);
  const mcp =
    typeof mcpRaw === 'number' && Number.isInteger(mcpRaw)
      ? mcpRaw
      : typeof mcpRaw === 'string'
        ? (parseInt(mcpRaw, 10) || STARTUP_PORT_DEFAULTS.mcp)
        : STARTUP_PORT_DEFAULTS.mcp;

  return {
    agent,
    fileServer,
    mcp,
    lanproxyLocal: STARTUP_PORT_DEFAULTS.lanproxyLocal,
    vite: STARTUP_PORT_DEFAULTS.vite,
  };
}

/**
 * 返回需要做占用检查的端口列表（名称 + 端口），便于统一 lsof 检查或释放
 * @param ports 已解析的端口对象
 * @param includeVite 是否包含 Vite（仅开发模式需要）
 */
export function getPortsToCheck(
  ports: StartupPorts,
  includeVite: boolean
): Array<{ name: keyof StartupPorts; label: string; port: number }> {
  const list: Array<{ name: keyof StartupPorts; label: string; port: number }> = [
    { name: 'agent', label: STARTUP_PORT_LABELS.agent, port: ports.agent },
    { name: 'fileServer', label: STARTUP_PORT_LABELS.fileServer, port: ports.fileServer },
    { name: 'mcp', label: STARTUP_PORT_LABELS.mcp, port: ports.mcp },
    { name: 'lanproxyLocal', label: STARTUP_PORT_LABELS.lanproxyLocal, port: ports.lanproxyLocal },
  ];
  if (includeVite) {
    list.push({ name: 'vite', label: STARTUP_PORT_LABELS.vite, port: ports.vite });
  }
  return list;
}
