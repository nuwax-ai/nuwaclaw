/**
 * 认证服务
 * 管理用户登录状态、Token/ConfigKey 存储
 */

import { message } from 'antd';
import {
  registerClient,
  ClientRegisterParams,
  ClientRegisterResponse,
  SandboxValue,
} from './api';

// 存储 Key
const STORAGE_KEYS = {
  USER_INFO: 'nuwax_agent_user_info',
  CONFIG_KEY: 'nuwax_agent_config_key',
  USERNAME: 'nuwax_agent_username',
  PASSWORD: 'nuwax_agent_password', // 注意：实际项目中应该加密存储
} as const;

// ========== 用户信息类型 ==========

export interface UserInfo {
  username: string;
  displayName?: string;
  avatar?: string;
}

// ========== 存储管理 ==========

/**
 * 获取保存的用户名
 */
export function getSavedUsername(): string | null {
  try {
    return localStorage.getItem(STORAGE_KEYS.USERNAME);
  } catch {
    return null;
  }
}

/**
 * 保存用户名
 */
export function saveUsername(username: string): void {
  localStorage.setItem(STORAGE_KEYS.USERNAME, username);
}

/**
 * 获取保存的密码
 */
export function getSavedPassword(): string | null {
  try {
    return localStorage.getItem(STORAGE_KEYS.PASSWORD);
  } catch {
    return null;
  }
}

/**
 * 保存密码
 */
export function savePassword(password: string): void {
  localStorage.setItem(STORAGE_KEYS.PASSWORD, password);
}

/**
 * 获取保存的 ConfigKey
 */
export function getSavedConfigKey(): string | null {
  try {
    return localStorage.getItem(STORAGE_KEYS.CONFIG_KEY);
  } catch {
    return null;
  }
}

/**
 * 保存 ConfigKey
 */
export function saveConfigKey(configKey: string): void {
  localStorage.setItem(STORAGE_KEYS.CONFIG_KEY, configKey);
}

/**
 * 清除所有认证信息
 */
export function clearAuthInfo(): void {
  localStorage.removeItem(STORAGE_KEYS.USERNAME);
  localStorage.removeItem(STORAGE_KEYS.PASSWORD);
  localStorage.removeItem(STORAGE_KEYS.CONFIG_KEY);
  localStorage.removeItem(STORAGE_KEYS.USER_INFO);
}

// ========== 用户信息管理 ==========

/**
 * 获取用户信息
 */
export function getUserInfo(): UserInfo | null {
  try {
    const info = localStorage.getItem(STORAGE_KEYS.USER_INFO);
    return info ? JSON.parse(info) : null;
  } catch {
    return null;
  }
}

/**
 * 保存用户信息
 */
export function saveUserInfo(info: UserInfo): void {
  localStorage.setItem(STORAGE_KEYS.USER_INFO, JSON.stringify(info));
}

// ========== 客户端注册 ==========

/**
 * 获取本地沙箱配置值
 */
function getLocalSandboxValue(): SandboxValue {
  return {
    hostWithScheme: 'http://127.0.0.1',
    agentPort: 9086,
    vncPort: 9099,
    fileServerPort: 60000,
    apiKey: '',
    maxUsers: 1,
  };
}

/**
 * 登录并注册客户端
 * 
 * @param username 用户名
 * @param password 密码
 * @returns 注册响应数据
 */
export async function loginAndRegister(
  username: string,
  password: string
): Promise<ClientRegisterResponse> {
  const savedConfigKey = getSavedConfigKey();
  
  const params: ClientRegisterParams = {
    username,
    password,
    savedKey: savedConfigKey || undefined,
    sandboxConfigValue: getLocalSandboxValue(),
  };

  // 启动 loading（不会自动关闭，需要手动销毁）
  const loadingKey = 'loginLoading';
  message.loading({ content: '正在登录...', key: loadingKey, duration: 0 });

  try {
    const response = await registerClient(params);
    
    // 保存认证信息
    saveUsername(username);
    savePassword(password);
    saveConfigKey(response.configKey);
    
    // 保存用户信息（简单处理，显示用户名）
    saveUserInfo({
      username,
      displayName: response.name,
    });

    // 关闭 loading 并显示成功
    message.success({ content: '登录成功！', key: loadingKey });
    return response;
  } catch (error: any) {
    // 优先使用错误消息，其次使用响应中的 message，最后使用默认消息
    const errorMessage = error?.message || error?.data?.message || '登录失败';
    console.error('登录失败:', error);
    // 关闭 loading 并显示错误
    message.error({ content: errorMessage, key: loadingKey });
    throw error;
  }
}

/**
 * 检查是否已登录
 */
export function isLoggedIn(): boolean {
  const username = getSavedUsername();
  const configKey = getSavedConfigKey();
  return !!(username && configKey);
}

/**
 * 获取当前登录信息
 */
export function getCurrentAuth(): {
  username: string | null;
  configKey: string | null;
  userInfo: UserInfo | null;
  isLoggedIn: boolean;
} {
  const username = getSavedUsername();
  const configKey = getSavedConfigKey();
  const userInfo = getUserInfo();
  
  return {
    username,
    configKey,
    userInfo,
    isLoggedIn: !!(username && configKey),
  };
}

/**
 * 重新注册客户端（使用已保存的凭证）
 */
export async function reRegisterClient(): Promise<ClientRegisterResponse | null> {
  const username = getSavedUsername();
  const password = getSavedPassword();
  
  if (!username || !password) {
    return null;
  }

  try {
    return await loginAndRegister(username, password);
  } catch {
    return null;
  }
}

/**
 * 退出登录
 */
export function logout(): void {
  clearAuthInfo();
  message.info('已退出登录');
}

// ========== 心跳机制 (TODO) ==========
// TODO: 实现心跳机制
// - 定期调用注册接口保持客户端在线
// - 建议间隔: 30秒-1分钟
// - 实现位置: 可以放在 App.tsx 的 useEffect 中
// - 需要停止心跳的场景: 退出登录、程序关闭

/**
 * 启动心跳 (TODO)
 */
// TODO: 实现心跳功能
export async function startHeartbeat(): Promise<void> {
  // 1. 获取保存的 username 和 password
  // 2. 定期调用 registerClient 保持在线
  // 3. 实现心跳间隔控制
  // 4. 提供 stopHeartbeat 函数停止心跳
  console.log('[Heartbeat] TODO: 实现心跳机制');
}

/**
 * 停止心跳 (TODO)
 */
export function stopHeartbeat(): void {
  console.log('[Heartbeat] TODO: 实现停止心跳');
}
