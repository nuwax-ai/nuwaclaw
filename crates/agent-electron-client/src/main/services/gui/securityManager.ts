/**
 * GUI Agent 安全控制
 *
 * - Token 生成 / 验证 / 轮换
 * - 令牌桶速率限制
 * - 环形缓冲审计日志
 */

import { randomUUID, timingSafeEqual } from "crypto";
import log from "electron-log";
import type { AuditLogEntry } from "@shared/types/guiAgentTypes";

const TAG = "[GuiSecurity]";

// ==================== Token Management ====================

let currentToken: string | null = null;

/** 生成新的认证 Token */
export function generateToken(): string {
  currentToken = randomUUID();
  log.info(`${TAG} New token generated`);
  return currentToken;
}

/** 获取当前 Token */
export function getToken(): string | null {
  return currentToken;
}

/** 验证 Bearer Token (timing-safe) */
export function validateToken(authHeader: string | undefined): boolean {
  if (!currentToken) return false;
  if (!authHeader) return false;
  const token = authHeader.startsWith("Bearer ")
    ? authHeader.slice(7)
    : authHeader;
  if (token.length !== currentToken.length) return false;
  try {
    return timingSafeEqual(Buffer.from(token), Buffer.from(currentToken));
  } catch {
    return false;
  }
}

/** 轮换 Token（返回新 Token） */
export function rotateToken(): string {
  return generateToken();
}

/** 清除 Token（停止服务时调用） */
export function clearToken(): void {
  currentToken = null;
}

// ==================== Rate Limiter (Token Bucket) ====================

interface RateLimiterState {
  tokens: number;
  maxTokens: number;
  refillRate: number; // tokens per second
  lastRefill: number;
}

let rateLimiter: RateLimiterState | null = null;

/** 初始化速率限制器 */
export function initRateLimiter(opsPerSecond: number): void {
  rateLimiter = {
    tokens: opsPerSecond,
    maxTokens: opsPerSecond,
    refillRate: opsPerSecond,
    lastRefill: Date.now(),
  };
}

/** 尝试消费一个令牌，返回是否允许 */
export function consumeRateToken(): boolean {
  if (!rateLimiter) return true;

  const now = Date.now();
  const elapsed = (now - rateLimiter.lastRefill) / 1000;
  rateLimiter.tokens = Math.min(
    rateLimiter.maxTokens,
    rateLimiter.tokens + elapsed * rateLimiter.refillRate,
  );
  rateLimiter.lastRefill = now;

  if (rateLimiter.tokens >= 1) {
    rateLimiter.tokens -= 1;
    return true;
  }
  return false;
}

/** 重置速率限制器 */
export function resetRateLimiter(): void {
  rateLimiter = null;
}

// ==================== Audit Log (Ring Buffer) ====================

const MAX_AUDIT_ENTRIES = 1000;
const auditBuffer: (AuditLogEntry | null)[] = new Array(MAX_AUDIT_ENTRIES).fill(
  null,
);
let auditWriteIdx = 0;
let auditCount = 0;

/** 记录审计日志 */
export function logAudit(entry: Omit<AuditLogEntry, "timestamp">): void {
  const fullEntry: AuditLogEntry = {
    ...entry,
    timestamp: Date.now(),
  };

  auditBuffer[auditWriteIdx] = fullEntry;
  auditWriteIdx = (auditWriteIdx + 1) % MAX_AUDIT_ENTRIES;
  if (auditCount < MAX_AUDIT_ENTRIES) auditCount++;

  if (!entry.success) {
    log.warn(
      `${TAG} Audit: ${entry.path} ${entry.action} FAILED: ${entry.error}`,
    );
  }
}

/** 获取审计日志（最近 N 条，按时间正序） */
export function getAuditLog(limit = 100): AuditLogEntry[] {
  const n = Math.min(limit, auditCount);
  const result: AuditLogEntry[] = [];
  // Read the last n entries in chronological order
  const start = (auditWriteIdx - n + MAX_AUDIT_ENTRIES) % MAX_AUDIT_ENTRIES;
  for (let i = 0; i < n; i++) {
    const entry = auditBuffer[(start + i) % MAX_AUDIT_ENTRIES];
    if (entry) result.push(entry);
  }
  return result;
}

/** 清除审计日志 */
export function clearAuditLog(): void {
  auditBuffer.fill(null);
  auditWriteIdx = 0;
  auditCount = 0;
}
