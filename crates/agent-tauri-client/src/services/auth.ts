/**
 * 认证服务
 * 管理用户登录状态、Token/ConfigKey 存储
 * 使用 Tauri Store 替代 localStorage
 */

import { message } from 'antd';
import {
  registerClient,
  ClientRegisterParams,
  ClientRegisterResponse,
  SandboxValue,
} from './api';
import { getAgentUrl, getVncUrl, getFileServerUrl } from './config';
import { authStorage, initStore, STORAGE_KEYS, remove, type AuthUserInfo, setupStorage } from './store';

// 导出 AuthUserInfo 类型以保持向后兼容
export type { AuthUserInfo };

// ========== 初始化 ==========

/**
 * 初始化存储服务
 * 需要在应用启动时调用
 */
export async function initAuthStore(): Promise<void> {
  await initStore();
}

// ========== 用户信息类型 ==========

/**
 * 用户信息接口（在 store.ts 中定义，此处导出）
 */

// ========== 存储管理（使用新的 Store 服务）==========

/**
 * 获取保存的用户名
 */
export function getSavedUsername(): Promise<string | null> {
  return authStorage.getUsername();
}

/**
 * 保存用户名
 */
export function saveUsername(username: string): Promise<void> {
  return authStorage.setUsername(username);
}

/**
 * 获取保存的密码
 */
export function getSavedPassword(): Promise<string | null> {
  return authStorage.getPassword();
}

/**
 * 保存密码
 * 注意：实际项目中应该加密存储
 */
export function savePassword(password: string): Promise<void> {
  return authStorage.setPassword(password);
}

/**
 * 获取保存的 ConfigKey（当前客户端的唯一标识）
 */
export function getSavedConfigKey(): Promise<string | null> {
  return authStorage.getConfigKey();
}

/**
 * 保存 ConfigKey（当前客户端的唯一标识）
 */
export function saveConfigKey(configKey: string): Promise<void> {
  return authStorage.setConfigKey(configKey);
}

/**
 * 获取保存的 SavedKey（用于下次注册时传递给服务端）
 */
export function getSavedKey(): Promise<string | null> {
  return authStorage.getSavedKey();
}

/**
 * 保存 SavedKey
 * 这个值会在下次登录时作为 savedKey 参数传递给服务端
 */
export function saveSavedKey(key: string): Promise<void> {
  return authStorage.setSavedKey(key);
}

/**
 * 清除所有认证信息
 */
export async function clearAuthInfo(): Promise<void> {
  await authStorage.clear();
}

/**
 * 获取用户信息
 */
export function getUserInfo(): Promise<AuthUserInfo | null> {
  return authStorage.getUserInfo();
}

/**
 * 保存用户信息
 */
export function saveUserInfo(info: AuthUserInfo): Promise<void> {
  return authStorage.setUserInfo(info);
}

/**
 * 获取连接状态
 */
export function getOnlineStatus(): Promise<boolean | null> {
  return authStorage.getOnlineStatus();
}

/**
 * 保存连接状态
 */
export function saveOnlineStatus(online: boolean): Promise<void> {
  return authStorage.setOnlineStatus(online);
}

/**
 * 清除连接状态
 */
export async function clearOnlineStatus(): Promise<void> {
  await remove(STORAGE_KEYS.AUTH_ONLINE_STATUS);
}

/**
 * 保存服务器配置（从 reg 接口返回）
 * 用于客户端连接服务器
 */
export async function saveServerConfig(serverHost: string, serverPort: number): Promise<void> {
  await setupStorage.setState({
    serverHost,
    serverPort,
  });
  console.log('[Auth] 服务器配置已保存:', { serverHost, serverPort });
}

// ========== 错误码定义 ==========

/**
 * 业务错误码定义
 */
export const AUTH_ERROR_CODES = {
  SUCCESS: '0000',
  USER_NOT_FOUND: '1001', // 用户不存在
  PASSWORD_ERROR: '1002', // 密码错误
  USER_DISABLED: '1003', // 用户已被禁用
  CLIENT_NOT_FOUND: '2001', // 客户端不存在
  CLIENT_DISABLED: '2002', // 客户端已被禁用
  CONFIG_NOT_FOUND: '2003', // 配置不存在
} as const;

/**
 * 错误码对应的中文提示信息
 */
