/**
 * 沙箱错误类定义
 *
 * @version 1.0.0
 * @updated 2026-03-22
 */

/** Lazy-loaded i18n t() from main process context */
let _i18nT: ((key: string, ...values: string[]) => string) | null = null;
function i18nT(key: string, ...values: string[]): string {
  if (!_i18nT) {
    try {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      _i18nT = require("../../main/services/i18n").t;
    } catch {
      // Not in main process — fall through to English hardcoded below
    }
  }
  return _i18nT ? _i18nT(key, ...values) : key;
}

/**
 * 沙箱错误码
 */
export enum SandboxErrorCode {
  /** 沙箱不可用 */
  SANDBOX_UNAVAILABLE = "SANDBOX_UNAVAILABLE",
  /** Docker 不可用 */
  DOCKER_UNAVAILABLE = "DOCKER_UNAVAILABLE",
  /** Helper 二进制不可用 */
  HELPER_UNAVAILABLE = "HELPER_UNAVAILABLE",

  /** 工作区未找到 */
  WORKSPACE_NOT_FOUND = "WORKSPACE_NOT_FOUND",
  /** 工作区已存在 */
  WORKSPACE_EXISTS = "WORKSPACE_EXISTS",
  /** 工作区创建失败 */
  WORKSPACE_CREATE_FAILED = "WORKSPACE_CREATE_FAILED",
  /** 工作区销毁失败 */
  WORKSPACE_DESTROY_FAILED = "WORKSPACE_DESTROY_FAILED",
  /** 工作区状态无效 */
  WORKSPACE_INVALID_STATE = "WORKSPACE_INVALID_STATE",

  /** 权限被拒绝 */
  PERMISSION_DENIED = "PERMISSION_DENIED",
  /** 权限请求超时 */
  PERMISSION_TIMEOUT = "PERMISSION_TIMEOUT",
  /** 权限策略违规 */
  PERMISSION_POLICY_VIOLATION = "PERMISSION_POLICY_VIOLATION",

  /** 命令执行失败 */
  EXECUTION_FAILED = "EXECUTION_FAILED",
  /** 命令执行超时 */
  EXECUTION_TIMEOUT = "EXECUTION_TIMEOUT",
  /** 命令被拦截 */
  EXECUTION_BLOCKED = "EXECUTION_BLOCKED",
  /** 命令不存在 */
  COMMAND_NOT_FOUND = "COMMAND_NOT_FOUND",

  /** 文件未找到 */
  FILE_NOT_FOUND = "FILE_NOT_FOUND",
  /** 文件写入失败 */
  FILE_WRITE_FAILED = "FILE_WRITE_FAILED",
  /** 文件读取失败 */
  FILE_READ_FAILED = "FILE_READ_FAILED",
  /** 文件删除失败 */
  FILE_DELETE_FAILED = "FILE_DELETE_FAILED",
  /** 目录操作失败 */
  DIRECTORY_OPERATION_FAILED = "DIRECTORY_OPERATION_FAILED",

  /** 清理失败 */
  CLEANUP_FAILED = "CLEANUP_FAILED",
  /** 清理超时 */
  CLEANUP_TIMEOUT = "CLEANUP_TIMEOUT",

  /** 配置无效 */
  CONFIG_INVALID = "CONFIG_INVALID",
  /** 配置缺失 */
  CONFIG_MISSING = "CONFIG_MISSING",

  /** 容器操作失败（Docker 特有） */
  CONTAINER_OPERATION_FAILED = "CONTAINER_OPERATION_FAILED",
  /** 容器启动失败 */
  CONTAINER_START_FAILED = "CONTAINER_START_FAILED",
  /** 容器停止失败 */
  CONTAINER_STOP_FAILED = "CONTAINER_STOP_FAILED",

  /** 资源不足 */
  RESOURCE_INSUFFICIENT = "RESOURCE_INSUFFICIENT",
  /** 内存不足 */
  OUT_OF_MEMORY = "OUT_OF_MEMORY",
  /** 磁盘空间不足 */
  OUT_OF_DISK_SPACE = "OUT_OF_DISK_SPACE",

  /** 内部错误 */
  INTERNAL_ERROR = "INTERNAL_ERROR",
  /** 未知错误 */
  UNKNOWN_ERROR = "UNKNOWN_ERROR",
}

/**
 * 沙箱错误类
 */
export class SandboxError extends Error {
  /** 错误码 */
  public readonly code: SandboxErrorCode;
  /** 关联的会话 ID */
  public readonly sessionId?: string;
  /** 工作区 ID */
  public readonly workspaceId?: string;
  /** 原始错误 */
  public readonly cause?: Error;
  /** 时间戳 */
  public readonly timestamp: Date;
  /** 附加信息 */
  public readonly details?: Record<string, unknown>;

