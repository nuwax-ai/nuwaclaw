/**
 * 认证服务 (Electron 版)
 * 管理用户登录状态、ConfigKey/SavedKey 存储
 * 使用 window.electronAPI.settings 替代 Tauri Store
 */

import { message } from "antd";
import {
  registerClient,
  ClientRegisterParams,
  ClientRegisterResponse,
  SandboxValue,
} from "./api";
import {
  AUTH_KEYS,
  LOCAL_HOST_URL,
  DEFAULT_AGENT_RUNNER_PORT,
  DEFAULT_FILE_SERVER_PORT,
} from "@shared/constants";

// ========== 类型定义 ==========

export interface AuthUserInfo {
  id?: number;
  username: string;
  displayName?: string;
  avatar?: string;
  email?: string;
  phone?: string;
  currentDomain?: string;
}

// ========== 存储辅助函数 ==========

async function settingsGet<T>(key: string): Promise<T | null> {
  try {
    const value = await window.electronAPI?.settings.get(key);
    return (value as T) ?? null;
  } catch {
    return null;
  }
}

async function settingsSet(key: string, value: unknown): Promise<void> {
  await window.electronAPI?.settings.set(key, value);
}

/**
 * 将域名标准化为存储键的一部分
 */
function normalizeDomain(domain: string): string {
  try {
    const url = new URL(domain);
    return url.hostname;
  } catch {
    return domain.replace(/^https?:\/\//, "").replace(/[:/]/g, "_");
  }
}

// ========== 存储操作 ==========

async function getUsername(): Promise<string | null> {
  return settingsGet<string>(AUTH_KEYS.USERNAME);
}

async function setUsername(value: string): Promise<void> {
  await settingsSet(AUTH_KEYS.USERNAME, value);
}

async function getPassword(): Promise<string | null> {
  return settingsGet<string>(AUTH_KEYS.PASSWORD);
}

async function setPassword(value: string): Promise<void> {
  await settingsSet(AUTH_KEYS.PASSWORD, value);
}

async function getConfigKey(): Promise<string | null> {
  return settingsGet<string>(AUTH_KEYS.CONFIG_KEY);
}

async function setConfigKey(value: string): Promise<void> {
  await settingsSet(AUTH_KEYS.CONFIG_KEY, value);
}

async function getSavedKey(
  domain?: string,
  username?: string,
): Promise<string | null> {
  if (domain && username) {
    const key = `${AUTH_KEYS.SAVED_KEYS_PREFIX}${normalizeDomain(domain)}_${username}`;
    return settingsGet<string>(key);
  }
  return settingsGet<string>(AUTH_KEYS.SAVED_KEY);
}

async function setSavedKey(
  value: string,
  domain?: string,
  username?: string,
): Promise<void> {
  if (domain && username) {
    const key = `${AUTH_KEYS.SAVED_KEYS_PREFIX}${normalizeDomain(domain)}_${username}`;
    await settingsSet(key, value);
  }
  await settingsSet(AUTH_KEYS.SAVED_KEY, value);
}

async function getUserInfo(): Promise<AuthUserInfo | null> {
  return settingsGet<AuthUserInfo>(AUTH_KEYS.USER_INFO);
}

async function setUserInfo(value: AuthUserInfo): Promise<void> {
  await settingsSet(AUTH_KEYS.USER_INFO, value);
}

async function setOnlineStatus(value: boolean): Promise<void> {
  await settingsSet(AUTH_KEYS.ONLINE_STATUS, value);
}

async function saveServerConfig(
  serverHost: string,
  serverPort: number,
): Promise<void> {
  await settingsSet(AUTH_KEYS.LANPROXY_SERVER_HOST, serverHost);
  await settingsSet(AUTH_KEYS.LANPROXY_SERVER_PORT, serverPort);

  // 同步到 lanproxy_config（LanproxySettings 可编辑的配置）
  // clientKey 不存入 lanproxy_config，始终从 auth.saved_key 读取（参考 Tauri 客户端）
  const existing =
    await settingsGet<Record<string, unknown>>("lanproxy_config");
  await settingsSet("lanproxy_config", {
    ...existing,
    serverIp: serverHost.replace(/^https?:\/\//, ""),
    serverPort,
    enabled: true,
  });

  console.log("[Auth] lanproxy 服务器配置已保存:", { serverHost, serverPort });
}

async function clearAuthInfo(): Promise<void> {
  await settingsSet(AUTH_KEYS.USERNAME, null);
  await settingsSet(AUTH_KEYS.PASSWORD, null);
  await settingsSet(AUTH_KEYS.CONFIG_KEY, null);
  await settingsSet(AUTH_KEYS.USER_INFO, null);
  await settingsSet(AUTH_KEYS.ONLINE_STATUS, null);
  await settingsSet(AUTH_KEYS.AUTH_TOKEN, null);
  // 不清除 savedKey，跨登录会话持久化
}

// ========== 获取本地沙箱配置 ==========

async function getLocalSandboxValue(): Promise<SandboxValue> {
  const step1Config = (await window.electronAPI?.settings.get(
    "step1_config",
  )) as {
    agentPort?: number;
    fileServerPort?: number;
  } | null;

  return {
    hostWithScheme: LOCAL_HOST_URL,
    agentPort: step1Config?.agentPort ?? DEFAULT_AGENT_RUNNER_PORT,
    vncPort: 0, // vncPort 未启用
    fileServerPort: step1Config?.fileServerPort ?? DEFAULT_FILE_SERVER_PORT,
    apiKey: "",
    maxUsers: 1,
  };
}

// ========== 错误处理 ==========

/**
 * 获取友好的错误信息
 */
export function getAuthErrorMessage(error: any): string {
  if (error?.message) {
    return error.message;
  }

  if (error?.data?.message) {
    return error.data.message;
  }

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

  if (error?.status === 403) return "没有权限执行此操作";
  if (error?.status === 404) return "请求的资源不存在";
  if (error?.status === 500) return "服务器错误，请稍后重试";

  return "登录失败，请检查网络连接";
}

// ========== 域名标准化 ==========

export function normalizeServerHost(input: string): string {
  let value = input.trim();
  if (!value) return value;
  value = value.replace(/\/+$/, "");
  if (/^https?:\/\//i.test(value)) return value;
  return `https://${value}`;
}

// ========== 核心认证函数 ==========

/**
 * 登录并注册客户端
 */
export async function loginAndRegister(
  username: string,
  password: string,
  options?: { suppressToast?: boolean; domain?: string },
): Promise<ClientRegisterResponse> {
  const suppressToast = options?.suppressToast === true;

  // 获取并规范化域名
  // 优先级：用户显式传入 > lanproxy.server_host > step1_config.serverHost
  const step1Config = (await window.electronAPI?.settings.get(
    "step1_config",
  )) as {
    serverHost?: string;
  } | null;
  let rawDomain = options?.domain || "";
  if (!rawDomain) {
    rawDomain =
      (await settingsGet<string>(AUTH_KEYS.LANPROXY_SERVER_HOST)) || "";
  }
  if (!rawDomain) {
    rawDomain = step1Config?.serverHost || "";
  }
  const domain = normalizeServerHost(rawDomain);

  // 域名变更时写回设置
  if (domain && step1Config && domain !== step1Config.serverHost) {
    await window.electronAPI?.settings.set("step1_config", {
      ...step1Config,
      serverHost: domain,
    });
  }

  // 获取保存的 savedKey
  const savedKey = await getSavedKey(domain, username);

  // 构建注册参数
  const deviceId = await window.electronAPI?.app.getDeviceId();
  const params: ClientRegisterParams = {
    username,
    password,
    savedKey: savedKey || undefined,
    deviceId: deviceId || undefined,
    sandboxConfigValue: await getLocalSandboxValue(),
  };

  const loadingKey = "loginLoading";
  if (!suppressToast) {
    message.loading({ content: "正在登录...", key: loadingKey, duration: 0 });
  }

  try {
    const response = await registerClient(params, {
      baseUrl: domain,
      suppressToast: true,
    });

    // 保存认证信息（不保存密码，后续认证使用 savedKey）
    await setUsername(username);
    // 密码不持久化保存，savedKey（configKey）用于后续自动认证
    await setConfigKey(response.configKey);
    await setSavedKey(response.configKey, domain, username);

    await setUserInfo({
      id: response.id,
      username,
      displayName: response.name,
      currentDomain: domain,
    });

    await setOnlineStatus(response.online);

    // 持久化 token（用于 webview cookie 同步）
    if (response.token) {
      await settingsSet(AUTH_KEYS.AUTH_TOKEN, response.token);
    }

    // 保存 lanproxy 服务器配置
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

    // Electron 版：不自动重启服务，登录完成后由 onComplete 触发主界面初始化

    if (!suppressToast) {
      message.success({ content: "登录成功！", key: loadingKey });
    }

    // 不记录 configKey 全文，避免敏感信息写入控制台/日志
    console.log("[Auth] 登录成功:", {
      configKeySet: !!response.configKey,
      name: response.name,
      online: response.online,
      serverHost: response.serverHost,
      serverPort: response.serverPort,
      isNewUser: !savedKey,
    });

    return response;
  } catch (error: any) {
    const errorMessage = getAuthErrorMessage(error);
    // 仅记录安全信息，避免将含 password/request 的 error 对象写入控制台
    console.error("[Auth] 登录失败:", errorMessage);

    if (!suppressToast) {
      message.error({ content: errorMessage, key: loadingKey });
    }

    throw error;
  }
}

/**
 * 检查是否已登录
 * savedKey 认证场景下 username/password 可为空，以 configKey 为准
 */
export async function isLoggedIn(): Promise<boolean> {
  const configKey = await getConfigKey();
  return !!configKey;
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
  const username = await getUsername();
  const configKey = await getConfigKey();
  const userInfo = await getUserInfo();
  const isLogged = !!configKey;

  return {
    username,
    configKey,
    userInfo,
    isLoggedIn: isLogged,
  };
}

/**
 * 重新注册客户端（使用已保存的 savedKey）
 *
 * 修复：使用 domain + username 级别的 savedKey，避免多账号切换时读取到错误账号的凭证
 * 注意：密码不持久化，仅依赖 savedKey 进行认证
 */
export async function reRegisterClient(): Promise<ClientRegisterResponse | null> {
  const username = await getUsername();

  // 读取 domain，优先级：step1_config.serverHost > lanproxy.server_host
  // 因为 savedKey 是用 step1_config.serverHost 保存的
  const step1Config = (await window.electronAPI?.settings.get(
    "step1_config",
  )) as {
    serverHost?: string;
  } | null;
  const lanproxyHost = await settingsGet<string>(
    AUTH_KEYS.LANPROXY_SERVER_HOST,
  );
  const rawDomain = step1Config?.serverHost || lanproxyHost || "";
  const domain = normalizeServerHost(rawDomain);

  // 按 domain + username 取对应账号的 savedKey，而非读全局 key，避免多账号混淆
  const savedKey =
    domain && username
      ? await getSavedKey(domain, username)
      : await getSavedKey();

  // 必须有 savedKey 才能重新注册（密码不持久化）
  if (!savedKey) {
    console.warn("[Auth] 未保存 savedKey，无法重新注册，请重新登录");
    return null;
  }

  try {
    console.log("[Auth] 重新注册客户端（使用 savedKey）...");

    const deviceId = await window.electronAPI?.app.getDeviceId();
    const params: ClientRegisterParams = {
      username: username || "",
      password: "", // 密码不持久化，使用 savedKey 认证
      savedKey,
      deviceId: deviceId || undefined,
      sandboxConfigValue: await getLocalSandboxValue(),
    };

    const response = await registerClient(params, {
      baseUrl: domain || undefined,
      suppressToast: true,
    });

    // 更新 savedKey（服务端可能返回新的）
    await setConfigKey(response.configKey);
    await setSavedKey(response.configKey, domain, username || undefined);
    await setOnlineStatus(response.online);

    if (response.token) {
      await settingsSet(AUTH_KEYS.AUTH_TOKEN, response.token);
    }

    console.log("[Auth] 重新注册成功");
    return response;
  } catch (error) {
    console.error("[Auth] 重新注册失败:", error);
    return null;
  }
}

/**
 * 退出登录
 */
export async function logout(): Promise<void> {
  await clearAuthInfo();
  message.info("已退出登录");
}

/**
 * 同步本地配置到后端（调用 reg 接口）。
 * reg 返回内容可能会变化（如 serverHost、serverPort 等），本函数会将本次返回的最新值写入配置并返回，调用方应在 reg 成功后再启动服务，以使用最新配置。
 * 注意：密码不持久化，仅依赖 savedKey 进行认证
 */
export async function syncConfigToServer(options?: {
  suppressToast?: boolean;
}): Promise<ClientRegisterResponse | null> {
  const suppressToast = options?.suppressToast === true;
  const username = await getUsername();

  // 读取 domain，优先级：step1_config.serverHost > lanproxy.server_host
  // 因为 savedKey 是用 step1_config.serverHost 保存的
  const step1Config = (await window.electronAPI?.settings.get(
    "step1_config",
  )) as {
    serverHost?: string;
  } | null;
  const lanproxyHost = await settingsGet<string>(
    AUTH_KEYS.LANPROXY_SERVER_HOST,
  );
  const rawDomain = step1Config?.serverHost || lanproxyHost || "";
  const domain = normalizeServerHost(rawDomain);

  // 使用持久化的 savedKey（参考 Tauri 客户端：退出登录不清除，跨会话持久化）
  const savedKey = await getSavedKey(domain, username || undefined);

  // 必须有 savedKey 才能同步（密码不持久化）
  if (!savedKey) {
    console.warn("[SyncConfig] 未保存 savedKey，无法同步配置，请重新登录");
    return null;
  }

  const deviceId = await window.electronAPI?.app.getDeviceId();
  const params: ClientRegisterParams = {
    username: username || "",
    password: "", // 密码不持久化，使用 savedKey 认证
    savedKey,
    deviceId: deviceId || undefined,
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

    await setConfigKey(response.configKey);
    await setSavedKey(response.configKey, domain, username || undefined);
    await setOnlineStatus(response.online);

    if (response.token) {
      await settingsSet(AUTH_KEYS.AUTH_TOKEN, response.token);
    }

    // 使用本次 reg 返回的最新 serverHost/serverPort 覆盖本地配置（reg 返回可能随服务端策略变化）
    if (response.serverHost && response.serverPort) {
      await saveServerConfig(response.serverHost, response.serverPort);
    }

    const currentUserInfo = await getUserInfo();
    await setUserInfo({
      ...currentUserInfo,
      id: response.id,
      username: username || "",
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
