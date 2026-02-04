/**
 * 统一存储服务
 * 使用 Tauri Store 插件替代 localStorage
 * 提供键值存储、类型安全的读写接口
 */

import { Store, load } from '@tauri-apps/plugin-store';

// Store 实例（单例）
let storeInstance: Store | null = null;

// 存储文件名称
const STORE_FILE = 'nuwax_store.bin';

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
    throw new Error('Store 未初始化，请先调用 initStore()');
  }
  return storeInstance;
}

/**
 * 存储键名定义
 */
export const STORAGE_KEYS = {
  // 认证信息
  AUTH_USERNAME: 'auth.username',
  AUTH_PASSWORD: 'auth.password',
  AUTH_CONFIG_KEY: 'auth.config_key',
  AUTH_SAVED_KEY: 'auth.saved_key',
  AUTH_USER_INFO: 'auth.user_info',
  AUTH_ONLINE_STATUS: 'auth.online_status',

  // 配置信息
  CONFIG_CURRENT_SCENE: 'config.current_scene',
  CONFIG_CUSTOM_SCENES: 'config.custom_scenes',
  CONFIG_VERSION: 'config.version',

  // 应用设置
  SETTINGS_AUTO_CONNECT: 'settings.auto_connect',
  SETTINGS_NOTIFICATIONS: 'settings.notifications',
} as const;

// 配置版本号
const CONFIG_VERSION = '1';

/**
 * 类型定义
 */
export interface AuthUserInfo {
  username: string;
  displayName?: string;
  avatar?: string;
  email?: string;
  phone?: string;
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
 * 通用存储操作
 */

/**
 * 获取字符串值
 */
export async function getString(key: string): Promise<string | null> {
  try {
    return await getStore().get<string>(key) ?? null;
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
    return await getStore().get<boolean>(key) ?? null;
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
    return await getStore().get<number>(key) ?? null;
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
    return await getStore().get<T>(key) ?? null;
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
   * 获取 SavedKey
   */
  async getSavedKey(): Promise<string | null> {
    return getString(STORAGE_KEYS.AUTH_SAVED_KEY);
  },

  /**
   * 保存 SavedKey
   */
  async setSavedKey(value: string): Promise<void> {
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
   * 清除所有认证信息
   */
  async clear(): Promise<void> {
    await remove(STORAGE_KEYS.AUTH_USERNAME);
    await remove(STORAGE_KEYS.AUTH_PASSWORD);
    await remove(STORAGE_KEYS.AUTH_CONFIG_KEY);
    await remove(STORAGE_KEYS.AUTH_SAVED_KEY);
    await remove(STORAGE_KEYS.AUTH_USER_INFO);
    await remove(STORAGE_KEYS.AUTH_ONLINE_STATUS);
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
    return (await getObject<CustomScene[]>(STORAGE_KEYS.CONFIG_CUSTOM_SCENES)) || [];
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
  async updateCustomScene(id: string, updates: Partial<CustomScene>): Promise<boolean> {
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
