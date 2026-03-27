/**
 * 沙箱类型定义
 *
 * @version 1.0.0
 * @created 2026-03-27
 */

// ============================================================================
// 沙箱配置
// ============================================================================

export type SandboxMode = "off" | "on-demand" | "non-main" | "all";

export interface SandboxConfig {
  // 沙箱模式
  mode: SandboxMode;

  // 平台配置
  platform?: {
    darwin?: {
      enabled: boolean;
      type: "seatbelt" | "none";
    };
    linux?: {
      enabled: boolean;
      type: "bubblewrap" | "none";
    };
    win32?: {
      enabled: boolean;
      type: "codex" | "none";
    };
  };

  // 网络配置
  network?: {
    enabled: boolean;
    allowedDomains?: string[];
    deniedDomains?: string[];
  };

  // 文件系统配置
  filesystem?: {
    allowRead?: string[];
    denyRead?: string[];
    allowWrite?: string[];
    denyWrite?: string[];
  };

  // 资源限制
  resources?: {
    memory?: string; // e.g., "2g"
    cpu?: number; // e.g., 2
    timeout?: number; // seconds
  };

  // 用户偏好
  preferences?: {
    showNotifications: boolean;
    askForDangerousOps: boolean;
    auditLogging: boolean;
  };
}

// ============================================================================
// 执行选项和结果
// ============================================================================

export interface ExecuteOptions {
  timeout?: number; // seconds
  signal?: AbortSignal;
  onOutput?: (data: string) => void;
  env?: Record<string, string>;
}

export interface ExecuteResult {
  exitCode: number;
  stdout: string;
  stderr: string;
  duration?: number;
  resources?: {
    memory: number;
    cpu: number;
  };
}

// ============================================================================
// 沙箱接口
// ============================================================================

export interface SandboxInterface {
  // 初始化
  initialize(config: SandboxConfig): Promise<void>;

  // 执行命令
  execute(
    command: string,
    cwd: string,
    options?: ExecuteOptions,
  ): Promise<ExecuteResult>;

  // 文件操作
  readFile(path: string): Promise<string>;
  writeFile(path: string, content: string): Promise<void>;

  // 状态查询
  isAvailable(): Promise<boolean>;
  getStatus(): SandboxStatus;

  // 清理
  cleanup(): Promise<void>;
}

// ============================================================================
// 沙箱状态
// ============================================================================

export interface SandboxStatus {
  available: boolean;
  type: "seatbelt" | "bubblewrap" | "codex" | "none";
  platform: string;
  version?: string;
  config?: SandboxConfig;
}

// ============================================================================
// 默认配置
// ============================================================================

export const DEFAULT_SANDBOX_CONFIG: SandboxConfig = {
  mode: "non-main",

  platform: {
    darwin: { enabled: true, type: "seatbelt" },
    linux: { enabled: true, type: "bubblewrap" },
    win32: { enabled: true, type: "codex" },
  },

  network: {
    enabled: true,
    allowedDomains: [
      "github.com",
      "*.github.com",
      "npmjs.org",
      "registry.npmjs.org",
      "pypi.org",
    ],
    deniedDomains: [],
  },

  filesystem: {
    allowRead: ["."],
    denyRead: ["~/.ssh", "~/.aws", "~/.gnupg"],
    allowWrite: [".", "/tmp"],
    denyWrite: [".env", "*.pem", "*.key"],
  },

  resources: {
    memory: "2g",
    cpu: 2,
    timeout: 300,
  },

  preferences: {
    showNotifications: true,
    askForDangerousOps: true,
    auditLogging: true,
  },
};
