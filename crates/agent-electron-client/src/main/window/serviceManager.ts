/**
 * 服务管理器 - 统一的服务启停逻辑
 *
 * 供 IPC handlers 和 Tray 菜单共同使用
 */

import * as path from "path";
import * as fs from "fs";
import { execSync } from "child_process";
import { app } from "electron";
import log from "electron-log";
import { withStartRetry } from "@nuwax-ai/agent-kit";
import { createFileServerPerfHandler } from "../ipc/perfHandlers";
import type { ManagedProcess } from "../processManager";
import { readSetting } from "../db";
import { t } from "../services/i18n";
import { probeLanproxyAfterStart } from "../services/packages/lanproxyHealth";
import { waitForFileServerHealth } from "../services/packages/fileServerHealth";
import {
  APP_DATA_DIR_NAME,
  DEFAULT_STARTUP_DELAY,
  FILE_SERVER_HEALTH_TIMEOUT_MS,
  normalizeAgentEngine,
  normalizeOptionalPort,
} from "../services/constants";
import { getConfiguredPorts } from "../services/startupPorts";
import {
  getAppEnv,
  getLanproxyBinPath,
  getTtydBinPath,
  getNuwaxFileServerBundledDir,
  getBundledGitBashPath,
} from "../services/system/dependencies";
import { getBundledGitBinDir } from "../services/system/binaryLocator";
import * as ttydHelper from "../services/packages/ttydHelper";
import { agentService } from "../services/engines/unifiedAgent";
import type { AgentConfig } from "../services/engines/unifiedAgent";
import { mcpProxyManager } from "../services/packages/mcp";
import { FEATURES } from "@shared/featureFlags";
import {
  startGuiAgentServer,
  stopGuiAgentServer,
} from "../services/packages/guiAgentServer";
import {
  allocateInternalTtydPort,
  checkTtydGatewayHealth,
  getTtydGatewayStatus,
  startTtydGateway,
  stopTtydGateway,
} from "../services/packages/ttydGateway";
import {
  startWindowsMcp,
  stopWindowsMcp,
} from "../services/packages/windowsMcp";
import { stopAllEngines } from "../services/engines/engineManager";
import { clearAllSseEventBuffers } from "../services/computerServer";
import { killProcessTreesListeningOnTcpPort } from "../services/utils/processTree";
import { shouldStartGuiMcpServices } from "../services/packages/guiMcpLocalConfig";
import { isWindows } from "../services/system/shellEnv";

/** 注入 electron-log，供 agent-kit withStartRetry 打英文启动重试日志 */
const startRetryLogger = {
  info: (...args: unknown[]) => {
    log.info(...args);
  },
  warn: (...args: unknown[]) => {
    log.warn(...args);
  },
};

export interface ServiceManagerContext {
  lanproxy: ManagedProcess;
  fileServer: ManagedProcess;
  agentRunner: ManagedProcess;
  ttyd: ManagedProcess;
}

export interface ServiceResult {
  success: boolean;
  error?: string;
  message?: string;
  healthCheck?: {
    healthy: boolean;
    error?: string;
  };
}

