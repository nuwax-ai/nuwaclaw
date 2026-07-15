import { CLI_AGENT_PORT, CLI_FILE_SERVER_PORT } from "../ports.js";

const SUCCESS_CODE = "0000";

const ERROR_MESSAGES: Record<string, string> = {
  "4010": "未登录",
  "4011": "登录已过期",
  "1001": "客户端未找到",
  "9999": "系统错误",
};

export interface SandboxValue {
  hostWithScheme?: string;
  agentPort: number;
  vncPort: number;
  fileServerPort: number;
  guiMcpPort: number;
  adminServerPort: number;
  ttydPort?: number;
  apiKey?: string;
  maxUsers?: number;
}

export interface ClientRegisterParams {
  username: string;
  password: string;
  savedKey?: string;
  deviceId?: string;
  sandboxConfigValue: SandboxValue;
}

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
  serverHost?: string;
  serverPort?: number;
  token?: string;
}

interface ApiEnvelope<T> {
  code: string;
  displayCode?: string;
  message: string;
  success: boolean;
  data: T;
  tid?: string;
}

/** Normalizes a user-supplied domain the same way the Electron client does: trim trailing slashes, default to https://. */
export function normalizeServerHost(input: string): string {
  let value = input.trim();
  if (!value) return value;
  value = value.replace(/\/+$/, "");
  if (/^https?:\/\//i.test(value)) return value;
  return `https://${value}`;
}

export class RegError extends Error {
  constructor(
    message: string,
    public code?: string,
  ) {
    super(message);
    this.name = "RegError";
  }
}

/**
 * Ports nuwa-cli doesn't run (vnc/gui-mcp/admin/ttyd) are reported as 0,
 * mirroring the Electron client's own `vncPort: 0` convention for disabled
 * features. agentPort/fileServerPort default away from Electron's 60005-60009
 * range so both can run on the same machine without colliding.
 */
export function defaultSandboxValue(
  overrides?: Partial<SandboxValue>,
): SandboxValue {
  return {
    hostWithScheme: "http://127.0.0.1",
    agentPort: CLI_AGENT_PORT,
    vncPort: 0,
    fileServerPort: CLI_FILE_SERVER_PORT,
    guiMcpPort: 0,
    adminServerPort: 0,
    ttydPort: 0,
    apiKey: "",
    maxUsers: 1,
    ...overrides,
  };
}

/** POST {domain}/api/sandbox/config/reg, same contract as the Electron client's registerClient(). */
export async function registerClient(
  domain: string,
  params: ClientRegisterParams,
  timeoutMs = 60000,
): Promise<ClientRegisterResponse> {
  const url = `${domain}/api/sandbox/config/reg`;
  let response: Response;
  try {
    response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(params),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (err) {
    if (
      (err as Error).name === "TimeoutError" ||
      (err as Error).name === "AbortError"
    ) {
      throw new RegError(`请求超时（${timeoutMs}ms）：${url}`);
    }
    throw new RegError(`请求失败：${(err as Error).message}`);
  }

  if (!response.ok) {
    throw new RegError(`HTTP ${response.status}: ${response.statusText}`);
  }

  const envelope =
    (await response.json()) as ApiEnvelope<ClientRegisterResponse>;
  if (envelope.code !== SUCCESS_CODE) {
    const message =
      envelope.message ||
      ERROR_MESSAGES[envelope.code] ||
      `请求失败（错误码 ${envelope.code}）`;
    throw new RegError(message, envelope.code);
  }
  return envelope.data;
}
