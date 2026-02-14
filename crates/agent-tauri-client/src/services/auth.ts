/**
 * 认证服务
 * 管理用户登录状态、Token/ConfigKey 存储
 * 使用 Tauri Store 替代 localStorage
 */

import { message } from "antd";
import { invoke } from "@tauri-apps/api/core";
import {
  registerClient,
  ClientRegisterParams,
  ClientRegisterResponse,
  SandboxValue,
} from "./api";
import {
  authStorage,
  initStore,
  STORAGE_KEYS,
  remove,
  setString,
  setNumber,
  type AuthUserInfo,
  setupStorage,
} from "./store";

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
 * 优先按域名+用户名查找，回退到全局 savedKey
 */
export async function getSavedKey(
  domain?: string,
  username?: string,
): Promise<string | null> {
  // 按域名+用户名查找（新逻辑）
  if (domain && username) {
    return authStorage.getSavedKeyFor(domain, username);
  }
  // 兼容旧逻辑（无域名/用户名时）
  return authStorage.getSavedKey();
}

/**
 * 保存 SavedKey
 * 以域名+用户名为键持久化，同时更新全局 savedKey
 */
export async function saveSavedKey(
  key: string,
  domain?: string,
  username?: string,
): Promise<void> {
  if (domain && username) {
    await authStorage.setSavedKeyFor(domain, username, key);
  } else {
    await authStorage.setSavedKey(key);
  }
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
 * 保存 lanproxy 服务器配置（从 reg 接口返回）
 * 用于客户端连接 lanproxy 服务器
 */
export async function saveServerConfig(
  serverHost: string,
  serverPort: number,
): Promise<void> {
  await setString(STORAGE_KEYS.LANPROXY_SERVER_HOST, serverHost);
  await setNumber(STORAGE_KEYS.LANPROXY_SERVER_PORT, serverPort);
  console.log("[Auth] lanproxy 服务器配置已保存:", { serverHost, serverPort });
}

// ========== 错误处理 ==========

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
  const errorCodeMessages: Record<string, string> = {
    "1001": "用户不存在，请检查输入",
    "1002": "密码错误，请重新输入",
    "1003": "账户已被禁用，请联系管理员",
    "2001": "客户端不存在或已下架",
    "2002": "客户端已被禁用",
    "2003": "配置不存在，请重新登录",
    "4010": "登录已过期，请重新登录",
    "4011": "登录已过期，请重新登录",
    "9999": "系统错误，请稍后重试",
  };
  if (error?.data?.code && errorCodeMessages[error.data.code]) {
    return errorCodeMessages[error.data.code];
  }

  // HTTP 状态码处理
  if (error?.status === 403) {
    return "没有权限执行此操作";
  }
  if (error?.status === 404) {
    return "请求的资源不存在";
  }
  if (error?.status === 500) {
    return "服务器错误，请稍后重试";
  }

  // 默认错误信息
  return "登录失败，请检查网络连接";
}

// ========== 客户端注册 ==========

/**
 * 获取本地沙箱配置值（从 store 读取用户配置的端口，回退到默认值）
 */
