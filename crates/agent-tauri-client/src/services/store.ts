/**
 * 统一存储服务
 * 使用 Tauri Store 插件替代 localStorage
 * 提供键值存储、类型安全的读写接口
 */

import { Store, load } from "@tauri-apps/plugin-store";
import {
  DEFAULT_AGENT_PORT,
  DEFAULT_FILE_SERVER_PORT,
  DEFAULT_PROXY_PORT,
  DEFAULT_SERVER_HOST,
  DEFAULT_SERVER_PORT,
} from "../constants";

// Store 实例（单例）
let storeInstance: Store | null = null;

// 存储文件名称
const STORE_FILE = "nuwax_store.bin";

/**
 * 初始化存储服务
 * 需要在应用启动时调用
 */
export async function initStore(): Promise<Store> {
  if (storeInstance) {
    return storeInstance;
  }

  storeInstance = await load(STORE_FILE);
  return storeInstance;
}

/**
 * 获取 Store 实例
 * 如果未初始化会抛出错误
 */
export function getStore(): Store {
  if (!storeInstance) {
    throw new Error("Store 未初始化，请先调用 initStore()");
  }
  return storeInstance;
}

/**
 * 存储键名定义
 */
export const STORAGE_KEYS = {
  // 认证信息
  AUTH_USERNAME: "auth.username",
  AUTH_PASSWORD: "auth.password",
  AUTH_CONFIG_KEY: "auth.config_key",
  AUTH_SAVED_KEY: "auth.saved_key",
  AUTH_SAVED_KEYS_PREFIX: "auth.saved_keys.", // 按域名+用户名存储的 savedKey 前缀
  AUTH_USER_INFO: "auth.user_info",
  AUTH_ONLINE_STATUS: "auth.online_status",

  // 配置信息
  CONFIG_CURRENT_SCENE: "config.current_scene",
  CONFIG_CUSTOM_SCENES: "config.custom_scenes",
  CONFIG_VERSION: "config.version",

  // 应用设置
  SETTINGS_AUTO_CONNECT: "settings.auto_connect",
  SETTINGS_NOTIFICATIONS: "settings.notifications",

  // 初始化向导状态
  SETUP_COMPLETED: "setup.completed", // 是否完成初始化
  SETUP_CURRENT_STEP: "setup.current_step", // 当前步骤 (1/2/3)

  // 基础设置（步骤1）- API 服务器配置
  SETUP_SERVER_HOST: "setup.server_host", // API 服务域名 (如 https://nvwa-api.xspaceagi.com)
  SETUP_SERVER_PORT: "setup.server_port", // API 服务端口 (HTTPS 端口，如 443)
  SETUP_AGENT_PORT: "setup.agent_port", // Agent 端口
  SETUP_FILE_SERVER_PORT: "setup.file_server_port", // 文件服务端口
  SETUP_PROXY_PORT: "setup.proxy_port", // 代理服务端口 (本地)
  SETUP_WORKSPACE_DIR: "setup.workspace_dir", // 工作区目录
  SETUP_RECENT_WORKSPACES: "setup.recent_workspaces", // 最近使用的工作区目录

  // Lanproxy 服务器配置（从 API 返回）
  LANPROXY_SERVER_HOST: "lanproxy.server_host", // lanproxy 服务器地址 (如 testagent.xspaceagi.com)
  LANPROXY_SERVER_PORT: "lanproxy.server_port", // lanproxy 服务器端口 (如 6443)

  // MCP Proxy 配置
  SETUP_MCP_PROXY_PORT: "setup.mcp_proxy_port", // MCP Proxy 监听端口 (默认 18099)
  SETUP_MCP_PROXY_CONFIG: "setup.mcp_proxy_config", // MCP Proxy mcpServers JSON 配置

  // 依赖安装（步骤3）
  DEPS_INSTALL_DIR: "deps.install_dir", // npm 包安装目录（应用数据目录）
  DEPS_NODE_MODULES_PATH: "deps.node_modules_path", // node_modules 完整路径
  SETUP_DEPS_FILTER: "setup.deps_filter", // 依赖筛选（all/system/npm-local）
  SETUP_DEPS_SHOW_ALL: "setup.deps_show_all", // 是否展开全部依赖
  SETUP_DEPS_INSTALLED: "setup.deps_installed", // 依赖是否已全部安装
} as const;

// 配置版本号
const CONFIG_VERSION = "1";

