/**
 * 数据目录迁移：旧目录 → ~/..<APP_NAME_IDENTIFIER>
 *
 * 必须在 initDatabase() 之前同步执行，确保 DB 从新路径打开。
 *
 * 两种场景：
 * 1. 新目录不存在 → 整体 rename 旧目录
 * 2. 新目录已存在但 DB 为空（依赖安装等先创建了目录）→ 从旧目录复制 DB
 *
 * 优先级：社区/既有 beta 数据（.nuwaclaw，仅商业版构建） > .nuwax-agent > .nuwaxbot
 * （找到第一个存在的旧目录即迁移）
 */

import * as fs from "fs";
import * as path from "path";
import { app } from "electron";
import log from "electron-log";
import Database from "better-sqlite3";
import { APP_NAME_IDENTIFIER, NUWAX_PORT_OFFSET } from "@shared/constants";
import { readSetting, writeSetting } from "../db";

interface LegacySource {
  dirName: string;
  dbName: string;
  configName: string | null;
}

// 商业版（identifier 已被构建期 env 覆盖，如 nuwawork）时，把既有 .nuwaclaw
// 纳入迁移链，让老 beta 用户数据一次性平移到新目录；社区版目标即 .nuwaclaw，
// 自身不能作为迁移来源（避免自我 rename）。
const LEGACY_SOURCES: LegacySource[] = [
  ...(APP_NAME_IDENTIFIER === "nuwaclaw"
    ? []
    : [
        {
          dirName: ".nuwaclaw",
          dbName: "nuwaclaw.db",
          configName: "nuwaclaw.json",
        },
      ]),
  { dirName: ".nuwax-agent", dbName: "nuwax-agent.db", configName: null },
  { dirName: ".nuwaxbot", dbName: "nuwaxbot.db", configName: "nuwaxbot.json" },
];

// 社区版默认端口（历史固定值）：商业版迁移 quickInit 配置时，恰好等于这些
// 默认值的端口改写为「默认 + NUWAX_PORT_OFFSET」，避免与同机社区版/nuwa-cli 撞端口；
// 用户自定义端口不动。
const LEGACY_DEFAULT_QUICKINIT_PORTS: Record<string, number> = {
  agentPort: 60006,
  fileServerPort: 60005,
  ttydPort: 60009,
};

/**
 * 商业版迁移配套：改写 quickInit 配置里的旧默认端口（兼容顶层与 quickInit scope 两种形态）。
 * 仅在端口偏移生效（商业构建）时执行；任何失败只告警不阻断迁移。
 */
function migrateLegacyQuickInitPorts(configPath: string): void {
  if (NUWAX_PORT_OFFSET === 0 || APP_NAME_IDENTIFIER === "nuwaclaw") return;
  try {
    if (!fs.existsSync(configPath)) return;
    const raw = JSON.parse(fs.readFileSync(configPath, "utf-8")) as Record<
      string,
      unknown
    >;
    const scopes = [raw, raw?.quickInit].filter(
      (s): s is Record<string, unknown> => !!s && typeof s === "object",
    );
    let changed = false;
    for (const scope of scopes) {
      for (const [key, legacyPort] of Object.entries(
        LEGACY_DEFAULT_QUICKINIT_PORTS,
      )) {
        if (scope[key] === legacyPort) {
          scope[key] = legacyPort + NUWAX_PORT_OFFSET;
          changed = true;
        }
      }
    }
    if (changed) {
      fs.writeFileSync(configPath, JSON.stringify(raw, null, 2), "utf-8");
      log.info(
        `[Migrate] Shifted legacy default quickInit ports (+${NUWAX_PORT_OFFSET}): ${path.basename(configPath)}`,
      );
    }
  } catch (e) {
    log.warn("[Migrate] Failed to shift legacy quickInit ports:", e);
  }
}

/**
 * 检查 DB 文件是否包含有效的 settings 数据
 */
function isDbEmpty(dbPath: string): boolean {
  if (!fs.existsSync(dbPath)) return true;
  try {
    const db = new Database(dbPath, { readonly: true });
    const row = db.prepare("SELECT COUNT(*) as count FROM settings").get() as {
      count: number;
    };
    db.close();
    return row.count === 0;
  } catch {
    return true;
  }
}

/**
 * 复制 DB 文件（主文件 + WAL/SHM）
 */
function copyDbFiles(oldDb: string, newDb: string): void {
  fs.copyFileSync(oldDb, newDb);
  for (const suffix of ["-wal", "-shm"]) {
    const oldAux = oldDb + suffix;
    const newAux = newDb + suffix;
    if (fs.existsSync(oldAux)) {
      fs.copyFileSync(oldAux, newAux);
    }
  }
}

/**
 * 重命名 DB 文件（主文件 + WAL/SHM）
 */
