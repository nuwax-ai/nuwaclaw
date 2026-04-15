/**
 * 审计日志 IPC Handlers
 *
 * 提供审计日志查询接口，供前端合规审计页面使用
 *
 * @version 1.0.0
 * @updated 2026-04-15
 */

import { ipcMain } from "electron";
import log from "electron-log";
import { z } from "zod";
import auditLogger from "../services/sandbox/auditLoggerSingleton";
import type {
  AuditLogEntry,
  SecurityMetrics,
} from "../services/sandbox/AuditLogger";

// 参数校验 schema
const getRecentEventsSchema = z
  .object({
    limit: z.number().int().positive().max(1000).optional(),
  })
  .optional();

const getSessionEventsSchema = z.object({
  sessionId: z.string().min(1),
});

const exportLogsSchema = z.object({
  outputPath: z.string().min(1),
  startDate: z.string().optional(),
  endDate: z.string().optional(),
});

/**
 * 注册审计日志 IPC handlers
 */
export function registerAuditHandlers(): void {
  // 获取最近审计事件
  ipcMain.handle("audit:getRecentEvents", (_, params?: { limit?: number }) => {
    const parsed = getRecentEventsSchema.safeParse(params);
    if (!parsed.success) {
      log.warn(
        "[IPC] audit:getRecentEvents invalid args:",
        parsed.error.issues,
      );
      return { success: false, error: "Invalid arguments" };
    }

    try {
      const limit = parsed.data?.limit ?? 100;
      const events = auditLogger.getRecentEvents(limit);
      return { success: true, events };
    } catch (error) {
      log.error("[IPC] audit:getRecentEvents failed:", error);
      return { success: false, error: String(error) };
    }
  });

  // 获取特定会话的审计事件
  ipcMain.handle(
    "audit:getSessionEvents",
    (_, params: { sessionId: string }) => {
      const parsed = getSessionEventsSchema.safeParse(params);
      if (!parsed.success) {
        log.warn(
          "[IPC] audit:getSessionEvents invalid args:",
          parsed.error.issues,
        );
        return { success: false, error: "Invalid arguments" };
      }

      try {
        const events = auditLogger.getSessionEvents(parsed.data.sessionId);
        return { success: true, events };
      } catch (error) {
        log.error("[IPC] audit:getSessionEvents failed:", error);
        return { success: false, error: String(error) };
      }
    },
  );

  // 获取安全指标
  ipcMain.handle("audit:getMetrics", () => {
    try {
      const metrics: SecurityMetrics = auditLogger.getMetrics();
      return { success: true, metrics };
    } catch (error) {
      log.error("[IPC] audit:getMetrics failed:", error);
      return { success: false, error: String(error) };
    }
  });

  // 导出审计日志
  ipcMain.handle(
    "audit:exportLogs",
    async (
      _,
      params: { outputPath: string; startDate?: string; endDate?: string },
    ) => {
      const parsed = exportLogsSchema.safeParse(params);
      if (!parsed.success) {
        log.warn("[IPC] audit:exportLogs invalid args:", parsed.error.issues);
        return { success: false, error: "Invalid arguments" };
      }

      try {
        const startDate = parsed.data.startDate
          ? new Date(parsed.data.startDate)
          : undefined;
        const endDate = parsed.data.endDate
          ? new Date(parsed.data.endDate)
          : undefined;

        const count = await auditLogger.exportLogs(
          parsed.data.outputPath,
          startDate,
          endDate,
        );
        return { success: true, count };
      } catch (error) {
        log.error("[IPC] audit:exportLogs failed:", error);
        return { success: false, error: String(error) };
      }
    },
  );

  // 清理过期日志
  ipcMain.handle("audit:cleanup", () => {
    try {
      auditLogger.cleanup();
      return { success: true };
    } catch (error) {
      log.error("[IPC] audit:cleanup failed:", error);
      return { success: false, error: String(error) };
    }
  });

  log.info("[IPC] Audit handlers registered");
}
