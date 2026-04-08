/**
 * NuwaClaw API 请求封装
 * 统一处理请求、响应、错误码
 */

import { message } from "antd";
import { DEFAULT_SERVER_HOST, DEFAULT_API_TIMEOUT } from "@shared/constants";
import { logger } from "../utils/logService";
import { t } from "./i18n";

// 错误码定义
const SUCCESS_CODE = "0000";

/**
 * 错误码 → i18n key（不在模块加载时调用 t）
 *
 * 说明：i18n.ts 会 import apiRequest，若此处在顶层执行 t()，会与 i18n 形成循环依赖，
 * 此时 t 尚未完成初始化，运行时报 “Cannot access 't' before initialization”。
 * 仅在 apiRequest 执行时再 t(key)，此时模块图已就绪。
 */
const ERROR_MESSAGE_KEYS: Record<string, string> = {
  "0000": "Claw.Api.success",
  "4010": "Claw.Api.notLoggedIn",
  "4011": "Claw.Api.loginExpired",
  "1001": "Claw.Api.clientNotFound",
  "9999": "Claw.Api.systemError",
};

/** 按错误码取已翻译的兜底文案（无映射时返回 undefined） */
function translatedErrorForCode(code: string): string | undefined {
  const key = ERROR_MESSAGE_KEYS[code];
  return key ? t(key) : undefined;
}

// 响应类型定义（内部使用）
interface ApiResponse<T = any> {
  code: string;
  displayCode?: string;
  message: string;
  success: boolean;
  data: T;
  tid?: string;
}

// 请求配置（内部使用）
interface RequestConfig {
  baseUrl?: string;
  timeout?: number;
  headers?: Record<string, string>;
}

// 默认配置
const DEFAULT_CONFIG: RequestConfig = {
  baseUrl: DEFAULT_SERVER_HOST,
  timeout: DEFAULT_API_TIMEOUT,
};

/**
 * 统一的 API 请求函数
 */
export async function apiRequest<T>(
  url: string,
  options: {
    method?: "GET" | "POST" | "PUT" | "DELETE";
    data?: any;
    params?: Record<string, any>;
    headers?: Record<string, string>;
    showError?: boolean;
    baseUrl?: string;
  } = {},
): Promise<T> {
  const config = { ...DEFAULT_CONFIG, ...options };
  const fullUrl = `${config.baseUrl}${url}`;

  // 使用 AbortSignal.timeout 实现请求超时，避免网络挂起时永久阻塞。
  // 运行时要求：Electron 40+（Chromium 120+）支持 AbortSignal.timeout；若需兼容更旧版本需 polyfill（如 setTimeout + AbortController）。
  const timeoutMs = config.timeout ?? DEFAULT_API_TIMEOUT;
  const fetchOptions: RequestInit = {
    method: options.method || "POST",
    headers: {
      "Content-Type": "application/json",
      ...config.headers,
    },
    signal: AbortSignal.timeout(timeoutMs),
  };

  if (options.data) {
    fetchOptions.body = JSON.stringify(options.data);
  }

  let finalUrl = fullUrl;
  if (options.params) {
    const searchParams = new URLSearchParams();
    Object.entries(options.params).forEach(([key, value]) => {
      if (value !== undefined && value !== null) {
        searchParams.append(key, String(value));
      }
    });
    const queryString = searchParams.toString();
    if (queryString) {
      finalUrl = `${fullUrl}?${queryString}`;
    }
  }

  try {
    const response = await fetch(finalUrl, fetchOptions);

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    const result: ApiResponse<T> = await response.json();

    // 统一错误处理
    if (result.code !== SUCCESS_CODE) {
      const errorMsg =
        result.message ||
        translatedErrorForCode(result.code) ||
        `请求失败 (错误码: ${result.code})`;

      logger.error("API Error", "API", {
        code: result.code,
        message: result.message,
      });

      if (options.showError !== false) {
        message.error(errorMsg);
      }

      throw new Error(errorMsg);
    }

    return result.data;
  } catch (error: any) {
    // AbortSignal.timeout 超时后抛出 TimeoutError（name === 'TimeoutError'）
    // 或 AbortError（某些环境），统一转为可读错误
    if (error.name === "TimeoutError" || error.name === "AbortError") {
      const timeoutMsg = t("Claw.Api.timeout", timeoutMs);
      logger.error("Request Timeout", "API", { url: finalUrl });
      if (options.showError !== false) {
        message.error(timeoutMsg);
      }
      throw new Error(timeoutMsg);
    }

    logger.error("Request Error", "API", error);

    // 检测是否是重定向到登录页面的情况（后端返回 HTML）
    const isLoginRedirect =
      error.message?.includes("/login") || error.message?.includes("redirect");

    // 生成用户友好的错误信息
    let userMessage: string = "";
    if (isLoginRedirect) {
      userMessage = t("Claw.Errors.loginRedirect");
    } else if (options.showError !== false && error.message) {
      userMessage = error.message;
    }

    if (options.showError !== false && userMessage) {
      message.error(userMessage);
    }

    throw error;
  }
}

// ========== 客户端注册接口 ==========

/**
 * 沙盒配置值
 */
export interface SandboxValue {
  hostWithScheme?: string;
  agentPort: number;
  vncPort: number;
  fileServerPort: number;
  guiMcpPort: number;
  adminServerPort: number;
  apiKey?: string;
  maxUsers?: number;
}

/**
 * 客户端注册请求参数
 */
export interface ClientRegisterParams {
  username: string;
  password: string;
  savedKey?: string;
  deviceId?: string;
  sandboxConfigValue: SandboxValue;
}

/**
 * 客户端注册响应数据 (SandboxConfigDto)
 */
export interface ClientRegisterResponse {
  id: number;
  scope: string;
  userId: number;
  name: string;
  configKey: string;
  configValue: SandboxValue;
  description: string;
  isActive: boolean;
  online: boolean;
  created: string;
  modified: string;
  /** 服务器地址（客户端连接用） */
  serverHost?: string;
  /** 服务器端口（客户端连接用） */
  serverPort?: number;
  /** 登录态 token，用于 webview cookie 同步 */
  token?: string;
}

/**
 * 注册客户端
 *
 * @param params 注册参数
 * @returns 注册响应数据
 */
export async function registerClient(
  params: ClientRegisterParams,
  options?: {
    baseUrl?: string;
    suppressToast?: boolean;
  },
): Promise<ClientRegisterResponse> {
  return apiRequest<ClientRegisterResponse>("/api/sandbox/config/reg", {
    method: "POST",
    data: params,
    showError: !options?.suppressToast,
    baseUrl: options?.baseUrl,
  });
}