async function waitForTtydGatewayHealth(
  port: number,
): Promise<{ healthy: boolean; error?: string }> {
  let lastError: string | undefined;
  for (let attempt = 1; attempt <= 10; attempt++) {
    const health = await checkTtydGatewayHealth({ port, timeoutMs: 1000 });
    if (health.healthy) return health;
    lastError = health.error;
    log.warn(
      `[ServiceManager] ttyd WebSocket health check failed (attempt ${attempt}/10): ${health.error}`,
    );
    if (attempt < 10) {
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
  }
  return { healthy: false, error: lastError };
}

/**
 * 创建服务管理器
 */
export function createServiceManager(ctx: ServiceManagerContext) {
  /**
   * 单次启动文件服务器（不含外层重试）。
   * 健康失败会 stop 进程，避免下次命中「Already running」假成功。
   */
  const startFileServerOnce = async (port: number): Promise<ServiceResult> => {
    // 重试前可能残留 running 标记；先清掉再 spawn
    if (ctx.fileServer.running) {
      try {
        await ctx.fileServer.stopAsync(3000);
      } catch (e) {
        log.warn("[ServiceManager] FileServer stop before start attempt:", e);
      }
    }

    try {
      log.info(`[ServiceManager] Pre-start FileServer port sweep for ${port}`);
      await killProcessTreesListeningOnTcpPort(port);
    } catch (e) {
      log.warn("[ServiceManager] FileServer pre-start port sweep failed:", e);
    }

    const appDataDir = path.join(app.getPath("home"), APP_DATA_DIR_NAME);
    // 优先使用应用内集成的 bundled 路径，回退到 node_modules
    const bundledDir = getNuwaxFileServerBundledDir();
    const serverJsPath = bundledDir
      ? path.join(bundledDir, "dist", "server.js")
      : path.join(
          appDataDir,
          "node_modules",
          "nuwax-file-server",
          "dist",
          "server.js",
        );
    const step1Parsed = readSetting("step1_config") as {
      workspaceDir?: string;
    } | null;
    const baseWorkspace =
      step1Parsed?.workspaceDir || path.join(appDataDir, "workspace");
    const logsDir = path.join(appDataDir, "logs");

    const dirConfig: Record<string, string> = {
      INIT_PROJECT_NAME: "nuwax-template",
      INIT_PROJECT_DIR: path.join(baseWorkspace, "project_init"),
      UPLOAD_PROJECT_DIR: path.join(baseWorkspace, "project_zips"),
      PROJECT_SOURCE_DIR: path.join(baseWorkspace, "project_workspace"),
      DIST_TARGET_DIR: path.join(baseWorkspace, "project_nginx"),
      COMPUTER_WORKSPACE_DIR: path.join(
        baseWorkspace,
        "computer-project-workspace",
      ),
      LOG_BASE_DIR: path.join(logsDir, "project_logs"),
      COMPUTER_LOG_DIR: path.join(logsDir, "computer_logs"),
    };

    for (const dir of Object.values(dirConfig)) {
      if (dir && dir.includes(path.sep)) {
        try {
          fs.mkdirSync(dir, { recursive: true });
        } catch {
          /* ignore */
        }
      }
    }

    // 获取 Git 和 Git Bash 路径
    const gitBinDir = getBundledGitBinDir();
    const gitBashPath = getBundledGitBashPath();
    let gitPath = gitBinDir
      ? path.join(gitBinDir, isWindows() ? "git.exe" : "git")
      : "";

    // 如果没有 bundled git，尝试查找系统 git
    if (!gitPath) {
      try {
        const whichGit = isWindows() ? "where git" : "which git";
        const result = execSync(whichGit, {
          encoding: "utf-8",
          timeout: 5000,
        }).trim();
        const firstLine = result.split("\n")[0].trim();
        if (firstLine) {
          gitPath = firstLine;
          log.info(`[ServiceManager] Using system git: ${gitPath}`);
        }
      } catch {
        // git not found in system PATH
      }
    }

    log.info("[ServiceManager] Git environment for file server:", {
      GIT_PATH: gitPath,
      BASH_PATH: gitBashPath,
      gitBinDir,
    });

    log.info("[ServiceManager] Starting file server on port", port);
    const startResult = await ctx.fileServer.start({
      command: process.execPath,
      args: [serverJsPath],
      env: {
        ...getAppEnv(),
        ...dirConfig,
        PORT: String(port),
        NODE_ENV: "production",
        ELECTRON_RUN_AS_NODE: "1",
        // Git 环境变量，供 nuwax-file-server 使用
        GIT_PATH: gitPath,
        BASH_PATH: gitBashPath,
      },
      startupDelayMs: DEFAULT_STARTUP_DELAY,
      onStdoutLine: createFileServerPerfHandler(),
    });

    // 启动后轮询 GET /health，确认 Express 真正就绪（非仅 spawn 成功）
    if (startResult.success) {
      const health = await waitForFileServerHealth(
        port,
        FILE_SERVER_HEALTH_TIMEOUT_MS,
      );
      if (!health.healthy) {
        log.error(
          "[ServiceManager] FileServer health check failed:",
          health.error,
        );
        // 健康失败必须停掉已 spawn 的进程，否则下次会命中「Already running」假成功
        try {
          await ctx.fileServer.stopAsync(3000);
        } catch (e) {
          log.warn(
            "[ServiceManager] FileServer stop after failed health check:",
            e,
          );
        }
        return {
          success: false,
          error: `FileServer started but health check failed: ${health.error}`,
        };
      }
      log.info("[ServiceManager] FileServer health check passed");
    }

    return startResult;
  };

  /**
   * 启动文件服务器（含高可用重试）。
   * 注：正常启动流程经由 processHandlers.ts:startFileServerProcess，
   *     两处均挂载 createFileServerPerfHandler() 以保证任一路径均有 PERF 覆盖。
   *
   * 幂等：已在跑且健康时直接成功；不健康则进入完整重试。
   */
  const startFileServer = async (port: number): Promise<ServiceResult> => {
    // 已运行：再探一次 /health，避免升级后僵尸进程被当成成功
    if (ctx.fileServer.running) {
      const health = await waitForFileServerHealth(
        port,
        Math.min(5000, FILE_SERVER_HEALTH_TIMEOUT_MS),
      );
      if (health.healthy) {
        return { success: true, message: "Already running" };
      }
      log.warn(
        "[ServiceManager] FileServer marked running but unhealthy, restarting:",
        health.error,
      );
      try {
        await ctx.fileServer.stopAsync(3000);
      } catch (e) {
        log.warn("[ServiceManager] FileServer stop before retry:", e);
      }
    }

    return withStartRetry(
      (attempt, maxAttempts) => {
        log.info(
          `[ServiceManager] FileServer full start ${attempt}/${maxAttempts} (healthTimeout=${FILE_SERVER_HEALTH_TIMEOUT_MS}ms)`,
        );
        return startFileServerOnce(port);
      },
      { label: "FileServer", logger: startRetryLogger },
    );
  };

  /**
   * 单次启动 Lanproxy（spawn only，不含健康探测与重试）。
   */
  const startLanproxyOnce = async (config: {
    serverIp: string;
    serverPort: number;
    clientKey: string;
    ssl?: boolean;
  }): Promise<ServiceResult> => {
    if (ctx.lanproxy.running) {
      try {
        await ctx.lanproxy.stopAsync(3000);
      } catch (e) {
        log.warn("[ServiceManager] Lanproxy stop before start attempt:", e);
      }
    }

    const binPath = getLanproxyBinPath();
    if (!fs.existsSync(binPath)) {
      return { success: false, error: t("Claw.Lanproxy.platformNotSupported") };
    }

    const useSsl = config.ssl !== false;
    const args = [
      "-s",
      config.serverIp,
      "-p",
      String(config.serverPort),
      "-k",
      config.clientKey,
      `--ssl=${useSsl}`,
    ];

    return ctx.lanproxy.start({
      command: binPath,
      args,
      env: getAppEnv(),
      startupDelayMs: 1000,
    });
  };

  /**
   * 启动 Lanproxy：spawn + 三层健康检查；失败则 stop 并完整重试（最多 3 次）。
   * 健康不通过视为启动失败，避免「本地显示已联通、会话文件口不通」的假成功。
   */
  const startLanproxy = async (config: {
    serverIp: string;
    serverPort: number;
    clientKey: string;
    ssl?: boolean;
  }): Promise<ServiceResult> => {
    // 已运行：探测隧道；健康则幂等返回，否则停掉走重试
    if (ctx.lanproxy.running) {
      try {
        const health = await probeLanproxyAfterStart(
          ctx.lanproxy.pid,
          config.clientKey,
        );
        if (health.healthy) {
          return { success: true, healthCheck: health };
        }
        log.warn(
          "[ServiceManager] Lanproxy marked running but unhealthy, restarting:",
          health.error,
        );
      } catch (e) {
        log.warn(
          "[ServiceManager] Lanproxy health probe before restart failed:",
          e,
        );
      }
      try {
        await ctx.lanproxy.stopAsync(3000);
      } catch (e) {
        log.warn("[ServiceManager] Lanproxy stop before retry:", e);
      }
    }

    return withStartRetry(
      async (attempt, maxAttempts) => {
        log.info(
          `[ServiceManager] Lanproxy full start ${attempt}/${maxAttempts}`,
        );
        const startResult = await startLanproxyOnce(config);
        if (!startResult.success) {
          return startResult;
        }

        try {
          const health = await probeLanproxyAfterStart(
            ctx.lanproxy.pid,
            config.clientKey,
          );
          if (health.healthy) {
            log.info("[ServiceManager] Lanproxy post-start health probe OK");
            return { ...startResult, healthCheck: health };
          }

          log.warn(
            "[ServiceManager] Lanproxy post-start health probe failed:",
            health.error,
          );
          try {
            await ctx.lanproxy.stopAsync(3000);
          } catch (e) {
            log.warn(
              "[ServiceManager] Lanproxy stop after failed health probe:",
              e,
            );
          }
          return {
            success: false,
            error: `Lanproxy started but health check failed: ${health.error}`,
            healthCheck: health,
          };
        } catch (e) {
          const errMsg = e instanceof Error ? e.message : String(e);
          log.warn(
            "[ServiceManager] Lanproxy post-start health probe error:",
            e,
          );
          try {
            await ctx.lanproxy.stopAsync(3000);
          } catch (stopErr) {
            log.warn(
              "[ServiceManager] Lanproxy stop after health probe error:",
              stopErr,
            );
          }
          return {
            success: false,
            error: `Lanproxy health probe error: ${errMsg}`,
          };
        }
      },
      { label: "Lanproxy", logger: startRetryLogger },
    );
  };

  /**
   * 启动 ttyd Web 终端服务
   *
   * - 仅监听回环 127.0.0.1（终端等同 shell，切勿绑定 0.0.0.0 暴露到网络）
   * - 用户配置端口用于 ttyd gateway，对外提供 /computer/ttyd/{user_id}/{project_id}/{*path}
   * - 真实 ttyd 进程仅监听自动分配的内部回环端口
   * - 使用 process.env（用户原始环境），不注入 getAppEnv()，避免 NPM_CONFIG_PREFIX 等
   *   app 内部隔离变量污染用户 shell（nvm / rvm / pyenv 等工具依赖干净的环境）
   * - 幂等：已运行直接返回成功，供启动/重启流程重复调用而不打断已有终端会话
   * - cwd / wrapper 逻辑见 services/packages/ttydHelper.ts
   */
  const startTtyd = async (): Promise<ServiceResult> => {
    const { ttyd: publicPort } = getConfiguredPorts();

    if (ctx.ttyd.running) {
      const gatewayStatus = getTtydGatewayStatus();
      if (gatewayStatus.running && gatewayStatus.port === publicPort) {
        return { success: true, message: "Already running" };
      }

      log.warn(
        `[ServiceManager] ttyd process is running but gateway is not ready for port ${publicPort}; restarting ttyd service`,
      );
      await stopTtydGateway();
      await ctx.ttyd.stopAsync(3000);
      if (gatewayStatus.targetPort) {
        await killProcessTreesListeningOnTcpPort(
          gatewayStatus.targetPort,
        ).catch(() => {});
      }
    }

    const binPath = getTtydBinPath();
    if (!fs.existsSync(binPath)) {
      log.warn(
        `[ServiceManager] ttyd binary not found, skip start: ${binPath}`,
      );
      return {
        success: false,
        error: "ttyd binary not available for this platform",
      };
    }

    await stopTtydGateway();
    try {
      log.info(
        `[ServiceManager] Pre-start ttyd gateway port sweep for ${publicPort}`,
      );
      await killProcessTreesListeningOnTcpPort(publicPort);
    } catch (e) {
      log.warn("[ServiceManager] ttyd gateway pre-start port sweep failed:", e);
    }

    const internalPort = await allocateInternalTtydPort(publicPort);

    const win = isWindows();

    // cwd / wrapper 逻辑委托给 ttydHelper（见 services/packages/ttydHelper.ts）
    const initialCwd = ttydHelper.getTtydInitialCwd();
    ttydHelper.writeTtydCwdFile(initialCwd);
    // 生成 ttyd 终端内置环境脚本（供 wrapper 加载）；写失败时不阻塞 ttyd 启动（降级为系统环境）
    if (win) {
      ttydHelper.ensureTtydWindowsEnvScript();
    } else {
      ttydHelper.ensureTtydEnvScript();
    }

    // Unix：用 wrapper 脚本作为 ttyd 的子进程命令
    //   wrapper 解析 --cwd 参数（由 ttyd -a flag 从 URL query 传入），动态 cd 到目标目录
    // Windows：用 PowerShell wrapper 解析 --cwd 后再进入 cmd.exe，实现 per-connection cwd
    let shellCmd: string;
    let shellArgs: string[];
    let useArgPassThrough = false;

    if (win) {
      const wrapper = ttydHelper.ensureTtydWindowsShellWrapper();
      if (wrapper) {
        shellCmd = ttydHelper.getWindowsPowerShellPath();
        shellArgs = [
          "-NoLogo",
          "-NoProfile",
          "-ExecutionPolicy",
          "Bypass",
          "-File",
          wrapper,
        ];
        useArgPassThrough = true;
      } else {
        // wrapper 写出失败，降级为固定初始目录的 cmd.exe。
        // 必须绝对路径：裸 "cmd.exe" 在部分环境会触发 CreateProcessW 失败（ttyd#1292）
        shellCmd = process.env.ComSpec || "C:\\Windows\\System32\\cmd.exe";
        shellArgs = [];
      }
    } else {
      const wrapper = ttydHelper.ensureTtydShellWrapper();
      if (wrapper) {
        shellCmd = wrapper;
        shellArgs = [];
        useArgPassThrough = true;
      } else {
        // wrapper 写出失败，降级为直接使用 login shell。
        // 注意：ttyd -a flag 会把 URL query 的 --cwd <path> 作为 argv 透传给子命令，
        // 裸 $SHELL -l 收到未知选项 --cwd 会立即退出；故降级时去掉 -a 标志，
        // 避免把 --cwd 透传过去（功能降级：失去 per-connection 动态 cwd，但终端仍可用）。
        shellCmd = process.env.SHELL || "/bin/bash";
        shellArgs = ["-l"];
      }
    }

    // ttyd 选项：
    //   -p  端口
    //   -i  127.0.0.1  仅回环绑定（安全约束：绝不绑定 0.0.0.0）
    //   -W  允许客户端写入 TTY（交互终端必需）
    //   -w  Windows 子进程工作目录（Win11 25H2 + MinGW ttyd 无此参数会在 WS 连接时崩溃，见 ttyd#1501）
    //   -a  允许 URL query 参数（?arg=--cwd&arg=<path>）透传给子进程 argv
    //      降级到裸 login shell 时跳过 -a，避免 --cwd 进入 bash 触发"invalid option"
    const args = [
      "-p",
      String(internalPort),
      "-i",
      "127.0.0.1",
      "-W",
      ...(win ? ["-w", initialCwd] : []),
      ...(useArgPassThrough ? ["-a"] : []),
      shellCmd,
      ...shellArgs,
    ];

    log.info(
      `[ServiceManager] Starting ttyd on 127.0.0.1:${internalPort} behind gateway 127.0.0.1:${publicPort} (shell=${shellCmd}, cwd=${initialCwd})`,
    );
    const startResult = await ctx.ttyd.start({
      command: binPath,
      args,
      env: { ...process.env } as Record<string, string>,
      cwd: initialCwd,
      startupDelayMs: 1000,
    });
    if (!startResult.success) return startResult;

    const gatewayResult = await startTtydGateway({
      listenPort: publicPort,
      targetPort: internalPort,
    });
    if (!gatewayResult.success) {
      await ctx.ttyd.stopAsync(3000);
      await killProcessTreesListeningOnTcpPort(internalPort).catch(() => {});
      return gatewayResult;
    }

    const health = await waitForTtydGatewayHealth(publicPort);
    if (!health.healthy) {
      await stopTtydGateway();
      await ctx.ttyd.stopAsync(3000);
      await killProcessTreesListeningOnTcpPort(internalPort).catch(() => {});
      return {
        success: false,
        error: `ttyd WebSocket health check failed: ${health.error || "unknown error"}`,
      };
    }

    log.info("[ServiceManager] ttyd WebSocket health check passed");

    return startResult;
  };

  /**
   * 启动 ttyd 并把结果/异常统一写入 results 记录，restartAll* 两个函数共用。
   * 抽出来避免两份 try/catch 漂移。
   */
  const startAndRecordTtyd = async (
    results: Record<string, ServiceResult>,
  ): Promise<void> => {
    try {
      results.ttyd = await startTtyd();
      if (results.ttyd.success) log.info("[ServiceManager] ttyd started");
    } catch (e) {
      results.ttyd = { success: false, error: String(e) };
      log.error("[ServiceManager] ttyd start failed:", e);
    }
  };

  /** 按设置页开关启动 GUI MCP（macOS/Linux agent-gui-server + Windows MCP） */
  const startGuiMcpServicesOnRestart = async (
    results: Record<string, ServiceResult>,
  ): Promise<void> => {
    if (!shouldStartGuiMcpServices()) {
      if (FEATURES.ENABLE_GUI_AGENT_SERVER) {
        log.info(
          "[ServiceManager] GUI MCP skipped on restart (disabled in settings)",
        );
      }
      return;
    }

    if (isWindows()) {
      try {
        const winResult = await startWindowsMcp();
        results.windowsMcp = winResult;
        if (!winResult.success) {
          log.warn(
            `[ServiceManager] Windows MCP start failed: ${winResult.error}`,
          );
        }
      } catch (e) {
        results.windowsMcp = { success: false, error: String(e) };
        log.warn("[ServiceManager] Windows MCP start exception:", e);
      }
    } else {
      try {
        const guiResult = await startGuiAgentServer();
        results.guiAgentServer = guiResult;
        if (!guiResult.success) {
          log.warn(
            `[ServiceManager] GUI Agent Server start failed: ${guiResult.error}`,
          );
        }
      } catch (e) {
        results.guiAgentServer = { success: false, error: String(e) };
        log.warn("[ServiceManager] GUI Agent Server start exception:", e);
      }
    }
  };

  /**
   * 重启所有服务
   */
  const restartAllServices = async (): Promise<{
    success: boolean;
    results: Record<string, ServiceResult>;
  }> => {
    log.info("[ServiceManager] Restarting all services...");
    const results: Record<string, ServiceResult> = {};

    // 读取配置
    const agentConfig =
      (readSetting("agent_config") as Record<string, unknown>) || {};
    const step1Config =
      (readSetting("step1_config") as Record<string, unknown>) || {};

    // 1. 停止现有服务（先清 SSE 缓冲，再 destroy Agent，避免重启后回放旧事件）
    clearAllSseEventBuffers();
    try {
      await agentService.destroy();
    } catch (e) {
      log.warn("[ServiceManager] Agent destroy error (ignored):", e);
    }
    await ctx.fileServer.stopAsync();
    await killProcessTreesListeningOnTcpPort(getConfiguredPorts().fileServer);
    await ctx.lanproxy.stopAsync();
    await mcpProxyManager.stop();

    // 2. 启动 MCP Proxy（必须先于 Agent：Agent 初始化时会连 MCP Proxy 注入 mcpServers）
    try {
      await mcpProxyManager.start();
      results.mcpProxy = { success: true };
      log.info("[ServiceManager] MCP Proxy started");

      // 非阻塞预热：提前启动 PersistentMcpBridge，避免首次会话启动延迟
      mcpProxyManager
        .ensureBridgeStarted()
        .catch((e) =>
          log.warn(
            "[ServiceManager] PersistentMcpBridge prewarm failed (will retry on first session):",
            e,
          ),
        );
    } catch (e) {
      results.mcpProxy = { success: false, error: String(e) };
      log.error("[ServiceManager] MCP Proxy start failed:", e);
    }

    await startGuiMcpServicesOnRestart(results);

    // 3. 启动 Agent（依赖 MCP Proxy 已就绪以便 getAgentMcpConfig 对应进程可连）
    try {
      const finalConfig: AgentConfig = {
        engine: normalizeAgentEngine(agentConfig.type),
        apiKey: agentConfig.apiKey as string | undefined,
        baseUrl: agentConfig.apiBaseUrl as string | undefined,
        model: agentConfig.model as string | undefined,
        workspaceDir: (step1Config.workspaceDir as string) || "",
        port: normalizeOptionalPort(agentConfig.backendPort),
        engineBinaryPath: agentConfig.binPath as string | undefined,
      };
      const mcpConfig = mcpProxyManager.getAgentMcpConfig();
      if (mcpConfig) Object.assign(finalConfig, { mcpServers: mcpConfig });
      const ok = await agentService.init(finalConfig);
      results.agent = { success: ok };
      log.info("[ServiceManager] Agent started");
      if (ok) {
        log.info("[ServiceManager] Agent started");
      }
    } catch (e) {
      results.agent = { success: false, error: String(e) };
      log.error("[ServiceManager] Agent start failed:", e);
    }

    // 4. 启动文件服务器（端口来自聚合配置）
    try {
      const { fileServer: fileServerPort } = getConfiguredPorts();
      results.fileServer = await startFileServer(fileServerPort);
      log.info("[ServiceManager] FileServer started");
    } catch (e) {
      results.fileServer = { success: false, error: String(e) };
      log.error("[ServiceManager] FileServer start failed:", e);
    }

    // 5. 启动 Lanproxy
    try {
      const clientKey = readSetting("auth.saved_key") as string | null;
      const lpConfig =
        (readSetting("lanproxy_config") as Record<string, unknown>) || {};
      const serverHost = readSetting("lanproxy.server_host") as string | null;
      const serverPortStored = readSetting("lanproxy.server_port") as
        | number
        | null;
      const serverIp =
        (lpConfig.serverIp as string) ||
        serverHost?.replace(/^https?:\/\//, "");
      const serverPort = (lpConfig.serverPort as number) || serverPortStored;

      if (serverIp && clientKey && serverPort) {
        // startLanproxy 已含三层健康检查与失败重试，勿再二次 probe
        results.lanproxy = await startLanproxy({
          serverIp,
          serverPort,
          clientKey,
          ssl: lpConfig.ssl as boolean,
        });
        if (results.lanproxy.success) {
          log.info("[Lanproxy] Batch start OK", {
            healthCheck: results.lanproxy.healthCheck,
          });
        } else {
          log.error("[Lanproxy] Batch start failed", {
            error: results.lanproxy.error,
            healthCheck: results.lanproxy.healthCheck,
          });
        }
      } else {
        results.lanproxy = { success: false, error: "Lanproxy config missing" };
        log.warn("[Lanproxy] Skipped: missing config", {
          hasServerIp: !!serverIp,
          hasClientKey: !!clientKey,
          hasServerPort: !!serverPort,
          hint: "Set server_host, server_port, and saved_key (or lanproxy_config)",
        });
      }
    } catch (e) {
      results.lanproxy = { success: false, error: String(e) };
      log.error("[Lanproxy] Start error", {
        error: String(e),
        stack: e instanceof Error ? e.stack : undefined,
      });
    }

    // 6. 启动 ttyd Web 终端（仅回环；幂等，不打断已有终端会话）
    await startAndRecordTtyd(results);

    log.info("[ServiceManager] All services restart complete");
    return { success: true, results };
  };

  /**
   * 重启除 Lanproxy 外的所有服务
   *
   * 用于 HTTP 重启接口，不停止/启动 lanproxy
   */
  const restartAllServicesExceptLanproxy = async (): Promise<{
    success: boolean;
    results: Record<string, ServiceResult>;
  }> => {
    log.info("[ServiceManager] Restarting all services except lanproxy...");
    const results: Record<string, ServiceResult> = {};

    // 读取配置
    const agentConfig =
      (readSetting("agent_config") as Record<string, unknown>) || {};
    const step1Config =
      (readSetting("step1_config") as Record<string, unknown>) || {};

    // 1. 停止现有服务（先清 SSE 缓冲，再 destroy Agent，避免重启后回放旧事件）
    // 注意：不停止 lanproxy
    clearAllSseEventBuffers();
    try {
      await agentService.destroy();
    } catch (e) {
      log.warn("[ServiceManager] Agent destroy error (ignored):", e);
    }
    await ctx.fileServer.stopAsync();
    await killProcessTreesListeningOnTcpPort(getConfiguredPorts().fileServer);
    // 不停止 lanproxy: ctx.lanproxy.stop();
    // 先停止 GUI agents（它们依赖 MCP Proxy，先停 MCP 再停 GUI）
    await mcpProxyManager.stop();
    if (FEATURES.ENABLE_GUI_AGENT_SERVER) {
      await stopGuiAgentServer();
    }
    await stopWindowsMcp();

    // 2. 启动 MCP Proxy（必须先于 Agent：Agent 初始化时会连 MCP Proxy 注入 mcpServers）
    try {
      await mcpProxyManager.start();
      results.mcpProxy = { success: true };
      log.info("[ServiceManager] MCP Proxy started");

      mcpProxyManager
        .ensureBridgeStarted()
        .catch((e) =>
          log.warn(
            "[ServiceManager] PersistentMcpBridge prewarm failed (will retry on first session):",
            e,
          ),
        );
    } catch (e) {
      results.mcpProxy = { success: false, error: String(e) };
      log.error("[ServiceManager] MCP Proxy start failed:", e);
    }

    await startGuiMcpServicesOnRestart(results);

    // 3. 启动 Agent（依赖 MCP Proxy 已就绪）
    try {
      const finalConfig: AgentConfig = {
        engine: normalizeAgentEngine(agentConfig.type),
        apiKey: agentConfig.apiKey as string | undefined,
        baseUrl: agentConfig.apiBaseUrl as string | undefined,
        model: agentConfig.model as string | undefined,
        workspaceDir: (step1Config.workspaceDir as string) || "",
        port: normalizeOptionalPort(agentConfig.backendPort),
        engineBinaryPath: agentConfig.binPath as string | undefined,
      };
      const mcpConfig = mcpProxyManager.getAgentMcpConfig();
      if (mcpConfig) Object.assign(finalConfig, { mcpServers: mcpConfig });
      const ok = await agentService.init(finalConfig);
      results.agent = { success: ok };
      log.info("[ServiceManager] Agent started");
      if (ok) {
        log.info("[ServiceManager] Agent started");
      }
    } catch (e) {
      results.agent = { success: false, error: String(e) };
      log.error("[ServiceManager] Agent start failed:", e);
    }

    // 4. 启动文件服务器
    try {
      const { fileServer: fileServerPort } = getConfiguredPorts();
      results.fileServer = await startFileServer(fileServerPort);
      log.info("[ServiceManager] FileServer started");
    } catch (e) {
      results.fileServer = { success: false, error: String(e) };
      log.error("[ServiceManager] FileServer start failed:", e);
    }

    // 5. 启动 ttyd Web 终端（仅回环；幂等）
    await startAndRecordTtyd(results);

    // 注意：不启动 lanproxy
    // 注意：computerServer 的重启由调用方（processHandlers）处理
    log.info(
      "[ServiceManager] All services (except lanproxy) restart complete",
    );
    return { success: true, results };
  };

  /**
   * 停止所有服务
   */
  const stopAllServices = async (): Promise<{
    success: boolean;
    results: Record<string, ServiceResult>;
  }> => {
    log.info("[ServiceManager] Stopping all services...");
    const results: Record<string, ServiceResult> = {};

    // 停止 Agent 前清除所有 SSE 事件缓冲，避免重启/重连后仍回放旧会话事件
    clearAllSseEventBuffers();

    // 停止 Agent
    try {
      await agentService.destroy();
      results.agent = { success: true };
      log.info("[ServiceManager] Agent stopped");
    } catch (e) {
      results.agent = { success: false, error: String(e) };
      log.error("[ServiceManager] Agent stop failed:", e);
    }

    // 停止文件服务器
    try {
      await ctx.fileServer.stopAsync();
      await killProcessTreesListeningOnTcpPort(getConfiguredPorts().fileServer);
      results.fileServer = { success: true };
      log.info("[ServiceManager] FileServer stopped");
    } catch (e) {
      results.fileServer = { success: false, error: String(e) };
    }

    // 停止 Lanproxy
    try {
      await ctx.lanproxy.stopAsync();
      results.lanproxy = { success: true };
      log.info("[Lanproxy] Stopped");
    } catch (e) {
      results.lanproxy = { success: false, error: String(e) };
      log.error("[Lanproxy] Stop error", {
        error: String(e),
        stack: e instanceof Error ? e.stack : undefined,
      });
    }

    // 停止 ttyd Web 终端
    try {
      const gatewayStatus = getTtydGatewayStatus();
      await stopTtydGateway();
      await ctx.ttyd.stopAsync();
      await killProcessTreesListeningOnTcpPort(getConfiguredPorts().ttyd);
      if (gatewayStatus.targetPort) {
        await killProcessTreesListeningOnTcpPort(gatewayStatus.targetPort);
      }
      results.ttyd = { success: true };
      log.info("[ServiceManager] ttyd stopped");
    } catch (e) {
      results.ttyd = { success: false, error: String(e) };
    }

    // 停止 MCP Proxy
    try {
      await mcpProxyManager.stop();
      results.mcpProxy = { success: true };
      log.info("[ServiceManager] MCP Proxy stopped");
    } catch (e) {
      results.mcpProxy = { success: false, error: String(e) };
    }

    // 停止 GUI MCP：先 Windows（uv/python），再非 Windows 的 agent-gui-server，与 main cleanupAllProcesses 顺序一致
    try {
      await stopWindowsMcp();
      results.windowsMcp = { success: true };
      log.info("[ServiceManager] Windows MCP stopped");
    } catch (e) {
      results.windowsMcp = { success: false, error: String(e) };
    }

    if (FEATURES.ENABLE_GUI_AGENT_SERVER) {
      try {
        await stopGuiAgentServer();
        results.guiAgentServer = { success: true };
        log.info("[ServiceManager] GUI Agent Server stopped");
      } catch (e) {
        results.guiAgentServer = { success: false, error: String(e) };
      }
    }

    // 停止所有引擎
    try {
      stopAllEngines();
      results.engines = { success: true };
      log.info("[ServiceManager] Engines stopped");
    } catch (e) {
      results.engines = { success: false, error: String(e) };
    }

    log.info("[ServiceManager] All services stopped");
    return { success: true, results };
  };

  return {
    startFileServer,
    startLanproxy,
    startTtyd,
    restartAllServices,
    restartAllServicesExceptLanproxy,
    stopAllServices,
  };
}

export type ServiceManager = ReturnType<typeof createServiceManager>;