function renameDbFiles(oldDb: string, newDb: string): void {
  fs.renameSync(oldDb, newDb);
  for (const suffix of ["-wal", "-shm"]) {
    const oldAux = oldDb + suffix;
    const newAux = newDb + suffix;
    if (fs.existsSync(oldAux)) {
      fs.renameSync(oldAux, newAux);
    }
  }
}

export function migrateDataDir(): void {
  const home = app.getPath("home");
  const newDir = path.join(home, `.${APP_NAME_IDENTIFIER}`);
  const newDbName = `${APP_NAME_IDENTIFIER}.db`;
  const newDb = path.join(newDir, newDbName);

  if (fs.existsSync(newDir)) {
    // 新目录已存在 — 若 DB 为空，仍需从旧目录导入数据
    if (!isDbEmpty(newDb)) {
      return; // DB 有数据，无需迁移
    }
    log.info(
      "[Migrate] New dir exists but DB is empty, importing from legacy DB...",
    );
    importLegacyDb(home, newDb);
    return;
  }

  // 新目录不存在 → 整体 rename 旧目录
  for (const source of LEGACY_SOURCES) {
    const oldDir = path.join(home, source.dirName);
    if (!fs.existsSync(oldDir)) {
      continue;
    }

    log.info(
      `[Migrate] Found legacy data dir: ${oldDir}, renaming → ${newDir}`,
    );
    try {
      fs.renameSync(oldDir, newDir);
    } catch (e) {
      log.error("[Migrate] Failed to rename data directory:", e);
      return;
    }

    // 重命名 DB 文件
    const oldDb = path.join(newDir, source.dbName);
    if (fs.existsSync(oldDb) && !fs.existsSync(newDb)) {
      try {
        renameDbFiles(oldDb, newDb);
        log.info(`[Migrate] Renamed DB: ${source.dbName} → ${newDbName}`);
      } catch (e) {
        log.error("[Migrate] Failed to rename database file:", e);
      }
    }

    // 重命名 config 文件（如果存在）
    if (source.configName) {
      const newConfigName = `${APP_NAME_IDENTIFIER}.json`;
      const oldConfig = path.join(newDir, source.configName);
      const newConfig = path.join(newDir, newConfigName);
      if (fs.existsSync(oldConfig) && !fs.existsSync(newConfig)) {
        try {
          fs.renameSync(oldConfig, newConfig);
          log.info(
            `[Migrate] Renamed config: ${source.configName} → ${newConfigName}`,
          );
          migrateLegacyQuickInitPorts(newConfig);
        } catch (e) {
          log.error("[Migrate] Failed to rename config file:", e);
        }
      }
    }

    log.info("[Migrate] Data directory migration completed");
    return; // 只迁移第一个找到的旧目录
  }
}

/**
 * 新目录已存在但 DB 为空时，从旧目录复制 DB 文件
 */
function importLegacyDb(home: string, newDb: string): void {
  for (const source of LEGACY_SOURCES) {
    const oldDir = path.join(home, source.dirName);
    const oldDb = path.join(oldDir, source.dbName);
    if (!fs.existsSync(oldDb) || isDbEmpty(oldDb)) {
      continue;
    }

    try {
      copyDbFiles(oldDb, newDb);
      log.info(`[Migrate] Imported legacy DB: ${oldDb} → ${newDb}`);
    } catch (e) {
      log.error("[Migrate] Failed to import legacy DB:", e);
    }
    return; // 只导入第一个有效的旧 DB
  }
}

/**
 * 修补 DB 中 step1_config.workspaceDir 的旧路径引用
 *
 * 当用户手动选择的工作空间目录包含旧数据目录前缀时，替换为新前缀。
 * 必须在 initDatabase() 之后调用。
 */
export function migrateSettingsPaths(): void {
  const home = app.getPath("home");
  const newPrefix = path.join(home, `.${APP_NAME_IDENTIFIER}`);
  const LEGACY_DIR_NAMES = [
    ...(APP_NAME_IDENTIFIER === "nuwaclaw" ? [] : [".nuwaclaw"]),
    ".nuwax-agent",
    ".nuwaxbot",
  ];

  const step1Config = readSetting("step1_config") as Record<
    string,
    unknown
  > | null;
  if (!step1Config || typeof step1Config.workspaceDir !== "string") return;

  for (const legacyName of LEGACY_DIR_NAMES) {
    const oldPrefix = path.join(home, legacyName);
    if (step1Config.workspaceDir.startsWith(oldPrefix)) {
      step1Config.workspaceDir =
        newPrefix + step1Config.workspaceDir.slice(oldPrefix.length);
      writeSetting("step1_config", step1Config);
      log.info(
        `[Migrate] Updated step1_config.workspaceDir → ${step1Config.workspaceDir}`,
      );
      return;
    }
  }
}
