/**
 * 沙箱错误类定义
 *
 * @version 1.0.0
 * @updated 2026-03-22
 */

/**
 * 沙箱错误码
 */
export enum SandboxErrorCode {
  /** 沙箱不可用 */
  SANDBOX_UNAVAILABLE = "SANDBOX_UNAVAILABLE",
  /** Docker 不可用 */
  DOCKER_UNAVAILABLE = "DOCKER_UNAVAILABLE",
  /** WSL 不可用 */
  WSL_UNAVAILABLE = "WSL_UNAVAILABLE",
  /** Firejail 不可用 */
  FIREJAIL_UNAVAILABLE = "FIREJAIL_UNAVAILABLE",

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
   * 获取用户友好的错误消息
   */
  getUserMessage(): string {
    switch (this.code) {
      case SandboxErrorCode.SANDBOX_UNAVAILABLE:
        return "沙箱环境不可用，请检查沙箱配置";
      case SandboxErrorCode.DOCKER_UNAVAILABLE:
        return "Docker 不可用，请确保 Docker Desktop 已安装并运行";
      case SandboxErrorCode.WSL_UNAVAILABLE:
        return "WSL 不可用，请确保 WSL2 已正确安装";
      case SandboxErrorCode.FIREJAIL_UNAVAILABLE:
        return "Firejail 不可用，请确保 Firejail 已安装";

      case SandboxErrorCode.WORKSPACE_NOT_FOUND:
        return `工作区未找到: ${this.workspaceId || this.sessionId || "未知"}`;
      case SandboxErrorCode.WORKSPACE_EXISTS:
        return `工作区已存在: ${this.sessionId || "未知"}`;
      case SandboxErrorCode.WORKSPACE_CREATE_FAILED:
        return "工作区创建失败，请检查磁盘空间和权限";
      case SandboxErrorCode.WORKSPACE_DESTROY_FAILED:
        return "工作区销毁失败，请手动清理";
      case SandboxErrorCode.WORKSPACE_INVALID_STATE:
        return "工作区状态无效，请重试或重新创建工作区";

      case SandboxErrorCode.PERMISSION_DENIED:
        return "权限被拒绝";
      case SandboxErrorCode.PERMISSION_TIMEOUT:
        return "权限请求超时，请重试";
      case SandboxErrorCode.PERMISSION_POLICY_VIOLATION:
        return "操作被安全策略禁止";

      case SandboxErrorCode.EXECUTION_FAILED:
        return "命令执行失败";
      case SandboxErrorCode.EXECUTION_TIMEOUT:
        return "命令执行超时";
      case SandboxErrorCode.EXECUTION_BLOCKED:
        return "命令被安全策略拦截";
      case SandboxErrorCode.COMMAND_NOT_FOUND:
        return "命令未找到";

      case SandboxErrorCode.FILE_NOT_FOUND:
        return "文件未找到";
      case SandboxErrorCode.FILE_WRITE_FAILED:
        return "文件写入失败";
      case SandboxErrorCode.FILE_READ_FAILED:
        return "文件读取失败";
      case SandboxErrorCode.FILE_DELETE_FAILED:
        return "文件删除失败";
      case SandboxErrorCode.DIRECTORY_OPERATION_FAILED:
        return "目录操作失败";

      case SandboxErrorCode.CLEANUP_FAILED:
        return "清理失败";
      case SandboxErrorCode.CLEANUP_TIMEOUT:
        return "清理超时";

      case SandboxErrorCode.CONFIG_INVALID:
        return "配置无效";
      case SandboxErrorCode.CONFIG_MISSING:
        return "配置缺失";

      case SandboxErrorCode.CONTAINER_OPERATION_FAILED:
        return "容器操作失败";
      case SandboxErrorCode.CONTAINER_START_FAILED:
        return "容器启动失败";
      case SandboxErrorCode.CONTAINER_STOP_FAILED:
        return "容器停止失败";

      case SandboxErrorCode.RESOURCE_INSUFFICIENT:
        return "资源不足";
      case SandboxErrorCode.OUT_OF_MEMORY:
        return "内存不足";
      case SandboxErrorCode.OUT_OF_DISK_SPACE:
        return "磁盘空间不足";

      default:
        return this.message || "未知错误";
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
      SandboxErrorCode.WSL_UNAVAILABLE,
      SandboxErrorCode.FIREJAIL_UNAVAILABLE,
      SandboxErrorCode.OUT_OF_DISK_SPACE,
    ];
    return userInterventionCodes.includes(this.code);
  }
}

// ============================================================================
// 特化错误类
// ============================================================================

/**
 * 沙箱不可用错误
 */
export class SandboxUnavailableError extends SandboxError {
  constructor(
    sandboxType: string,
    options?: { cause?: Error; details?: Record<string, unknown> },
  ) {
    super(
      `沙箱不可用: ${sandboxType}`,
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
 * 从未知错误创建沙箱错误
 */
export function toSandboxError(
  error: unknown,
  defaultMessage: string = "未知错误",
  defaultCode: SandboxErrorCode = SandboxErrorCode.UNKNOWN_ERROR,
  options?: { sessionId?: string; workspaceId?: string },
): SandboxError {
  if (isSandboxError(error)) {
    return error;
  }

  if (error instanceof Error) {
    return new SandboxError(error.message || defaultMessage, defaultCode, {
      ...options,
      cause: error,
    });
  }

  return new SandboxError(defaultMessage, defaultCode, {
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
