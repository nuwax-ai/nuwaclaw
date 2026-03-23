/**
 * NuwaClaw API 请求封装
 * 统一处理请求、响应、错误码
 */

import { message } from "antd";
import { DEFAULT_SERVER_HOST, DEFAULT_API_TIMEOUT } from "@shared/constants";

// 错误码定义
const SUCCESS_CODE = "0000";

// 错误码对应的消息
const ERROR_MESSAGES: Record<string, string> = {
  "0000": "操作成功",
  "4010": "用户未登录，请重新登录",
  "4011": "登录已过期，请重新登录",
  "1001": "客户端不存在或已下架",
  "9999": "系统错误，请稍后重试",
};

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
        ERROR_MESSAGES[result.code] ||
        `请求失败 (错误码: ${result.code})`;

      console.error("API Error:", result);

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
      const timeoutMsg = `请求超时（>${timeoutMs}ms），请检查网络或服务器状态`;
      console.error("API Request Timeout:", finalUrl, error);
      if (options.showError !== false) {
        message.error(timeoutMsg);
      }
      throw new Error(timeoutMsg);
    }

    console.error("API Request Error:", error);

    // 检测是否是重定向到登录页面的情况（后端返回 HTML）
    const isLoginRedirect =
      error.message?.includes("/login") || error.message?.includes("redirect");

    // 生成用户友好的错误信息
    let userMessage: string = "";
    if (isLoginRedirect) {
      userMessage = "登录遇到问题，请检查配置域名信息或服务状态后重试";
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