  constructor(
    message: string,
    code: SandboxErrorCode,
    options?: {
      sessionId?: string;
      workspaceId?: string;
      cause?: Error;
      details?: Record<string, unknown>;
    },
  ) {
    super(message);
    this.name = "SandboxError";
    this.code = code;
    this.sessionId = options?.sessionId;
    this.workspaceId = options?.workspaceId;
    this.cause = options?.cause;
    this.details = options?.details;
    this.timestamp = new Date();

    // 保持正确的原型链
    Object.setPrototypeOf(this, SandboxError.prototype);

    // 捕获堆栈跟踪
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, SandboxError);
    }
  }

  /**
   * 转换为 JSON 格式
   */
  toJSON(): Record<string, unknown> {
    return {
      name: this.name,
      message: this.message,
      code: this.code,
      sessionId: this.sessionId,
      workspaceId: this.workspaceId,
      timestamp: this.timestamp.toISOString(),
      details: this.details,
      cause: this.cause?.message,
      stack: this.stack,
    };
  }

  /**
   * 获取用户友好的错误消息（走 i18n）
   */
  getUserMessage(): string {
    const id = this.workspaceId || this.sessionId || "";
    switch (this.code) {
      case SandboxErrorCode.SANDBOX_UNAVAILABLE:
        return i18nT("Claw.Sandbox.unavailable");
      case SandboxErrorCode.DOCKER_UNAVAILABLE:
        return i18nT("Claw.Sandbox.dockerUnavailable");
      case SandboxErrorCode.HELPER_UNAVAILABLE:
        return i18nT("Claw.Sandbox.helperUnavailable");

      case SandboxErrorCode.WORKSPACE_NOT_FOUND:
        return i18nT("Claw.Sandbox.workspaceNotFound", id);
      case SandboxErrorCode.WORKSPACE_EXISTS:
        return i18nT("Claw.Sandbox.workspaceExists", this.sessionId || "");
      case SandboxErrorCode.WORKSPACE_CREATE_FAILED:
        return i18nT("Claw.Sandbox.workspaceCreateFailed");
      case SandboxErrorCode.WORKSPACE_DESTROY_FAILED:
        return i18nT("Claw.Sandbox.workspaceDestroyFailed");
      case SandboxErrorCode.WORKSPACE_INVALID_STATE:
        return i18nT("Claw.Sandbox.workspaceInvalidState");

      case SandboxErrorCode.PERMISSION_DENIED:
        return i18nT("Claw.Permissions.denied");
      case SandboxErrorCode.PERMISSION_TIMEOUT:
        return i18nT("Claw.Permissions.timeout");
      case SandboxErrorCode.PERMISSION_POLICY_VIOLATION:
        return i18nT("Claw.Permissions.policyViolation");

      case SandboxErrorCode.EXECUTION_FAILED:
        return i18nT("Claw.Sandbox.executionFailed");
      case SandboxErrorCode.EXECUTION_TIMEOUT:
        return i18nT("Claw.Sandbox.executionTimeout");
      case SandboxErrorCode.EXECUTION_BLOCKED:
        return i18nT("Claw.Sandbox.executionBlocked");
      case SandboxErrorCode.COMMAND_NOT_FOUND:
        return i18nT("Claw.Sandbox.commandNotFound");

      case SandboxErrorCode.FILE_NOT_FOUND:
        return i18nT("Claw.Sandbox.fileNotFound");
      case SandboxErrorCode.FILE_WRITE_FAILED:
        return i18nT("Claw.Sandbox.fileWriteFailed");
      case SandboxErrorCode.FILE_READ_FAILED:
        return i18nT("Claw.Sandbox.fileReadFailed");
      case SandboxErrorCode.FILE_DELETE_FAILED:
        return i18nT("Claw.Sandbox.fileDeleteFailed");
      case SandboxErrorCode.DIRECTORY_OPERATION_FAILED:
        return i18nT("Claw.Sandbox.directoryOperationFailed");

      case SandboxErrorCode.CLEANUP_FAILED:
        return i18nT("Claw.Sandbox.cleanupFailed");
      case SandboxErrorCode.CLEANUP_TIMEOUT:
        return i18nT("Claw.Sandbox.cleanupTimeout");

      case SandboxErrorCode.CONFIG_INVALID:
        return i18nT("Claw.Sandbox.configInvalid");
      case SandboxErrorCode.CONFIG_MISSING:
        return i18nT("Claw.Sandbox.configMissing");

      case SandboxErrorCode.CONTAINER_OPERATION_FAILED:
        return i18nT("Claw.Sandbox.containerOperationFailed");
      case SandboxErrorCode.CONTAINER_START_FAILED:
        return i18nT("Claw.Sandbox.containerStartFailed");
      case SandboxErrorCode.CONTAINER_STOP_FAILED:
        return i18nT("Claw.Sandbox.containerStopFailed");

      case SandboxErrorCode.RESOURCE_INSUFFICIENT:
        return i18nT("Claw.Sandbox.resourceInsufficient");
      case SandboxErrorCode.OUT_OF_MEMORY:
        return i18nT("Claw.Sandbox.outOfMemory");
      case SandboxErrorCode.OUT_OF_DISK_SPACE:
        return i18nT("Claw.Sandbox.outOfDiskSpace");

      default:
        return this.message || i18nT("Claw.Sandbox.unknownError");
    }
  }

  /**
   * 判断是否为可恢复错误
   */
  isRecoverable(): boolean {
    const recoverableCodes = [
      SandboxErrorCode.EXECUTION_TIMEOUT,
      SandboxErrorCode.PERMISSION_TIMEOUT,
      SandboxErrorCode.CLEANUP_TIMEOUT,
      SandboxErrorCode.CONTAINER_STOP_FAILED,
    ];
    return recoverableCodes.includes(this.code);
  }

  /**
   * 判断是否需要用户干预
   */
  requiresUserIntervention(): boolean {
    const userInterventionCodes = [
      SandboxErrorCode.PERMISSION_DENIED,
      SandboxErrorCode.PERMISSION_POLICY_VIOLATION,
      SandboxErrorCode.EXECUTION_BLOCKED,
      SandboxErrorCode.DOCKER_UNAVAILABLE,
      SandboxErrorCode.HELPER_UNAVAILABLE,
      SandboxErrorCode.OUT_OF_DISK_SPACE,
    ];
    return userInterventionCodes.includes(this.code);
  }
}

