import { ipcMain } from "electron";
import * as fs from "fs";
import * as os from "os";
import log from "electron-log";
import { z } from "zod";
import type { HandlerContext } from "@shared/types/ipc";
import { createServiceManager } from "../window/serviceManager";
import { checkLanproxyHealth } from "../services/packages/lanproxyHealth";
import { mcpProxyManager } from "../services/packages/mcp";

// T2.6 — 服务健康定时推送（30s）
let _healthTimer: ReturnType<typeof setInterval> | null = null;

// ==================== CPU 采样 ====================

interface CpuSample {
  idle: number;
  total: number;
}

function getCpuSample(): CpuSample {
  let idle = 0;
  let total = 0;
  for (const cpu of os.cpus()) {
    const times = cpu.times;
    idle += times.idle;
    total += times.idle + times.user + times.nice + times.sys + times.irq;
  }
  return { idle, total };
}

let _prevCpuSample: CpuSample = getCpuSample();

/**
 * 返回自上次调用以来的 CPU 使用率（0–100）。
 * 首次调用返回 0（没有前一个采样点）。
 */
function sampleCpuPct(): number {
  const next = getCpuSample();
  const idleDelta = next.idle - _prevCpuSample.idle;
  const totalDelta = next.total - _prevCpuSample.total;
  _prevCpuSample = next;
  if (totalDelta === 0) return 0;
  return Math.round(((totalDelta - idleDelta) / totalDelta) * 100);
}

/** 返回当前系统内存快照（MB） */
function getMemSnapshot(): { memUsedMB: number; memTotalMB: number } {
  const total = os.totalmem();
  const free = os.freemem();
  return {
    memUsedMB: Math.round((total - free) / 1024 / 1024),
    memTotalMB: Math.round(total / 1024 / 1024),
  };
}

export function stopHealthMonitor(): void {
  if (_healthTimer) {
    clearInterval(_healthTimer);
    _healthTimer = null;
  }
}

export const lanproxyConfigSchema = z.object({
  serverIp: z.string().min(1),
  serverPort: z.number().int().positive(),
  clientKey: z.string().min(1),
  ssl: z.boolean().optional(),
});

export const agentRunnerConfigSchema = z.object({
  binPath: z.string().min(1),
  backendPort: z.number().int().positive(),
  proxyPort: z.number().int().positive(),
  apiKey: z.string().min(1),
  apiBaseUrl: z.string().min(1),
  defaultModel: z.string().min(1),
});

export const portSchema = z.number().int().positive();

function invalidArgs(channel: string, issues: unknown) {
  log.warn(`[IPC] ${channel} invalid args:`, issues);
  return { success: false, error: `Invalid arguments for ${channel}` };
}

/** 模块级 _serviceManager，供其他模块（如 computerServer）访问 */
let _serviceManager: ReturnType<typeof createServiceManager> | null = null;

/** 获取 _serviceManager 实例（需先调用 registerProcessHandlers） */
export function getServiceManager(): ReturnType<
  typeof createServiceManager
> | null {
  return _serviceManager;
}