async function getLocalSandboxValue(): Promise<SandboxValue> {
  const setupState = await setupStorage.getState();
  return {
    hostWithScheme: "http://127.0.0.1",
    agentPort: setupState.agentPort,
    vncPort: setupState.proxyPort,
    fileServerPort: setupState.fileServerPort,
    apiKey: "",
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
  password: string,
  options?: { suppressToast?: boolean; domain?: string },
): Promise<ClientRegisterResponse> {
  const suppressToast = options?.suppressToast === true;
  // 获取并规范化 API 域名（用于请求地址和 savedKey 分组）
  const setupState = await setupStorage.getState();
  const domain = normalizeServerHost(options?.domain || setupState.serverHost);

  // 用户在登录表单修改域名时，写回设置存储
  if (domain !== setupState.serverHost) {
    await setupStorage.setState({ serverHost: domain });
  }

  // 获取保存的 savedKey（优先按域名+用户名查找）
  const savedKey = await getSavedKey(domain, username);

  // 构建注册参数
  const params: ClientRegisterParams = {
    username,
    password,
    savedKey: savedKey || undefined,
    sandboxConfigValue: await getLocalSandboxValue(),
  };

  // 启动 loading 提示
  const loadingKey = "loginLoading";
  if (!suppressToast) {
    message.loading({ content: "正在登录...", key: loadingKey, duration: 0 });
  }

  try {
    const response = await registerClient(params, {
      baseUrl: domain,
      suppressToast: true,
    });

    // ========== 重要：保存认证信息 ==========
    // 1. 保存用户名和密码（用于自动登录和重新注册）
    await saveUsername(username);
    await savePassword(password);

    // 2. 保存 configKey（当前客户端的唯一标识）
    await saveConfigKey(response.configKey);

    // 3. 保存 savedKey（按域名+用户名持久化，退出登录不丢失）
    await saveSavedKey(response.configKey, domain, username);

    // 4. 保存用户信息（包含 id 和 currentDomain）
    await saveUserInfo({
      id: response.id,
      username,
      displayName: response.name,
      currentDomain: domain,
    });

    // 5. 保存连接状态
    await saveOnlineStatus(response.online);

    // 6. 保存服务器配置（用于客户端连接）
    console.log("[Auth] API 返回的 lanproxy 配置:", {
      serverHost: response.serverHost,
      serverPort: response.serverPort,
    });
    if (response.serverHost && response.serverPort) {
      await saveServerConfig(response.serverHost, response.serverPort);
    } else {
      console.warn(
        "[Auth] API 未返回 serverHost/serverPort，lanproxy 配置未更新",
      );
    }

    // 7. 重启所有服务（使用新的 lanproxy 配置）
    try {
      console.log("[Auth] 正在重启所有服务...");
      await invoke("services_restart_all");
      console.log("[Auth] 服务重启完成");
    } catch (restartError) {
      console.error("[Auth] 服务重启失败:", restartError);
      // 不阻止登录流程，只记录错误
    }

    // 关闭 loading 并显示成功提示
    if (!suppressToast) {
      message.success({ content: "登录成功！", key: loadingKey });
    }

    // 打印调试信息
    console.log("[Auth] 登录成功:", {
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
    console.error("[Auth] 登录失败:", error);

    // 关闭 loading 并显示错误信息
    if (!suppressToast) {
      message.error({ content: errorMessage, key: loadingKey });
    }

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
    console.warn("[Auth] 未保存凭证，无法重新注册");
    return null;
  }

  try {
    console.log("[Auth] 重新注册客户端...");
    const response = await loginAndRegister(username, password);
    console.log("[Auth] 重新注册成功");
    return response;
  } catch (error) {
    console.error("[Auth] 重新注册失败:", error);
    return null;
  }
}

/**
 * 退出登录
 * 停止所有服务，保留持久化的认证信息（用于下次自动重连）
 */
export async function logout(): Promise<void> {
  // 停止所有服务
  try {
    console.log("[Auth] 退出登录，正在停止所有服务...");
    await invoke("services_stop_all");
    console.log("[Auth] 所有服务已停止");
  } catch (error) {
    console.error("[Auth] 停止服务失败:", error);
  }

  // 清除本地登录状态，但保留 savedKey（含域名+账号映射）
  await clearAuthInfo();
  message.info("已退出登录");
}

// ========== 同步配置到后端 ==========

/**
 * 同步本地配置到后端
 * 当用户修改了本地服务配置后调用，更新后端终端配置
 */
export async function syncConfigToServer(options?: {
  suppressToast?: boolean;
}): Promise<ClientRegisterResponse | null> {
  const suppressToast = options?.suppressToast === true;
  const username = await getSavedUsername();
  const password = await getSavedPassword();
  const configKey = await getSavedConfigKey();
  const setupState = await setupStorage.getState();
  const domain = normalizeServerHost(setupState.serverHost);

  if (!username || !password) {
    console.warn("[SyncConfig] 未登录，无法同步配置");
    return null;
  }

  const params: ClientRegisterParams = {
    username,
    password,
    savedKey: configKey || undefined,
    sandboxConfigValue: await getLocalSandboxValue(),
  };

  const loadingKey = "syncConfigLoading";
  if (!suppressToast) {
    message.loading({
      content: "正在同步配置...",
      key: loadingKey,
      duration: 0,
    });
  }

  try {
    const response = await registerClient(params, {
      baseUrl: domain,
      suppressToast: true,
    });

    // 更新保存的 configKey、savedKey 和连接状态
    await saveConfigKey(response.configKey);
    await saveSavedKey(response.configKey, domain, username);
    await saveOnlineStatus(response.online);

    // 更新用户信息（包含 id 和 currentDomain）
    const currentUserInfo = await getUserInfo();
    await saveUserInfo({
      ...currentUserInfo,
      id: response.id,
      username: username,
      displayName: response.name,
      currentDomain: domain,
    } as AuthUserInfo);

    if (!suppressToast) {
      message.success({ content: "配置同步成功！", key: loadingKey });
    }
    console.log("[SyncConfig] 配置同步成功:", {
      configKey: response.configKey,
      online: response.online,
    });
    return response;
  } catch (error: any) {
    const errorMessage = getAuthErrorMessage(error);
    console.error("[SyncConfig] 配置同步失败:", error);
    if (!suppressToast) {
      message.error({ content: errorMessage, key: loadingKey });
    }
    return null;
  }
}

function normalizeServerHost(input: string): string {
  let value = input.trim();
  if (!value) return value;
  // 去除末尾的 / (允许用户输入带 / 的域名)
  value = value.replace(/\/+$/, "");
  // 如果有 http 前缀直接返回，否则添加 https://
  if (/^https?:\/\//i.test(value)) return value;
  return `https://${value}`;
}
