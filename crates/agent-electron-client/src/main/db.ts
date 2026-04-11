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

export function initDatabase(): void {
  try {
    db = new Database(dbPath);
    log.info("Database initialized at:", dbPath);

    // Create tables
    db.exec(`
      CREATE TABLE IF NOT EXISTS settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );
    `);
    log.info("Database tables created");
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