// ============================================================================
// 特化错误类
// ============================================================================

/**
 * Sandbox unavailable error
 */
export class SandboxUnavailableError extends SandboxError {
  constructor(
    sandboxType: string,
    options?: { cause?: Error; details?: Record<string, unknown> },
  ) {
    super(
      i18nT("Claw.Sandbox.unavailableWithType", sandboxType),
      SandboxErrorCode.SANDBOX_UNAVAILABLE,
      options,
    );
    this.name = "SandboxUnavailableError";
  }
}

/**
 * 工作区错误
 */
export class WorkspaceError extends SandboxError {
  constructor(
    message: string,
    code: SandboxErrorCode,
    options?: {
      sessionId?: string;
      workspaceId?: string;
      cause?: Error;
      details?: Record<string, unknown>;
    },
  ) {
    super(message, code, options);
    this.name = "WorkspaceError";
  }
}

/**
 * 权限错误
 */
export class PermissionError extends SandboxError {
  constructor(
    message: string,
    options?: {
      sessionId?: string;
      cause?: Error;
      details?: Record<string, unknown>;
    },
  ) {
    super(message, SandboxErrorCode.PERMISSION_DENIED, options);
    this.name = "PermissionError";
  }
}

/**
 * 执行错误
 */
export class ExecutionError extends SandboxError {
  constructor(
    message: string,
    code: SandboxErrorCode = SandboxErrorCode.EXECUTION_FAILED,
    options?: {
      sessionId?: string;
      cause?: Error;
      details?: Record<string, unknown>;
    },
  ) {
    super(message, code, options);
    this.name = "ExecutionError";
  }
}

/**
 * 文件操作错误
 */
export class FileOperationError extends SandboxError {
  constructor(
    message: string,
    code: SandboxErrorCode,
    options?: {
      sessionId?: string;
      cause?: Error;
      details?: Record<string, unknown>;
    },
  ) {
    super(message, code, options);
    this.name = "FileOperationError";
  }
}

/**
 * 配置错误
 */
export class ConfigError extends SandboxError {
  constructor(
    message: string,
    code: SandboxErrorCode = SandboxErrorCode.CONFIG_INVALID,
    options?: { cause?: Error; details?: Record<string, unknown> },
  ) {
    super(message, code, options);
    this.name = "ConfigError";
  }
}

/**
 * 资源错误
 */
export class ResourceError extends SandboxError {
  constructor(
    message: string,
    code: SandboxErrorCode,
    options?: { cause?: Error; details?: Record<string, unknown> },
  ) {
    super(message, code, options);
    this.name = "ResourceError";
  }
}

// ============================================================================
// 错误工具函数
// ============================================================================

/**
 * 判断是否为沙箱错误
 */
export function isSandboxError(error: unknown): error is SandboxError {
  return error instanceof SandboxError;
}

/**
 * Create SandboxError from unknown error
 */
export function toSandboxError(
  error: unknown,
  defaultMessage?: string,
  defaultCode: SandboxErrorCode = SandboxErrorCode.UNKNOWN_ERROR,
  options?: { sessionId?: string; workspaceId?: string },
): SandboxError {
  if (isSandboxError(error)) {
    return error;
  }

  const msg = defaultMessage ?? i18nT("Claw.Sandbox.unknownError");
  if (error instanceof Error) {
    return new SandboxError(error.message || msg, defaultCode, {
      ...options,
      cause: error,
    });
  }

  return new SandboxError(msg, defaultCode, {
    ...options,
    details: { originalError: String(error) },
  });
}

/**
 * 包装异步函数，自动转换错误
 */
export function wrapSandboxError<T>(
  fn: () => Promise<T>,
  defaultMessage: string,
  defaultCode: SandboxErrorCode = SandboxErrorCode.INTERNAL_ERROR,
  options?: { sessionId?: string; workspaceId?: string },
): Promise<T> {
  return fn().catch((error) => {
    throw toSandboxError(error, defaultMessage, defaultCode, options);
  });
}