/**
 * 类型定义
 */
export interface AuthUserInfo {
  id?: number;
  username: string;
  displayName?: string;
  avatar?: string;
  email?: string;
  phone?: string;
  currentDomain?: string;
}

export interface CustomScene {
  id: string;
  name: string;
  description?: string;
  isDefault?: boolean;
  server: {
    apiUrl: string;
    apiKey?: string;
    timeout?: number;
  };
  local: {
    agent: { host: string; port: number; scheme?: string; path?: string };
    vnc: { host: string; port: number; scheme?: string };
    fileServer: { host: string; port: number; scheme?: string; path?: string };
    websocket: { host: string; port: number; scheme?: string; path?: string };
  };
}

/**
 * 初始化向导状态
 */
export interface SetupState {
  completed: boolean; // 是否完成初始化
  currentStep: number; // 当前步骤 (1/2/3)
  serverHost: string; // 服务域名
  serverPort: number; // 服务端口 (HTTPS 端口)
  agentPort: number; // Agent 端口
  fileServerPort: number; // 文件服务端口
  proxyPort: number; // 代理服务端口
  workspaceDir: string; // 工作区目录
}

/**
 * 初始化向导默认配置
 */
export const DEFAULT_SETUP_STATE: SetupState = {
  completed: false,
  currentStep: 1,
  serverHost: DEFAULT_SERVER_HOST,
  serverPort: DEFAULT_SERVER_PORT,
  agentPort: DEFAULT_AGENT_PORT,
  fileServerPort: DEFAULT_FILE_SERVER_PORT,
  proxyPort: DEFAULT_PROXY_PORT,
  workspaceDir: "",
};

/**
 * 通用存储操作
 */

/**
 * 获取字符串值
 */
export async function getString(key: string): Promise<string | null> {
  try {
    return (await getStore().get<string>(key)) ?? null;
  } catch {
    return null;
  }
}

/**
 * 设置字符串值
 */
export async function setString(key: string, value: string): Promise<void> {
  await getStore().set(key, value);
}

/**
 * 获取布尔值
 */
export async function getBoolean(key: string): Promise<boolean | null> {
  try {
    return (await getStore().get<boolean>(key)) ?? null;
  } catch {
    return null;
  }
}

/**
 * 设置布尔值
 */
export async function setBoolean(key: string, value: boolean): Promise<void> {
  await getStore().set(key, value);
}

/**
 * 获取数值
 */
export async function getNumber(key: string): Promise<number | null> {
  try {
    return (await getStore().get<number>(key)) ?? null;
  } catch {
    return null;
  }
}

/**
 * 设置数值
 */
export async function setNumber(key: string, value: number): Promise<void> {
  await getStore().set(key, value);
}

/**
 * 获取对象（JSON）
 */
export async function getObject<T>(key: string): Promise<T | null> {
  try {
    return (await getStore().get<T>(key)) ?? null;
  } catch {
    return null;
  }
}

/**
 * 设置对象（JSON）
 */
export async function setObject<T>(key: string, value: T): Promise<void> {
  await getStore().set(key, value);
}

/**
 * 删除键
 */
export async function remove(key: string): Promise<void> {
  await getStore().delete(key);
}

/**
 * 检查键是否存在
 */
export async function has(key: string): Promise<boolean> {
  return await getStore().has(key);
}

/**
 * 保存存储（确保数据写入磁盘）
 */
export async function save(): Promise<void> {
  await getStore().save();
}

/**
 * 清除所有数据
 */
export async function clear(): Promise<void> {
  await getStore().clear();
}

/**
 * 获取所有键
 */
export async function keys(): Promise<string[]> {
  return await getStore().keys();
}

/**
 * 将域名标准化为存储键的一部分
 * 去除协议前缀、端口号，只保留主机名
 */