export const AUTH_ERROR_MESSAGES: Record<string, string> = {
  '0000': '操作成功',
  '1001': '用户不存在，请检查输入',
  '1002': '密码错误，请重新输入',
  '1003': '账户已被禁用，请联系管理员',
  '2001': '客户端不存在或已下架',
  '2002': '客户端已被禁用',
  '2003': '配置不存在，请重新登录',
  '4010': '登录已过期，请重新登录',
  '4011': '登录已过期，请重新登录',
  '9999': '系统错误，请稍后重试',
};

/**
 * 获取友好的错误信息
 */
export function getAuthErrorMessage(error: any): string {
  // 优先使用错误消息
  if (error?.message) {
    return error.message;
  }

  // 其次使用响应中的 message
  if (error?.data?.message) {
    return error.data.message;
  }

  // 使用错误码映射
  if (error?.data?.code && AUTH_ERROR_MESSAGES[error.data.code]) {
    return AUTH_ERROR_MESSAGES[error.data.code];
  }

  // HTTP 状态码处理
  if (error?.status === 403) {
    return '没有权限执行此操作';
  }
  if (error?.status === 404) {
    return '请求的资源不存在';
  }
  if (error?.status === 500) {
    return '服务器错误，请稍后重试';
  }

  // 默认错误信息
  return '登录失败，请检查网络连接';
}

// ========== 客户端注册 ==========

/**
 * 获取本地沙箱配置值（默认配置）
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
 * @param username 用户名/邮箱/手机号
 * @param password 密码
 * @returns 注册响应数据
 */
export async function loginAndRegister(
  username: string,
  password: string
): Promise<ClientRegisterResponse> {
  // 获取保存的 savedKey（用于标识是否为老用户）
  const savedKey = await getSavedKey();

  // 构建注册参数
  const params: ClientRegisterParams = {
    username,
    password,
    savedKey: savedKey || undefined,
    sandboxConfigValue: getLocalSandboxValue(),
  };

  // 启动 loading 提示
  const loadingKey = 'loginLoading';
  message.loading({ content: '正在登录...', key: loadingKey, duration: 0 });

  try {
    const response = await registerClient(params);

    // ========== 重要：保存认证信息 ==========
    // 1. 保存用户名和密码（用于自动登录和重新注册）
    await saveUsername(username);
    await savePassword(password);

    // 2. 保存 configKey（当前客户端的唯一标识）
    await saveConfigKey(response.configKey);

    // 3. 保存 savedKey（下次注册时使用，实现用户识别）
    // 这个值会作为下次登录时的 savedKey 参数
    await saveSavedKey(response.configKey);

    // 4. 保存用户信息
    await saveUserInfo({
      username,
      displayName: response.name,
    });

    // 5. 保存连接状态
    await saveOnlineStatus(response.online);

    // 6. 保存服务器配置（用于客户端连接）
    if (response.serverHost && response.serverPort) {
      await saveServerConfig(response.serverHost, response.serverPort);
    }

    // 关闭 loading 并显示成功提示
    message.success({ content: '登录成功！', key: loadingKey });

    // 打印调试信息
    console.log('[Auth] 登录成功:', {
      configKey: response.configKey,
      name: response.name,
      online: response.online,
      serverHost: response.serverHost,
      serverPort: response.serverPort,
      isNewUser: !savedKey, // 如果没有 savedKey，说明是新用户
    });

    return response;
  } catch (error: any) {
    // 获取友好的错误信息
    const errorMessage = getAuthErrorMessage(error);
    console.error('[Auth] 登录失败:', error);

    // 关闭 loading 并显示错误信息
    message.error({ content: errorMessage, key: loadingKey });

    throw error;
  }
}

/**
 * 检查是否已登录
 */
export async function isLoggedIn(): Promise<boolean> {
  const username = await getSavedUsername();
  const configKey = await getSavedConfigKey();
  return !!(username && configKey);
}

/**
 * 获取当前登录信息
 */
export async function getCurrentAuth(): Promise<{
  username: string | null;
  configKey: string | null;
  userInfo: AuthUserInfo | null;
  isLoggedIn: boolean;
}> {
  const username = await getSavedUsername();
  const configKey = await getSavedConfigKey();
  const userInfo = await getUserInfo();
  const isLogged = !!(username && configKey);

  return {
    username,
    configKey,
    userInfo,
    isLoggedIn: isLogged,
  };
}