export function registerProcessHandlers(ctx: HandlerContext): void {
  _serviceManager = createServiceManager({
    lanproxy: ctx.lanproxy,
    fileServer: ctx.fileServer,
    agentRunner: ctx.agentRunner,
  });

  // 本地别名，确保 TypeScript 知道它已被赋值
  const sm = _serviceManager;

  // ==================== Helper: Start File Server ====================
  const startFileServerProcess = async (
    port: number,
  ): Promise<{ success: boolean; error?: string }> => {
    return sm.startFileServer(port);
  };

  // ==================== Helper: Start Lanproxy ====================
  const startLanproxyProcess = async (config: {
    serverIp: string;
    serverPort: number;
    clientKey: string;
    ssl?: boolean;
  }): Promise<{
    success: boolean;
    error?: string;
    healthCheck?: { healthy: boolean; error?: string };
  }> => {
    if (ctx.lanproxy.running) {
      // 切换账号后 clientKey 会变化，必须用新配置重启，不能跳过。
      // 否则旧进程继续使用旧 clientKey 导致「本地显示已联通、会话显示离线」。
      log.info(
        "[Lanproxy] Already running, stopping first before restarting with new config",
      );
      await ctx.lanproxy.stopAsync();
    }
    const useSsl = config.ssl !== false;
    const maskedKey =
      config.clientKey.length > 8
        ? `${config.clientKey.slice(0, 4)}****${config.clientKey.slice(-4)}`
        : "****";
    log.info("[Lanproxy] Starting", {
      server: config.serverIp,
      port: config.serverPort,
      keyMasked: maskedKey,
      ssl: useSsl,
    });
    const result = await sm.startLanproxy(config);
    if (result.success) {
      log.info("[Lanproxy] Started", {
        server: config.serverIp,
        port: config.serverPort,
      });
      // 远端 health 接口可选（私有化部署可能未提供）；异步探测仅打日志，不阻塞 IPC、不影响启动结果
      void checkLanproxyHealth(config.clientKey)
        .then((health) => {
          result.healthCheck = health;
          if (!health.healthy) {
            log.warn(
              "[Lanproxy] Post-start health probe failed (non-fatal; private backends may omit /api/sandbox/config/health):",
              health.error,
            );
          } else {
            log.info("[Lanproxy] Post-start health probe OK");
          }
        })
        .catch((e) => {
          log.warn("[Lanproxy] Post-start health probe error (non-fatal):", e);
        });
    } else {
      log.error("[Lanproxy] Start failed", {
        error: result.error,
        server: config.serverIp,
        port: config.serverPort,
      });
    }
    return result;
  };

  // Lanproxy handlers
  ipcMain.handle(
    "lanproxy:start",
    async (
      _,
      config: {
        serverIp: string;
        serverPort: number;
        clientKey: string;
        ssl?: boolean;
      },
    ) => {
      const parsed = lanproxyConfigSchema.safeParse(config);
      if (!parsed.success) {
        return invalidArgs("lanproxy:start", parsed.error.issues);
      }
      return startLanproxyProcess(parsed.data);
    },
  );

  ipcMain.handle("lanproxy:stop", async () => {
    return ctx.lanproxy.stop();
  });

  ipcMain.handle("lanproxy:status", () => {
    return ctx.lanproxy.status();
  });

  /** 供设置页判断是否可显示「启动」并提示不可用原因 */
  ipcMain.handle("lanproxy:isAvailable", async () => {
    const { getLanproxyBinPath } =
      await import("../services/system/dependencies");
    const binPath = getLanproxyBinPath();
    return { available: fs.existsSync(binPath) };
  });

  // Agent Runner handlers
  ipcMain.handle(
    "agentRunner:start",
    async (
      _,
      config: {
        binPath: string;
        backendPort: number;
        proxyPort: number;
        apiKey: string;
        apiBaseUrl: string;
        defaultModel: string;
      },
    ) => {
      const parsed = agentRunnerConfigSchema.safeParse(config);
      if (!parsed.success) {
        return invalidArgs("agentRunner:start", parsed.error.issues);
      }
      const cfg = parsed.data;
      const { getAppEnv } = await import("../services/system/dependencies");

      if (ctx.agentRunner.running) {
        return { success: true, message: "Already running" };
      }

      const args = [
        "--backend-port",
        String(cfg.backendPort),
        "--proxy-port",
        String(cfg.proxyPort),
        "--api-key",
        cfg.apiKey,
        "--api-base-url",
        cfg.apiBaseUrl,
        "--default-model",
        cfg.defaultModel,
      ];

      // 仅记录端口与 URL，不记录 apiKey，避免敏感信息写入日志
      log.info(
        "Starting agent runner:",
        cfg.binPath,
        "--backend-port",
        cfg.backendPort,
        "--proxy-port",
        cfg.proxyPort,
        "--api-base-url",
        cfg.apiBaseUrl,
      );

      const result = await ctx.agentRunner.start({
        command: cfg.binPath,
        args,
        shell: true,
        env: getAppEnv(),
        startupDelayMs: 2000,
      });

      if (result.success) {
        ctx.setAgentRunnerPorts({
          backendPort: cfg.backendPort,
          proxyPort: cfg.proxyPort,
        });
      }
      return result;
    },
  );

  ipcMain.handle("agentRunner:stop", async () => {
    const result = ctx.agentRunner.stop();
    ctx.setAgentRunnerPorts(null);
    return result;
  });

  ipcMain.handle("agentRunner:status", () => {
    const st = ctx.agentRunner.status();
    return {
      ...st,
      backendUrl: ctx.agentRunnerPorts
        ? `http://127.0.0.1:${ctx.agentRunnerPorts.backendPort}`
        : undefined,
      proxyUrl: ctx.agentRunnerPorts
        ? `http://127.0.0.1:${ctx.agentRunnerPorts.proxyPort}`
        : undefined,
    };
  });

  // File Server handlers
  ipcMain.handle("fileServer:start", async (_, port: number = 60000) => {
    const parsed = portSchema.safeParse(port);
    if (!parsed.success) {
      return invalidArgs("fileServer:start", parsed.error.issues);
    }
    return startFileServerProcess(parsed.data);
  });

  ipcMain.handle("fileServer:stop", async () => {
    return ctx.fileServer.stop();
  });

  ipcMain.handle("fileServer:status", () => {
    return ctx.fileServer.status();
  });

  // Computer Server handlers (Agent HTTP 接口服务，对齐 rcoder /computer/* API)
  ipcMain.handle("computerServer:status", async () => {
    const { getComputerServerStatus } =
      await import("../services/computerServer");
    return getComputerServerStatus();
  });

  ipcMain.handle("computerServer:start", async (_, port?: number) => {
    const { startComputerServer } = await import("../services/computerServer");
    const { getConfiguredPorts } = await import("../services/startupPorts");
    const resolvedPortRaw = port ?? getConfiguredPorts().agent;
    const parsed = portSchema.safeParse(resolvedPortRaw);
    if (!parsed.success) {
      return invalidArgs("computerServer:start", parsed.error.issues);
    }
    const resolvedPort = parsed.data;
    return startComputerServer(resolvedPort);
  });

  ipcMain.handle("computerServer:stop", async () => {
    const { stopComputerServer } = await import("../services/computerServer");
    await stopComputerServer();
    return { success: true };
  });

  // Admin Server handlers (管理接口服务)
  // Admin Server 已合并到 Computer Server (60006)，不再有独立的 60007 端口
  // start/stop 为空操作（Computer Server 通过 services:restartAll 管理）
  ipcMain.handle("adminServer:start", async () => {
    return { success: true };
  });

  ipcMain.handle("adminServer:stop", async () => {
    return { success: true };
  });

  // adminServer:status 现在返回 Computer Server 状态
  ipcMain.handle("adminServer:status", async () => {
    const { getComputerServerStatus } =
      await import("../services/computerServer");
    return getComputerServerStatus();
  });

  // ==================== services:restartAll ====================

  ipcMain.handle("services:restartAll", async () => {
    log.info("[Services] Restarting all services...");
    try {
      const { stopComputerServer } = await import("../services/computerServer");
      await stopComputerServer();
    } catch (e) {
      log.warn("[Services] ComputerServer stop error (ignored):", e);
    }
    const base = await sm.restartAllServices();
    const results: Record<string, { success: boolean; error?: string }> = {
      ...base.results,
    };

    // 补充 processHandlers 特有步骤：Computer Server
    try {
      const { startComputerServer } =
        await import("../services/computerServer");
      const { getConfiguredPorts } = await import("../services/startupPorts");
      const { agent: agentPort } = getConfiguredPorts();
      results.computerServer = await startComputerServer(agentPort);
      log.info("[Services] ComputerServer started:", results.computerServer);
    } catch (e) {
      results.computerServer = { success: false, error: String(e) };
      log.error("[Services] ComputerServer start failed:", e);
    }

    log.info("[Services] All services restart complete:", results);
    return { success: true, results };
  });

  // ==================== services:stopAll ====================

  ipcMain.handle("services:stopAll", async () => {
    log.info("[Services] Stopping all services...");
    const base = await sm.stopAllServices();
    const results: Record<string, { success: boolean; error?: string }> = {
      ...base.results,
    };

    // 补充 processHandlers 特有步骤：Computer Server
    try {
      const { stopComputerServer } = await import("../services/computerServer");
      await stopComputerServer();
      results.computerServer = { success: true };
      log.info("[Services] ComputerServer stopped");
    } catch (e) {
      results.computerServer = { success: false, error: String(e) };
      log.error("[Services] ComputerServer stop failed:", e);
    }

    log.info("[Services] All services stopped:", results);
    return { success: true, results };
  });

  // ==================== services:restartAllExceptLanproxy ====================

  ipcMain.handle("services:restartAllExceptLanproxy", async () => {
    log.info("[Services] Restarting all services except lanproxy...");
    const base = await sm.restartAllServicesExceptLanproxy();
    const results: Record<string, { success: boolean; error?: string }> = {
      ...base.results,
    };

    // 补充 processHandlers 特有步骤：Computer Server
    try {
      const { startComputerServer } =
        await import("../services/computerServer");
      const { getConfiguredPorts } = await import("../services/startupPorts");
      const { agent: agentPort } = getConfiguredPorts();
      results.computerServer = await startComputerServer(agentPort);
      log.info("[Services] ComputerServer started:", results.computerServer);
    } catch (e) {
      results.computerServer = { success: false, error: String(e) };
      log.error("[Services] ComputerServer start failed:", e);
    }

    log.info(
      "[Services] All services (except lanproxy) restart complete:",
      results,
    );
    return { success: true, results };
  });

  // ==================== T2.6 — 服务健康主动推送 ====================

  /**
   * 采集当前服务健康快照并推送给 renderer。
   * 包含：lanproxy、fileServer、mcpProxy 三个服务的运行状态。
   */
  async function pushServiceHealth(): Promise<void> {
    const win = ctx.getMainWindow();
    if (!win || win.isDestroyed()) return;
    try {
      const snapshot = {
        timestamp: Date.now(),
        lanproxy: ctx.lanproxy.status(),
        fileServer: ctx.fileServer.status(),
        mcpProxy: mcpProxyManager.getStatus(),
        systemResources: {
          cpuPct: sampleCpuPct(),
          ...getMemSnapshot(),
        },
      };
      win.webContents.send("service:health", snapshot);
    } catch (e) {
      log.debug("[ServiceHealth] Failed to push health snapshot:", e);
    }
  }

  // 立即推送一次，然后每 30s 推送一次
  void pushServiceHealth();
  stopHealthMonitor(); // 防止重复注册
  _healthTimer = setInterval(() => void pushServiceHealth(), 30_000);

  // 同时暴露一个可手动触发的 IPC（ClientPage 刷新时调用）
  ipcMain.handle("services:healthSnapshot", async () => {
    const snapshot = {
      timestamp: Date.now(),
      lanproxy: ctx.lanproxy.status(),
      fileServer: ctx.fileServer.status(),
      mcpProxy: mcpProxyManager.getStatus(),
      systemResources: {
        cpuPct: sampleCpuPct(),
        ...getMemSnapshot(),
      },
    };
    return snapshot;
  });

  // ==================== services:lifecycleStats ====================
  // 返回所有托管服务的生命周期诊断数据（重启次数、崩溃时间、运行时长等）

  ipcMain.handle("services:lifecycleStats", () => {
    const {
      processLifecycleManager,
    } = require("../services/utils/processLifecycle");
    return {
      success: true as const,
      stats: processLifecycleManager.getStats(),
    };
  });
}
