import * as path from "path";
import { app, safeStorage } from "electron";
import Database from "better-sqlite3";
import log from "electron-log";
import { APP_DATA_DIR_NAME } from "./services/constants";
import { APP_NAME_IDENTIFIER } from "@shared/constants";
import type { ComplianceConfig } from "@shared/types/compliance";
import {
  DEFAULT_COMPLIANCE_CONFIG,
  COMPLIANCE_CONFIG_KEY,
} from "@shared/types/compliance";

/** 敏感 key 列表，这些 key 的值会被 OS Keychain 加密存储 */
const SENSITIVE_SETTING_KEYS = ["anthropic_api_key", "agent_api_key"] as const;

/** 加密值前缀，用于区分加密和明文存储 */
const ENCRYPTED_PREFIX = "ENC:";

const nuwaxHome = path.join(app.getPath("home"), APP_DATA_DIR_NAME);
const dbPath = path.join(nuwaxHome, `${APP_NAME_IDENTIFIER}.db`);

let db: Database.Database | null = null;

// ==================== Schema 版本迁移 ====================

/** 当前代码期望的 schema 版本 */
const CURRENT_SCHEMA_VERSION = 2;

/**
 * 运行版本化 schema 迁移。
 * 每个版本的迁移仅在当前 user_version 低于该版本时执行。
 * 使用 PRAGMA user_version 持久化版本号（SQLite 内置支持）。
 */
function runSchemaMigrations(database: Database.Database): void {
  const versionRow = database.prepare("PRAGMA user_version").get() as {
    user_version: number;
  };
  let currentVersion = versionRow.user_version;
  log.info(`[DB] Current schema version: ${currentVersion}`);

  // v1: 基础 settings 表（历史存在，补全 user_version 标记）
  if (currentVersion < 1) {
    database.exec(`
      CREATE TABLE IF NOT EXISTS settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );
    `);
    database.exec("PRAGMA user_version = 1");
    currentVersion = 1;
    log.info("[DB] Schema migrated to v1");
  }

  // v2: Harness 工作流所需表（tasks / checkpoints / approvals / metrics / audit）
  if (currentVersion < 2) {
    database.exec(`
      CREATE TABLE IF NOT EXISTS tasks (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending',
        engine_type TEXT NOT NULL,
        session_id TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        completed_at INTEGER,
        metadata JSON
      );

      CREATE TABLE IF NOT EXISTS task_checkpoints (
        id TEXT PRIMARY KEY,
        task_id TEXT NOT NULL REFERENCES tasks(id),
        type TEXT NOT NULL,
        status TEXT NOT NULL,
        entered_at INTEGER NOT NULL,
        passed_at INTEGER,
        result JSON
      );

      CREATE TABLE IF NOT EXISTS approval_requests (
        id TEXT PRIMARY KEY,
        task_id TEXT NOT NULL,
        type TEXT NOT NULL,
        priority TEXT NOT NULL,
        title TEXT NOT NULL,
        description TEXT,
        context JSON,
        status TEXT NOT NULL DEFAULT 'pending',
        decision TEXT,
        created_at INTEGER NOT NULL,
        responded_at INTEGER,
        expires_at INTEGER
      );

      CREATE TABLE IF NOT EXISTS harness_metrics (
        id TEXT PRIMARY KEY,
        metric_name TEXT NOT NULL,
        value REAL NOT NULL,
        labels JSON,
        recorded_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS audit_logs (
        id TEXT PRIMARY KEY,
        event_type TEXT NOT NULL,
        task_id TEXT,
        session_id TEXT,
        actor_type TEXT NOT NULL,
        resource_type TEXT,
        resource_path TEXT,
        action TEXT,
        severity TEXT NOT NULL DEFAULT 'info',
        data JSON,
        created_at INTEGER NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status);
      CREATE INDEX IF NOT EXISTS idx_tasks_created_at ON tasks(created_at);
      CREATE INDEX IF NOT EXISTS idx_checkpoints_task_id ON task_checkpoints(task_id);
      CREATE INDEX IF NOT EXISTS idx_approvals_task_id ON approval_requests(task_id);
      CREATE INDEX IF NOT EXISTS idx_approvals_status ON approval_requests(status);
      CREATE INDEX IF NOT EXISTS idx_audit_logs_task_id ON audit_logs(task_id);
      CREATE INDEX IF NOT EXISTS idx_audit_logs_session_id ON audit_logs(session_id);
      CREATE INDEX IF NOT EXISTS idx_audit_logs_created_at ON audit_logs(created_at);
    `);
    database.exec("PRAGMA user_version = 2");
    currentVersion = 2;
    log.info("[DB] Schema migrated to v2 (harness tables)");
  }

  if (currentVersion === CURRENT_SCHEMA_VERSION) {
    log.info(`[DB] Schema up to date at v${CURRENT_SCHEMA_VERSION}`);
  }
}