function normalizeDomain(domain: string): string {
  try {
    const url = new URL(domain);
    return url.hostname;
  } catch {
    // 如果不是合法 URL，去掉常见前缀后直接使用
    return domain.replace(/^https?:\/\//, "").replace(/[:/]/g, "_");
  }
}

/**
 * 认证信息存储操作
 */
export const authStorage = {
  /**
   * 获取保存的用户名
   */
  async getUsername(): Promise<string | null> {
    return getString(STORAGE_KEYS.AUTH_USERNAME);
  },

  /**
   * 保存用户名
   */
  async setUsername(value: string): Promise<void> {
    await setString(STORAGE_KEYS.AUTH_USERNAME, value);
  },

  /**
   * 获取保存的密码
   */
  async getPassword(): Promise<string | null> {
    return getString(STORAGE_KEYS.AUTH_PASSWORD);
  },

  /**
   * 保存密码
   */
  async setPassword(value: string): Promise<void> {
    await setString(STORAGE_KEYS.AUTH_PASSWORD, value);
  },

  /**
   * 获取 ConfigKey
   */
  async getConfigKey(): Promise<string | null> {
    return getString(STORAGE_KEYS.AUTH_CONFIG_KEY);
  },

  /**
   * 保存 ConfigKey
   */
  async setConfigKey(value: string): Promise<void> {
    await setString(STORAGE_KEYS.AUTH_CONFIG_KEY, value);
  },

  /**
   * 获取 SavedKey（全局）
   */
  async getSavedKey(): Promise<string | null> {
    return getString(STORAGE_KEYS.AUTH_SAVED_KEY);
  },

  /**
   * 保存 SavedKey（全局）
   */
  async setSavedKey(value: string): Promise<void> {
    await setString(STORAGE_KEYS.AUTH_SAVED_KEY, value);
  },

  /**
   * 获取按域名+用户名存储的 SavedKey
   * 键格式: auth.saved_keys.{normalizedDomain}_{username}
   */
  async getSavedKeyFor(
    domain: string,
    username: string,
  ): Promise<string | null> {
    const key = `${STORAGE_KEYS.AUTH_SAVED_KEYS_PREFIX}${normalizeDomain(domain)}_${username}`;
    return getString(key);
  },

  /**
   * 按域名+用户名保存 SavedKey
   * 同时更新全局 savedKey
   */
  async setSavedKeyFor(
    domain: string,
    username: string,
    value: string,
  ): Promise<void> {
    const key = `${STORAGE_KEYS.AUTH_SAVED_KEYS_PREFIX}${normalizeDomain(domain)}_${username}`;
    await setString(key, value);
    // 同步更新全局 savedKey
    await setString(STORAGE_KEYS.AUTH_SAVED_KEY, value);
  },

  /**
   * 获取用户信息
   */
  async getUserInfo(): Promise<AuthUserInfo | null> {
    return getObject<AuthUserInfo>(STORAGE_KEYS.AUTH_USER_INFO);
  },

  /**
   * 保存用户信息
   */
  async setUserInfo(value: AuthUserInfo): Promise<void> {
    await setObject(STORAGE_KEYS.AUTH_USER_INFO, value);
  },

  /**
   * 获取在线状态
   */
  async getOnlineStatus(): Promise<boolean | null> {
    return getBoolean(STORAGE_KEYS.AUTH_ONLINE_STATUS);
  },

  /**
   * 保存在线状态
   */
  async setOnlineStatus(value: boolean): Promise<void> {
    await setBoolean(STORAGE_KEYS.AUTH_ONLINE_STATUS, value);
  },

  /**
   * 清除认证信息（保留 savedKey，退出登录时不丢失设备标识）
   */
  async clear(): Promise<void> {
    await remove(STORAGE_KEYS.AUTH_USERNAME);
    await remove(STORAGE_KEYS.AUTH_PASSWORD);
    await remove(STORAGE_KEYS.AUTH_CONFIG_KEY);
    await remove(STORAGE_KEYS.AUTH_USER_INFO);
    await remove(STORAGE_KEYS.AUTH_ONLINE_STATUS);
    // 注意: 不清除 AUTH_SAVED_KEY 和 AUTH_SAVED_KEYS_PREFIX.*
    // savedKey 需要跨登录会话持久化，用于服务端识别同一客户端
  },
};

/**
 * 配置信息存储操作
 */
export const configStorage = {
  /**
   * 获取当前场景 ID
   */
  async getCurrentSceneId(): Promise<string | null> {
    return getString(STORAGE_KEYS.CONFIG_CURRENT_SCENE);
  },

  /**
   * 保存当前场景 ID
   */
  async setCurrentSceneId(value: string): Promise<void> {
    await setString(STORAGE_KEYS.CONFIG_CURRENT_SCENE, value);
  },

  /**
   * 获取自定义场景列表
   */
  async getCustomScenes(): Promise<CustomScene[]> {
    return (
      (await getObject<CustomScene[]>(STORAGE_KEYS.CONFIG_CUSTOM_SCENES)) || []
    );
  },

  /**
   * 保存自定义场景列表
   */
  async setCustomScenes(scenes: CustomScene[]): Promise<void> {
    await setObject(STORAGE_KEYS.CONFIG_CUSTOM_SCENES, scenes);
  },

  /**
   * 添加自定义场景
   */
  async addCustomScene(scene: CustomScene): Promise<void> {
    const scenes = await this.getCustomScenes();
    scenes.push(scene);
    await this.setCustomScenes(scenes);
  },

  /**
   * 更新自定义场景
   */
  async updateCustomScene(
    id: string,
    updates: Partial<CustomScene>,
  ): Promise<boolean> {
    const scenes = await this.getCustomScenes();
    const index = scenes.findIndex((s) => s.id === id);
    if (index === -1) {
      return false;
    }
    scenes[index] = { ...scenes[index], ...updates };
    await this.setCustomScenes(scenes);
    return true;
  },

  /**
   * 删除自定义场景
   */
  async deleteCustomScene(id: string): Promise<boolean> {
    const scenes = await this.getCustomScenes();
    const filtered = scenes.filter((s) => s.id !== id);
    if (filtered.length === scenes.length) {
      return false;
    }
    await this.setCustomScenes(filtered);
    return true;
  },

  /**
   * 清除所有配置
   */
  async clear(): Promise<void> {
    await remove(STORAGE_KEYS.CONFIG_CURRENT_SCENE);
    await remove(STORAGE_KEYS.CONFIG_CUSTOM_SCENES);
    await remove(STORAGE_KEYS.CONFIG_VERSION);
  },

  /**
   * 初始化存储（迁移旧数据）
   */
  async init(): Promise<void> {
    // 确保版本号已设置
    const version = await getString(STORAGE_KEYS.CONFIG_VERSION);
    if (version !== CONFIG_VERSION) {
      await setString(STORAGE_KEYS.CONFIG_VERSION, CONFIG_VERSION);
    }
  },
};

/**
 * 应用设置存储操作
 */
export const settingsStorage = {
  /**
   * 获取开机自启动设置
   */
  async getAutoConnect(): Promise<boolean | null> {
    return getBoolean(STORAGE_KEYS.SETTINGS_AUTO_CONNECT);
  },

  /**
   * 保存开机自启动设置
   */
  async setAutoConnect(value: boolean): Promise<void> {
    await setBoolean(STORAGE_KEYS.SETTINGS_AUTO_CONNECT, value);
  },

  /**
   * 获取通知设置
   */
  async getNotifications(): Promise<boolean | null> {
    return getBoolean(STORAGE_KEYS.SETTINGS_NOTIFICATIONS);
  },

  /**
   * 保存通知设置
   */
  async setNotifications(value: boolean): Promise<void> {
    await setBoolean(STORAGE_KEYS.SETTINGS_NOTIFICATIONS, value);
  },
};

/**
 * 初始化向导存储操作
 */
export const setupStorage = {
  /**
   * 检查是否完成初始化
   */
  async isCompleted(): Promise<boolean> {
    const completed = await getBoolean(STORAGE_KEYS.SETUP_COMPLETED);
    return completed === true;
  },

  /**
   * 设置完成状态
   */
  async setCompleted(value: boolean): Promise<void> {
    await setBoolean(STORAGE_KEYS.SETUP_COMPLETED, value);
    await save();
  },

  /**
   * 获取当前步骤
   */
  async getCurrentStep(): Promise<number> {
    const step = await getNumber(STORAGE_KEYS.SETUP_CURRENT_STEP);
    return step ?? 1;
  },

  /**
   * 设置当前步骤
   */
  async setCurrentStep(step: number): Promise<void> {
    await setNumber(STORAGE_KEYS.SETUP_CURRENT_STEP, step);
    await save();
  },

  /**
   * 获取完整的初始化状态
   */
  async getState(): Promise<SetupState> {
    const [
      completed,
      currentStep,
      serverHost,
      serverPort,
      agentPort,
      fileServerPort,
      proxyPort,
      workspaceDir,
    ] = await Promise.all([
      getBoolean(STORAGE_KEYS.SETUP_COMPLETED),
      getNumber(STORAGE_KEYS.SETUP_CURRENT_STEP),
      getString(STORAGE_KEYS.SETUP_SERVER_HOST),
      getNumber(STORAGE_KEYS.SETUP_SERVER_PORT),
      getNumber(STORAGE_KEYS.SETUP_AGENT_PORT),
      getNumber(STORAGE_KEYS.SETUP_FILE_SERVER_PORT),
      getNumber(STORAGE_KEYS.SETUP_PROXY_PORT),
      getString(STORAGE_KEYS.SETUP_WORKSPACE_DIR),
    ]);

    return {
      completed: completed ?? DEFAULT_SETUP_STATE.completed,
      currentStep: currentStep ?? DEFAULT_SETUP_STATE.currentStep,
      serverHost: serverHost ?? DEFAULT_SETUP_STATE.serverHost,
      serverPort: serverPort ?? DEFAULT_SETUP_STATE.serverPort,
      agentPort: agentPort ?? DEFAULT_SETUP_STATE.agentPort,
      fileServerPort: fileServerPort ?? DEFAULT_SETUP_STATE.fileServerPort,
      proxyPort: proxyPort ?? DEFAULT_SETUP_STATE.proxyPort,
      workspaceDir: workspaceDir ?? DEFAULT_SETUP_STATE.workspaceDir,
    };
  },

  /**
   * 保存初始化状态
   */
  async setState(state: Partial<SetupState>): Promise<void> {
    const promises: Promise<void>[] = [];

    if (state.completed !== undefined) {
      promises.push(setBoolean(STORAGE_KEYS.SETUP_COMPLETED, state.completed));
    }
    if (state.currentStep !== undefined) {
      promises.push(
        setNumber(STORAGE_KEYS.SETUP_CURRENT_STEP, state.currentStep),
      );
    }
    if (state.serverHost !== undefined) {
      promises.push(
        setString(STORAGE_KEYS.SETUP_SERVER_HOST, state.serverHost),
      );
    }
    if (state.serverPort !== undefined) {
      promises.push(
        setNumber(STORAGE_KEYS.SETUP_SERVER_PORT, state.serverPort),
      );
    }
    if (state.agentPort !== undefined) {
      promises.push(setNumber(STORAGE_KEYS.SETUP_AGENT_PORT, state.agentPort));
    }
    if (state.fileServerPort !== undefined) {
      promises.push(
        setNumber(STORAGE_KEYS.SETUP_FILE_SERVER_PORT, state.fileServerPort),
      );
    }
    if (state.proxyPort !== undefined) {
      promises.push(setNumber(STORAGE_KEYS.SETUP_PROXY_PORT, state.proxyPort));
    }
    if (state.workspaceDir !== undefined) {
      promises.push(
        setString(STORAGE_KEYS.SETUP_WORKSPACE_DIR, state.workspaceDir),
      );
    }

    await Promise.all(promises);
    await save();
  },

  /**
   * 保存步骤1配置（基础设置）
   */
  async saveStep1(config: {
    serverHost: string;
    agentPort: number;
    fileServerPort: number;
    proxyPort: number;
    workspaceDir: string;
  }): Promise<void> {
    await this.setState({
      ...config,
      currentStep: 2,
    });
  },

  /**
   * 保存步骤2完成状态（账号登录）
   */
  async completeStep2(): Promise<void> {
    await this.setCurrentStep(3);
  },

  /**
   * 完成初始化
   */
  async complete(): Promise<void> {
    await this.setState({
      completed: true,
      currentStep: 3,
    });
  },

  /**
   * 重置初始化状态
   */
  async reset(): Promise<void> {
    await Promise.all([
      remove(STORAGE_KEYS.SETUP_COMPLETED),
      remove(STORAGE_KEYS.SETUP_CURRENT_STEP),
      remove(STORAGE_KEYS.SETUP_SERVER_HOST),
      remove(STORAGE_KEYS.SETUP_SERVER_PORT),
      remove(STORAGE_KEYS.SETUP_AGENT_PORT),
      remove(STORAGE_KEYS.SETUP_FILE_SERVER_PORT),
      remove(STORAGE_KEYS.SETUP_PROXY_PORT),
      remove(STORAGE_KEYS.SETUP_WORKSPACE_DIR),
      remove(STORAGE_KEYS.SETUP_RECENT_WORKSPACES),
      remove(STORAGE_KEYS.SETUP_DEPS_FILTER),
      remove(STORAGE_KEYS.SETUP_DEPS_SHOW_ALL),
      remove(STORAGE_KEYS.DEPS_INSTALL_DIR),
      remove(STORAGE_KEYS.DEPS_NODE_MODULES_PATH),
      remove(STORAGE_KEYS.SETUP_DEPS_INSTALLED),
    ]);
    await save();
  },

  /**
   * 获取最近使用的工作区目录
   */
  async getRecentWorkspaces(): Promise<string[]> {
    return (
      (await getObject<string[]>(STORAGE_KEYS.SETUP_RECENT_WORKSPACES)) || []
    );
  },

  /**
   * 保存最近使用的工作区目录
   */
  async setRecentWorkspaces(dirs: string[]): Promise<void> {
    await setObject(STORAGE_KEYS.SETUP_RECENT_WORKSPACES, dirs);
    await save();
  },

  /**
   * 添加最近使用的工作区目录（去重 + 限制数量）
   */
  async addRecentWorkspace(dir: string): Promise<void> {
    const current = await this.getRecentWorkspaces();
    const next = [dir, ...current.filter((d) => d !== dir)].slice(0, 5);
    await this.setRecentWorkspaces(next);
  },

  /**
   * 清除最近使用的工作区目录
   */
  async clearRecentWorkspaces(): Promise<void> {
    await this.setRecentWorkspaces([]);
  },

  /**
   * 获取依赖安装目录
   */
  async getDepsInstallDir(): Promise<string | null> {
    return getString(STORAGE_KEYS.DEPS_INSTALL_DIR);
  },

  /**
   * 设置依赖安装目录
   */
  async setDepsInstallDir(dir: string): Promise<void> {
    await setString(STORAGE_KEYS.DEPS_INSTALL_DIR, dir);
    await save();
  },

  /**
   * 获取 node_modules 路径
   */
  async getNodeModulesPath(): Promise<string | null> {
    return getString(STORAGE_KEYS.DEPS_NODE_MODULES_PATH);
  },

  /**
   * 设置 node_modules 路径
   */
  async setNodeModulesPath(path: string): Promise<void> {
    await setString(STORAGE_KEYS.DEPS_NODE_MODULES_PATH, path);
    await save();
  },

  /**
   * 获取依赖筛选条件
   */
  async getDepsFilter(): Promise<string | null> {
    return getString(STORAGE_KEYS.SETUP_DEPS_FILTER);
  },

  /**
   * 设置依赖筛选条件
   */
  async setDepsFilter(value: string): Promise<void> {
    await setString(STORAGE_KEYS.SETUP_DEPS_FILTER, value);
    await save();
  },

  /**
   * 获取是否展开全部依赖
   */
  async getDepsShowAll(): Promise<boolean | null> {
    return getBoolean(STORAGE_KEYS.SETUP_DEPS_SHOW_ALL);
  },

  /**
   * 设置是否展开全部依赖
   */
  async setDepsShowAll(value: boolean): Promise<void> {
    await setBoolean(STORAGE_KEYS.SETUP_DEPS_SHOW_ALL, value);
    await save();
  },

  /**
   * 获取依赖是否已安装
   */
  async getDepsInstalled(): Promise<boolean> {
    const installed = await getBoolean(STORAGE_KEYS.SETUP_DEPS_INSTALLED);
    return installed === true;
  },

  /**
   * 设置依赖是否已安装
   */
  async setDepsInstalled(value: boolean): Promise<void> {
    await setBoolean(STORAGE_KEYS.SETUP_DEPS_INSTALLED, value);
    await save();
  },

  // ========== MCP Proxy 配置 ==========

  /**
   * 获取 MCP Proxy 端口
   */
  async getMcpProxyPort(): Promise<number | null> {
    return getNumber(STORAGE_KEYS.SETUP_MCP_PROXY_PORT);
  },

  /**
   * 设置 MCP Proxy 端口
   */
  async setMcpProxyPort(port: number): Promise<void> {
    await setNumber(STORAGE_KEYS.SETUP_MCP_PROXY_PORT, port);
    await save();
  },

  /**
   * 获取 MCP Proxy mcpServers JSON 配置
   */
  async getMcpProxyConfig(): Promise<string | null> {
    return getString(STORAGE_KEYS.SETUP_MCP_PROXY_CONFIG);
  },

  /**
   * 设置 MCP Proxy mcpServers JSON 配置
   */
  async setMcpProxyConfig(configJson: string): Promise<void> {
    await setString(STORAGE_KEYS.SETUP_MCP_PROXY_CONFIG, configJson);
    await save();
  },
};
