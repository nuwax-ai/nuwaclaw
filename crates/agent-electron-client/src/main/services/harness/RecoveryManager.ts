/**
 * RecoveryManager — 任务错误恢复策略
 *
 * 内置策略：
 *   transient       → retry（最多 3 次，5s 退避）
 *   rate_limit      → wait（30s 后重试）
 *   permission_denied → escalate（转为人工审批）
 *   security_violation → abort（立即终止）
 *   validation_error  → pause（暂停等待修正）
 *
 * 使用方法：
 *   const action = recoveryManager.classify(error);
 *   const result = await recoveryManager.execute(action, { taskId, retryFn });
 */

import { structuredLog } from "../../bootstrap/logConfig";
import type { RecoveryStrategy, RecoveryAction } from "@shared/types/harness";

export interface RecoveryContext {
  taskId: string;
  sessionId?: string;
  retryCount?: number;
  /** 重试时调用的函数 */
  retryFn?: () => Promise<unknown>;
  /** escalate 时调用的函数（转人工审批） */
  escalateFn?: (reason: string) => Promise<unknown>;
}

export interface RecoveryResult {
  action: RecoveryAction;
  success: boolean;
  /** 重试后的返回值（action=retry 时） */
  output?: unknown;
  error?: string;
}

const DEFAULT_STRATEGIES: RecoveryStrategy[] = [
  {
    errorType: "transient",
    action: "retry",
    maxRetries: 3,
    delaySeconds: 5,
  },
  {
    errorType: "rate_limit",
    action: "wait",
    delaySeconds: 30,
  },
  {
    errorType: "permission_denied",
    action: "escalate",
  },
  {
    errorType: "security_violation",
    action: "abort",
  },
  {
    errorType: "validation_error",
    action: "pause",
  },
  {
    errorType: "network_error",
    action: "retry",
    maxRetries: 3,
    delaySeconds: 10,
  },
  {
    errorType: "timeout",
    action: "retry",
    maxRetries: 2,
    delaySeconds: 15,
  },
  {
    errorType: "unknown",
    action: "pause",
  },
];

/** 错误关键词到错误类型的映射 */
const ERROR_CLASSIFIERS: Array<{ patterns: RegExp[]; errorType: string }> = [
  {
    patterns: [/rate.?limit/i, /too many requests/i, /429/],
    errorType: "rate_limit",
  },
  {
    patterns: [/permission denied/i, /EACCES/i, /forbidden/i, /403/],
    errorType: "permission_denied",
  },
  {
    patterns: [/security/i, /sandbox violation/i, /blocked by policy/i],
    errorType: "security_violation",
  },
  {
    patterns: [/ECONNREFUSED/i, /ETIMEDOUT/i, /network/i, /ENOTFOUND/i],
    errorType: "network_error",
  },
  {
    patterns: [/timeout/i, /timed out/i],
    errorType: "timeout",
  },
  {
    patterns: [/ECONNRESET/i, /socket hang up/i, /EPIPE/i, /ENOENT/i],
    errorType: "transient",
  },
  {
    patterns: [/invalid/i, /validation/i, /schema/i, /parse error/i],
    errorType: "validation_error",
  },
];

export class RecoveryManager {
  private strategies: RecoveryStrategy[] = [...DEFAULT_STRATEGIES];
  /** 每个任务的重试计数，key = `${taskId}:${errorType}` */
  private retryCounts = new Map<string, number>();

  // ==================== 错误分类 ====================

  /**
   * 将错误消息分类为错误类型
   */
  classify(error: Error | string): string {
    const message = typeof error === "string" ? error : error.message;
    for (const classifier of ERROR_CLASSIFIERS) {
      if (classifier.patterns.some((p) => p.test(message))) {
        return classifier.errorType;
      }
    }
    return "unknown";
  }

  /**
   * 查找匹配的恢复策略
   */
  findStrategy(errorType: string): RecoveryStrategy {
    return (
      this.strategies.find((s) => s.errorType === errorType) ??
      this.strategies.find((s) => s.errorType === "unknown") ?? {
        errorType: "unknown",
        action: "pause",
      }
    );
  }

  // ==================== 执行恢复 ====================

  /**
   * 根据错误执行恢复策略
   */
  async execute(
    error: Error | string,
    ctx: RecoveryContext,
  ): Promise<RecoveryResult> {
    const errorType = this.classify(error);
    const strategy = this.findStrategy(errorType);
    const errorMsg = typeof error === "string" ? error : error.message;

    structuredLog(
      "info",
      "harness",
      `Recovery: type=${errorType}, action=${strategy.action}`,
      {
        taskId: ctx.taskId,
        data: { errorType, action: strategy.action },
      },
    );

    switch (strategy.action) {
      case "retry":
        return this.handleRetry(strategy, ctx, errorType, errorMsg);

      case "wait":
        return this.handleWait(strategy, ctx, errorType, errorMsg);

      case "escalate":
        return this.handleEscalate(ctx, errorMsg);

      case "abort":
        return this.handleAbort(ctx, errorMsg);

      case "pause":
        return this.handlePause(ctx, errorMsg);

      case "skip":
        return { action: "skip", success: true };

      default:
        return { action: "pause", success: false, error: errorMsg };
    }
  }

