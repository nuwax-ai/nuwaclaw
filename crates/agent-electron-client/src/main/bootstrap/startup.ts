import log from "electron-log";
import { app, BrowserWindow } from "electron";
import { getDb, readSetting } from "../db";
import { startComputerServer } from "../services/computerServer";
import {
  mcpProxyManager,
  DEFAULT_MCP_PROXY_CONFIG,
} from "../services/packages/mcp";
import { getConfiguredPorts } from "../services/startupPorts";
import { DEPS_SYNC_TIMEOUT } from "@shared/constants";
import {
  startSandboxService,
  stopSandboxService,
} from "../services/sandbox/serviceBootstrap";

/** 依赖同步是否正在进行 */
let _depsSyncInProgress = false;
export function isDepsSyncInProgress(): boolean {
  return _depsSyncInProgress;
}

export async function runStartupTasks(): Promise<void> {
  // 从 SQLite 恢复镜像配置
  const {
    setMirrorConfig,
    getInitDepsState,
    syncInitDependencies,
    getSetupRequiredDependencies,
  } = await import("../services/system/dependencies");
  const mirrorConfig = readSetting("mirror_config");
  if (mirrorConfig) {
    try {
      setMirrorConfig(mirrorConfig);
    } catch (e) {
      log.warn("[Mirror] Failed to apply mirror config:", e);
    }
  }

  // 尽早启动 Computer HTTP Server（对齐 rcoder /computer/* API），端口来自聚合配置
  {
    const { agent: agentPort } = getConfiguredPorts();
    startComputerServer(agentPort).then((r) => {
      if (r.success)
        log.info(`[Init] Computer HTTP server listening on port ${agentPort}`);
      else log.warn(`[Init] Computer HTTP server failed: ${r.error}`);
    });
  }

  // 启动诊断：打印 .env 加载的关键调试变量，验证 dotenv 链路是否通
  {
    const debugEnvs = [
      "NUWAX_LOOPBACK",
      "NUWAX_LOOPBACK_DIST",
      "NUWAX_LOOPBACK_TARGET",
      "NUWAX_WEBVIEW_ORIGIN",
      "NUWACLAW_FORCE_ENGINE",
      "INJECT_GUI_MCP",
      "NODE_ENV",
    ];
    const loaded = Object.fromEntries(
      debugEnvs.map((k) => [k, process.env[k] ?? null]),
    );
    log.info("[Init] Dev env vars:", JSON.stringify(loaded));
  }

  // Loopback Gateway（阶段一默认 direct——不启用时仅清运行时键后静默返回；
  // step1_config.nuwaxLoadMode='gateway' 或 env NUWAX_LOOPBACK=1 启用）。
  // best-effort：失败不阻断启动（direct 形态始终可用）。
  {
    const { ensureLoopbackGateway, syncWebviewOverrideFromEnv } =
      await import("../services/loopbackGateway");
    // 调试覆盖前端域名（env → 运行时键，renderer 读）先于 webview 首次解析
    syncWebviewOverrideFromEnv();
    await ensureLoopbackGateway().then((handle) => {
      if (handle)
        log.info(
          `[Init] Loopback gateway listening on ${handle.origin} (nuwax via loopback)`,
        );
    });
  }

  // 启动 ttyd Web 终端服务（仅回环监听）。
  // serviceManager 已在 registerAllHandlers → registerProcessHandlers 中创建，
  // 通过 getServiceManager() 复用其 startTtyd（含端口清理与 binary 缺失降级）。
  setImmediate(async () => {
    try {
      const { getServiceManager } = await import("../ipc/processHandlers");
      const sm = getServiceManager();
      if (!sm) {
        log.warn("[Init] ttyd start skipped: serviceManager not ready");
        return;
      }
      const r = await sm.startTtyd();
      if (r.success) log.info("[Init] ttyd terminal service started");
      else log.warn(`[Init] ttyd terminal service not started: ${r.error}`);
    } catch (e) {
      log.warn("[Init] ttyd start failed (non-fatal):", e);
    }
  });

  // 初始化 MCP Proxy 配置（从数据库加载）
  try {
    const db = getDb();
    const savedConfig = db
      ?.prepare("SELECT value FROM settings WHERE key = ?")
      .get("mcp_proxy_config") as { value: string } | undefined;
    if (savedConfig) {
      try {
        const parsed = JSON.parse(savedConfig.value);
        // 合并默认服务器（如 chrome-devtools），确保内置 MCP 服务始终存在
        const merged = {
          ...parsed,
          mcpServers: {
            ...DEFAULT_MCP_PROXY_CONFIG.mcpServers,
            ...(parsed.mcpServers || {}),
          },
        };
        mcpProxyManager.setConfig(merged);
      } catch (e) {
        log.warn("[McpProxy] Init config parse failed:", e);
      }
    }
    log.info("[McpProxy] Config loaded");
  } catch (e) {
    log.warn("[McpProxy] Init config failed:", e);
  }

  // 初始化沙箱服务（后台启动，不阻塞主流程）
  setImmediate(async () => {
    try {
      await startSandboxService();
      log.info("[Sandbox] Sandbox service started");
    } catch (e) {
      log.warn("[Sandbox] Sandbox service start failed (non-fatal):", e);
      // 沙箱服务失败不阻塞应用，只是功能降级
    }
  });

  // 客户端升级后：若 appVersion 或 installVersion 变化，后台同步初始化依赖到写死版本
  // 同步检查是否需要 dep sync，提前设置标志，避免 renderer 在 setImmediate 之前
  // 读到 syncInProgress=false 而过早启动服务（竞态条件）
  const state = getInitDepsState();
  const currentVersion = app.getVersion();
  const versionChanged = !state || state.appVersion !== currentVersion;
  let packagesChanged = false;
  if (state?.packages) {
    for (const dep of getSetupRequiredDependencies()) {
      if (!dep.installVersion) continue;
      if (state.packages[dep.name] !== dep.installVersion) {
        packagesChanged = true;
        break;
      }
    }
  } else {
    packagesChanged = true;
  }
  const needsSync = versionChanged || packagesChanged;
  if (needsSync) {
    _depsSyncInProgress = true;
  }

  setImmediate(async () => {
    if (!needsSync) return;
    try {
      try {
        let syncTimer: ReturnType<typeof setTimeout>;
        const { updated } = await Promise.race([
          syncInitDependencies(),
          new Promise<never>((_, reject) => {
            syncTimer = setTimeout(
              () =>
                reject(
                  new Error(
                    `Dependency sync timeout after ${DEPS_SYNC_TIMEOUT}ms`,
                  ),
                ),
              DEPS_SYNC_TIMEOUT,
            );
          }),
        ]).finally(() => clearTimeout(syncTimer!));
        if (updated.length > 0)
          log.info("[Init] Init dependencies synced:", updated);
      } finally {
        _depsSyncInProgress = false;
        // 通知所有渲染进程依赖同步完成，重新检测
        for (const win of BrowserWindow.getAllWindows()) {
          if (!win.isDestroyed()) {
            win.webContents.send("deps:syncCompleted");
          }
        }
      }
    } catch (e) {
      _depsSyncInProgress = false;
      // 同步失败也通知渲染进程重新检测实际状态
      for (const win of BrowserWindow.getAllWindows()) {
        if (!win.isDestroyed()) {
          win.webContents.send("deps:syncCompleted");
        }
      }
      log.warn("[Init] Init dependencies sync failed:", e);
    }
  });
}