/**
 * 重新注册客户端（使用已保存的凭证）
 * 在应用启动或网络重连时调用，保持客户端在线状态
 */
export async function reRegisterClient(): Promise<ClientRegisterResponse | null> {
  const username = await getSavedUsername();
  const password = await getSavedPassword();

  if (!username || !password) {
    console.warn('[Auth] 未保存凭证，无法重新注册');
    return null;
  }

  try {
    console.log('[Auth] 重新注册客户端...');
    const response = await loginAndRegister(username, password);
    console.log('[Auth] 重新注册成功');
    return response;
  } catch (error) {
    console.error('[Auth] 重新注册失败:', error);
    return null;
  }
}

/**
 * 退出登录
 * 清除所有本地认证信息
 */
export async function logout(): Promise<void> {
  await clearAuthInfo();
  await clearOnlineStatus();
  message.info('已退出登录');
}

// ========== 心跳机制 (TODO) ==========

/**
 * 启动心跳 (TODO)
 * 实现思路：
 * 1. 定期调用 registerClient 保持客户端在线
 * 2. 建议间隔: 30秒-1分钟
 * 3. 需要停止心跳的场景: 退出登录、程序关闭
 */
export async function startHeartbeat(): Promise<void> {
  console.log('[Heartbeat] TODO: 实现心跳机制');
  // 实现思路：
  // 1. 使用 setInterval 创建定时任务
  // 2. 定期调用 reRegisterClient
  // 3. 保存定时器 ID，以便停止
  // 4. 处理心跳失败的场景
}

/**
 * 停止心跳 (TODO)
 */
export function stopHeartbeat(): void {
  console.log('[Heartbeat] TODO: 实现停止心跳');
  // 实现思路：
  // 1. 清除定时器
  // 2. 重置心跳状态
}

// ========== 同步配置到后端 ==========

/**
 * 获取当前的沙箱配置值（从当前场景配置）
 */
export async function getCurrentSandboxValue(): Promise<SandboxValue> {
  const agentUrl = await getAgentUrl();
  const vncUrl = await getVncUrl();
  const fileServerUrl = await getFileServerUrl();

  // 从 URL 中解析 hostWithScheme 和端口
  const parseUrl = (url: string) => {
    try {
      const u = new URL(url);
      return {
        hostWithScheme: `${u.protocol}//${u.hostname}`,
        port: parseInt(u.port || (u.protocol === 'https:' ? '443' : '80'), 10),
      };
    } catch {
      return { hostWithScheme: 'http://127.0.0.1', port: 0 };
    }
  };

  const agent = parseUrl(agentUrl);
  const vnc = parseUrl(vncUrl);
  const fileServer = parseUrl(fileServerUrl);

  return {
    hostWithScheme: agent.hostWithScheme,
    agentPort: agent.port,
    vncPort: vnc.port,
    fileServerPort: fileServer.port,
    apiKey: '',
    maxUsers: 1,
  };
}

/**
 * 同步本地配置到后端
 * 当用户修改了本地服务配置后调用，更新后端终端配置
 */
export async function syncConfigToServer(): Promise<ClientRegisterResponse | null> {
  const username = await getSavedUsername();
  const password = await getSavedPassword();
  const configKey = await getSavedConfigKey();

  if (!username || !password) {
    console.warn('[SyncConfig] 未登录，无法同步配置');
    return null;
  }

  const params: ClientRegisterParams = {
    username,
    password,
    savedKey: configKey || undefined,
    sandboxConfigValue: await getCurrentSandboxValue(),
  };

  const loadingKey = 'syncConfigLoading';
  message.loading({ content: '正在同步配置...', key: loadingKey, duration: 0 });

  try {
    const response = await registerClient(params);

    // 更新保存的 configKey、savedKey 和连接状态
    await saveConfigKey(response.configKey);
    await saveSavedKey(response.configKey);
    await saveOnlineStatus(response.online);

    message.success({ content: '配置同步成功！', key: loadingKey });
    console.log('[SyncConfig] 配置同步成功:', {
      configKey: response.configKey,
      online: response.online,
    });
    return response;
  } catch (error: any) {
    const errorMessage = getAuthErrorMessage(error);
    console.error('[SyncConfig] 配置同步失败:', error);
    message.error({ content: errorMessage, key: loadingKey });
    return null;
  }
}