export function initDatabase(): void {
  try {
    db = new Database(dbPath);
    // WAL 模式：提升并发读性能，减少写锁争用；NORMAL 同步级别在 WAL 下安全且更快
    db.pragma("journal_mode = WAL");
    db.pragma("synchronous = NORMAL");
    // 64MB 页缓存（负值 = KiB），减少重复读盘
    db.pragma("cache_size = -65536");
    // 临时表/排序使用内存而非磁盘
    db.pragma("temp_store = MEMORY");
    log.info("Database initialized at:", dbPath);
    runSchemaMigrations(db);
  } catch (error) {
    log.error("Database initialization failed:", error);
  }
}

export function getDb(): Database.Database | null {
  return db;
}

export function closeDb(): void {
  if (db) {
    db.close();
    db = null;
    log.info("[App] Database closed");
  }
}

export function readSetting(key: string): unknown {
  const row = db
    ?.prepare("SELECT value FROM settings WHERE key = ?")
    .get(key) as { value: string } | undefined;
  if (!row?.value) return null;
  try {
    return JSON.parse(row.value);
  } catch {
    return row.value;
  }
}

export function writeSetting(key: string, value: unknown): boolean {
  if (!db) return false;
  if (value === null || value === undefined) {
    db.prepare("DELETE FROM settings WHERE key = ?").run(key);
  } else {
    db.prepare(
      "INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)",
    ).run(key, JSON.stringify(value));
  }
  return true;
}

// ==================== 加密存储（T1.2）====================

/**
 * 写入加密 setting。
 * 使用 Electron safeStorage API（OS Keychain / DPAPI / SecretService）加密。
 * 若加密不可用，退回明文存储并记录警告。
 */
export function writeEncryptedSetting(key: string, value: string): boolean {
  if (!db) return false;
  let stored: string;
  if (safeStorage.isEncryptionAvailable()) {
    try {
      const encrypted = safeStorage.encryptString(value);
      stored = ENCRYPTED_PREFIX + encrypted.toString("hex");
    } catch (e) {
      log.warn(
        `[DB] safeStorage encrypt failed for key=${key}, storing plaintext:`,
        e,
      );
      stored = JSON.stringify(value);
    }
  } else {
    log.warn(
      `[DB] safeStorage not available, storing plaintext for key=${key}`,
    );
    stored = JSON.stringify(value);
  }
  db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)").run(
    key,
    stored,
  );
  return true;
}

/**
 * 读取加密 setting。
 * 自动识别加密前缀并解密；若无前缀则作为明文 JSON 返回。
 */
export function readEncryptedSetting(key: string): string | null {
  const row = db
    ?.prepare("SELECT value FROM settings WHERE key = ?")
    .get(key) as { value: string } | undefined;
  if (!row?.value) return null;
  if (row.value.startsWith(ENCRYPTED_PREFIX)) {
    if (!safeStorage.isEncryptionAvailable()) {
      log.error(`[DB] safeStorage not available, cannot decrypt key=${key}`);
      return null;
    }
    try {
      const hexStr = row.value.slice(ENCRYPTED_PREFIX.length);
      const buf = Buffer.from(hexStr, "hex");
      return safeStorage.decryptString(buf);
    } catch (e) {
      log.error(`[DB] safeStorage decrypt failed for key=${key}:`, e);
      return null;
    }
  }
  // 明文兼容路径
  try {
    return JSON.parse(row.value) as string;
  } catch {
    return row.value;
  }
}

/** 检查指定 key 是否为敏感 key（需要加密存储） */
export function isSensitiveKey(key: string): boolean {
  return (SENSITIVE_SETTING_KEYS as readonly string[]).includes(key);
}

// ==================== 合规配置（T1.1）====================

/** 读取合规配置，不存在时返回默认配置 */
export function readComplianceConfig(): ComplianceConfig {
  const stored = readSetting(COMPLIANCE_CONFIG_KEY);
  if (!stored || typeof stored !== "object")
    return { ...DEFAULT_COMPLIANCE_CONFIG };
  return {
    ...DEFAULT_COMPLIANCE_CONFIG,
    ...(stored as Partial<ComplianceConfig>),
  };
}

/** 写入合规配置 */
export function writeComplianceConfig(
  config: Partial<ComplianceConfig>,
): boolean {
  const current = readComplianceConfig();
  return writeSetting(COMPLIANCE_CONFIG_KEY, { ...current, ...config });
}