  // ==================== 策略处理 ====================

  private async handleRetry(
    strategy: RecoveryStrategy,
    ctx: RecoveryContext,
    errorType: string,
    errorMsg: string,
  ): Promise<RecoveryResult> {
    const countKey = `${ctx.taskId}:${errorType}`;
    const currentCount = this.retryCounts.get(countKey) ?? 0;
    const maxRetries = strategy.maxRetries ?? 3;

    if (currentCount >= maxRetries) {
      structuredLog(
        "warn",
        "harness",
        `Max retries reached for ${errorType}, escalating to pause`,
        {
          taskId: ctx.taskId,
          data: { errorType, maxRetries },
        },
      );
      this.retryCounts.delete(countKey);
      return { action: "pause", success: false, error: errorMsg };
    }

    this.retryCounts.set(countKey, currentCount + 1);
    const delayMs = (strategy.delaySeconds ?? 5) * 1000;
    // 指数退避
    const backoffMs = delayMs * Math.pow(2, currentCount);

    structuredLog(
      "info",
      "harness",
      `Retry ${currentCount + 1}/${maxRetries} for ${errorType} in ${backoffMs}ms`,
      {
        taskId: ctx.taskId,
        data: { errorType, attempt: currentCount + 1, maxRetries, backoffMs },
      },
    );

    await this.sleep(backoffMs);

    if (!ctx.retryFn) {
      return {
        action: "retry",
        success: false,
        error: "No retry function provided",
      };
    }

    try {
      const output = await ctx.retryFn();
      this.retryCounts.delete(countKey);
      structuredLog("info", "harness", `Retry succeeded for ${errorType}`, {
        taskId: ctx.taskId,
        data: { errorType },
      });
      return { action: "retry", success: true, output };
    } catch (e) {
      const retryError = e instanceof Error ? e.message : String(e);
      structuredLog("warn", "harness", `Retry failed: ${retryError}`, {
        taskId: ctx.taskId,
        data: { error: retryError },
      });
      return { action: "retry", success: false, error: retryError };
    }
  }

  private async handleWait(
    strategy: RecoveryStrategy,
    ctx: RecoveryContext,
    errorType: string,
    errorMsg: string,
  ): Promise<RecoveryResult> {
    const delayMs = (strategy.delaySeconds ?? 30) * 1000;
    structuredLog(
      "info",
      "harness",
      `Waiting ${delayMs}ms before retry for ${errorType}`,
      {
        taskId: ctx.taskId,
        data: { errorType, delayMs },
      },
    );
    await this.sleep(delayMs);

    if (!ctx.retryFn) {
      return { action: "wait", success: false, error: errorMsg };
    }

    try {
      const output = await ctx.retryFn();
      return { action: "wait", success: true, output };
    } catch (e) {
      return {
        action: "pause",
        success: false,
        error: e instanceof Error ? e.message : String(e),
      };
    }
  }

  private async handleEscalate(
    ctx: RecoveryContext,
    errorMsg: string,
  ): Promise<RecoveryResult> {
    structuredLog(
      "warn",
      "harness",
      "Escalating permission error to human review",
      {
        taskId: ctx.taskId,
      },
    );
    if (ctx.escalateFn) {
      try {
        await ctx.escalateFn(errorMsg);
        return { action: "escalate", success: true };
      } catch (e) {
        return {
          action: "abort",
          success: false,
          error: e instanceof Error ? e.message : String(e),
        };
      }
    }
    return { action: "escalate", success: false, error: errorMsg };
  }

  private handleAbort(ctx: RecoveryContext, errorMsg: string): RecoveryResult {
    structuredLog("error", "harness", "Aborting due to security violation", {
      taskId: ctx.taskId,
      data: { error: errorMsg },
    });
    return { action: "abort", success: false, error: errorMsg };
  }

  private handlePause(ctx: RecoveryContext, errorMsg: string): RecoveryResult {
    structuredLog("warn", "harness", "Pausing for manual intervention", {
      taskId: ctx.taskId,
      data: { error: errorMsg },
    });
    return { action: "pause", success: false, error: errorMsg };
  }

  // ==================== 工具 ====================

  /** 添加或覆盖策略 */
  addStrategy(strategy: RecoveryStrategy): void {
    const idx = this.strategies.findIndex(
      (s) => s.errorType === strategy.errorType,
    );
    if (idx >= 0) {
      this.strategies[idx] = strategy;
    } else {
      this.strategies.push(strategy);
    }
  }

  /** 清除任务的重试计数 */
  resetRetryCounts(taskId: string): void {
    for (const key of this.retryCounts.keys()) {
      if (key.startsWith(`${taskId}:`)) {
        this.retryCounts.delete(key);
      }
    }
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

export const recoveryManager = new RecoveryManager();
