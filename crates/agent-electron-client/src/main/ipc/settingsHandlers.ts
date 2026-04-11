import { ipcMain } from "electron";
import {
  getDb,
  readSetting,
  writeSetting,
  readEncryptedSetting,
  writeEncryptedSetting,
  isSensitiveKey,
} from "../db";
import log from "electron-log";
import { readQuickInitConfig } from "../bootstrap/quickInit";

export function registerSettingsHandlers(): void {
  // Settings
  ipcMain.handle("settings:get", (_, key: string) => {
    if (!getDb()) return null;
    // 敏感 key 走加密读路径
    if (isSensitiveKey(key)) {
      return readEncryptedSetting(key);
    }
    return readSetting(key);
  });

  ipcMain.handle("settings:set", (_, key: string, value: unknown) => {
    if (!getDb()) return false;
    // 敏感 key 走加密写路径
    if (isSensitiveKey(key)) {
      if (value === null || value === undefined) {
        return writeSetting(key, null);
      }
      return writeEncryptedSetting(key, String(value));
    }
    return writeSetting(key, value);
  });

  // Mirror / Registry — 动态切换 npm、uv 镜像源
  ipcMain.handle("mirror:get", async () => {
    const { getMirrorConfig, MIRROR_PRESETS } =
      await import("../services/system/dependencies");
    return { success: true, ...getMirrorConfig(), presets: MIRROR_PRESETS };
  });

  ipcMain.handle(
    "mirror:set",
    async (_, config: { npmRegistry?: string; uvIndexUrl?: string }) => {
      const { setMirrorConfig, getMirrorConfig } =
        await import("../services/system/dependencies");
      try {
        setMirrorConfig(config);
        // 持久化到 SQLite
        const db = getDb();
        if (db) {
          const stmt = db.prepare(
            "INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)",
          );
          stmt.run("mirror_config", JSON.stringify(getMirrorConfig()));
        }
        return { success: true };
      } catch (error) {
        return { success: false, error: String(error) };
      }
    },
  );

  // Quick Init — 读取 ~/.nuwaclaw/nuwaclaw.json 快捷配置
  ipcMain.handle("quickInit:getConfig", () => {
    return readQuickInitConfig();
  });

  // T2.5: 代理配置 — 读取/写入用户手动代理设置
  ipcMain.handle("proxy:get", async () => {
    const { getProxyConfig } = await import("../services/system/dependencies");
    const db = getDb();
    // 先从 DB 恢复持久化配置
    if (db) {
      const row = db
        .prepare("SELECT value FROM settings WHERE key = 'proxy_config'")
        .get() as { value: string } | undefined;
      if (row?.value) {
        try {
          const { setProxyConfig } =
            await import("../services/system/dependencies");
          setProxyConfig(JSON.parse(row.value));
        } catch {
          /* ignore */
        }
      }
    }
    return { success: true, ...getProxyConfig() };
  });

  ipcMain.handle(
    "proxy:set",
    async (
      _,
      config: {
        httpsProxy?: string;
        httpProxy?: string;
        noProxy?: string;
      } | null,
    ) => {
      const { setProxyConfig } =
        await import("../services/system/dependencies");
      try {
        setProxyConfig(config);
        // 持久化到 SQLite
        const db = getDb();
        if (db) {
          if (!config || Object.keys(config).length === 0) {
            db.prepare("DELETE FROM settings WHERE key = 'proxy_config'").run();
          } else {
            db.prepare(
              "INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)",
            ).run("proxy_config", JSON.stringify(config));
          }
        }
        return { success: true };
      } catch (error) {
        return { success: false, error: String(error) };
      }
    },
  );
}
