/**
 * EngineWarmup — nuwaxcode 引擎热启动管理
 *
 * 在服务 init() 后台预创建一个 nuwaxcode ACP 引擎进程，以 "__warmup__" 占位。
 * 首次会话请求时复用并 re-key 为实际 projectId，省掉 ~2s 进程冷启动。
 *
 * 注意：始终预热 nuwaxcode，与 init() 传入的 engineType 无关。
 *       因为实际请求中 agent_server.command 会动态决定引擎类型。
 *
 * 用法（UnifiedAgentService 中仅两行）：
 *   this.warmup.start(baseConfig, (e) => this.forwardEvents(e));
 *   // getOrCreateEngine 中：
 *   const reused = await this.warmup.tryReuse(projectId, effectiveConfig);
 */

import log from "electron-log";
import { AcpEngine } from "./acp/acpEngine";
import type { AgentConfig, AgentEngineType } from "./types";
import type { McpServerEntry } from "../packages/mcp";

const WARMUP_KEY = "__warmup__";
const WARMUP_ENGINE_TYPE: AgentEngineType = "nuwaxcode";
const RESPAWN_DELAY_MS = 500; // 防抖延迟

export class EngineWarmup {
  private respawnScheduled = false;
  private respawnTimer: NodeJS.Timeout | null = null;
  // 缓存上一次会话的 MCP 配置，用于 respawn() 时预热
  private lastMcpServers: AgentConfig["mcpServers"] | null = null;
  private disposed = false;

  constructor(
    private readonly engines: Map<string, AcpEngine>,
    private readonly configs: Map<string, AgentConfig>,
    private readonly rawMcpServers: Map<string, Record<string, McpServerEntry>>,
  ) {}

  /** 清理 respawn 定时器，防止实例销毁后仍有 pending callback。 */
  dispose(): void {
    this.disposed = true;
    if (this.respawnTimer) {
      clearTimeout(this.respawnTimer);
      this.respawnTimer = null;
    }
    this.respawnScheduled = false;
    this.lastMcpServers = null;
  }

  /** 后台预创建 nuwaxcode 引擎。非阻塞，失败不影响正常流程。始终预热 nuwaxcode。 */
  start(
    baseConfig: AgentConfig | null,
    onEngineCreated: (engine: AcpEngine) => void,
  ): void {
    if (!baseConfig || this.disposed) return;
    // 仅检查是否已有 warmup 引擎，不检查其他引擎
    // 确保 init() 时一定会初始化 warmup 一次
    if (this.engines.has(WARMUP_KEY)) {
      log.debug("[EngineWarmup] warmup 引擎已存在，跳过预热");
      return;
    }
    if (this.engines.size > 0) {
      log.debug(
        `[EngineWarmup] 当前有 ${this.engines.size} 个活跃引擎，跳过预热`,
      );
      return;
    }

    log.info("[EngineWarmup] 🔥 后台预热 nuwaxcode 引擎...");
    const engine = new AcpEngine(WARMUP_ENGINE_TYPE);
    onEngineCreated(engine);

    // 确保 config.engine 与实际引擎类型一致（init 时 engineType 可能是 claude-code）
    const warmupConfig = { ...baseConfig, engine: WARMUP_ENGINE_TYPE };

    // 立即占位，避免 warmup 进行中 getOrCreateEngine 创建重复引擎
    this.engines.set(WARMUP_KEY, engine);
    this.configs.set(WARMUP_KEY, warmupConfig);

    const cleanup = () => {
      this.engines.delete(WARMUP_KEY);
      this.configs.delete(WARMUP_KEY);
      this.rawMcpServers.delete(WARMUP_KEY);
      engine.removeAllListeners();
      engine.destroy().catch(() => {});
    };

    engine
      .init(warmupConfig)
      .then((ok) => {
        if (ok && this.engines.has(WARMUP_KEY)) {
          log.info("[EngineWarmup] 🔥 nuwaxcode 热启动完成，引擎已就绪");
        } else {
          log.warn("[EngineWarmup] 🔥 热启动失败 (init returned false)");
          cleanup();
        }
      })
      .catch((err) => {
        log.warn(
          "[EngineWarmup] 🔥 热启动失败:",
          err instanceof Error ? err.message : String(err),
        );
        cleanup();
      });
  }

  /** serializeMcpEntry(entry: McpServerEntry): string {
    if ("url" in entry && typeof entry.url === "string") {
      // Remote MCP
      const t = ("type" in entry ? entry.type : (entry as { transport?: string }).transport) || "";
      return `remote:${entry.url}:${t}`;
    }
    if ("command" in entry) {
      // Stdio MCP — 排除 MCP_PROXY_LOG_FILE
      const env = { ...entry.env };
      delete (env as Record<string, string>).MCP_PROXY_LOG_FILE;
      return `stdio:${entry.command}:${JSON.stringify(entry.args || [])}:${JSON.stringify(env, Object.keys(env).sort())}`;
    }
    return JSON.stringify(entry);
  }

  private checkMcpCompatibility(
    warmupMcp: NonNullable<AgentConfig["mcpServers"]>,
    requestMcp: NonNullable<AgentConfig["mcpServers"]>,
  ): { compatible: boolean; reason: string } {
    const warmupKeys = Object.keys(warmupMcp).sort();
    const requestKeys = Object.keys(requestMcp).sort();

    if (warmupKeys.join("\0") !== requestKeys.join("\0")) {
      return {
        compatible: false,
        reason: `MCP key 集合不一致 (warmup=${warmupKeys.join(",") || "(none)"}, request=${requestKeys.join(",") || "(none)"})`,
      };
    }

    for (const key of warmupKeys) {
      const aSer = this.serializeMcpEntry(warmupMcp[key]);
      const bSer = this.serializeMcpEntry(requestMcp[key]);
      if (aSer !== bSer) {
        return {
          compatible: false,
          reason: `MCP[${key}] 配置不一致`,
        };
      }
    }

    return { compatible: true, reason: "ok" };
  }

  /**
   * 尝试复用 warmup 引擎。成功时 re-key 为 projectId 并返回引擎；
   * 未就绪或已死时清理并返回 null。
   *
   * MCP 限制：由于 MCP 在引擎启动时通过环境变量 OPENCODE_CONFIG_CONTENT 注入，
   * updateConfig() 无法改变已启动进程的环境。因此：
   * - 仅当 warmup MCP 与请求 MCP 语义完全兼容时才复用
   * - 不兼容时立即回退冷启动，避免首个 MCP 加载失败
   *
   * @param startTime 请求开始时间戳，用于计算节省的时间
   */
  async tryReuse(
    projectId: string,
    effectiveConfig: AgentConfig,
    startTime?: number,
  ): Promise<AcpEngine | null> {
    if (!this.engines.has(WARMUP_KEY)) return null;

    const engine = this.engines.get(WARMUP_KEY)!;
    if (engine.isReady) {
      const savedTime = startTime ? Date.now() - startTime : 0;
      const warmupConfig = this.configs.get(WARMUP_KEY)!;

      // 检查 model family 兼容性（nuwaxcode vs claude-code 等不能互转）
      const warmupEngineType = warmupConfig.engine || WARMUP_ENGINE_TYPE;
      const requestEngineType = effectiveConfig.engine;
      if (
        requestEngineType &&
        requestEngineType !== warmupEngineType &&
        requestEngineType !== "nuwaxcode" // nuwaxcode 是 warmup 的默认类型
      ) {
        log.info(
          `[EngineWarmup] ⚠️ 引擎类型不兼容 (warmup=${warmupEngineType}, request=${requestEngineType})，不复用`,
        );
        engine.removeAllListeners();
        await engine.destroy().catch(() => {});
        this.engines.delete(WARMUP_KEY);
        this.configs.delete(WARMUP_KEY);
        this.rawMcpServers.delete(WARMUP_KEY);
        return null;
      }

      const warmupMcp = warmupConfig.mcpServers || {};
      const requestMcp = effectiveConfig.mcpServers || {};
      const warmupMcpKeys = Object.keys(warmupMcp).sort();
      const requestMcpKeys = Object.keys(requestMcp).sort();
      const { compatible, reason } = this.checkMcpCompatibility(
        warmupMcp,
        requestMcp,
      );

      if (!compatible) {
        log.info(
          `[EngineWarmup] ⚠️ MCP 配置不兼容，不复用 warmup（${reason}）`,
        );
        // 缓存本次请求的 MCP 配置，供 respawn() 使用
        if (requestMcpKeys.length > 0) {
          this.lastMcpServers = requestMcp;
          log.debug(
            `[EngineWarmup] 💾 缓存 MCP 配置供 respawn 使用: ${requestMcpKeys.join(",")}`,
          );
        } else {
          this.lastMcpServers = null;
        }
        engine.removeAllListeners();
        await engine.destroy().catch(() => {});
        this.engines.delete(WARMUP_KEY);
        this.configs.delete(WARMUP_KEY);
        this.rawMcpServers.delete(WARMUP_KEY);
        return null;
      }

      log.info(
        `[EngineWarmup] ♻️ 复用 warmup 引擎，分配给 project: ${projectId} (节省 ~${savedTime}ms, MCP: ${requestMcpKeys.join(",") || "(none)"})`,
      );
      this.lastMcpServers = requestMcpKeys.length > 0 ? requestMcp : null;

      this.engines.delete(WARMUP_KEY);
      this.configs.delete(WARMUP_KEY);
      this.rawMcpServers.delete(WARMUP_KEY);
      this.engines.set(projectId, engine);
      this.configs.set(projectId, effectiveConfig);
      return engine;
    }

    // 未就绪或已死，清理
    engine.removeAllListeners();
    await engine.destroy().catch(() => {});
    this.engines.delete(WARMUP_KEY);
    this.configs.delete(WARMUP_KEY);
    this.rawMcpServers.delete(WARMUP_KEY);
    return null;
  }

  /**
   * 重新启动 warmup 引擎（在会话结束后调用）。
   * 使用防抖机制避免短时间内多次调用。
   * 使用上次会话缓存的 MCP 配置（如果有），确保 warmup 有正确的 MCP。
   */
  respawn(
    baseConfig: AgentConfig | null,
    onEngineCreated: (engine: AcpEngine) => void,
  ): void {
    if (!baseConfig || this.disposed) return;

    // 清除之前的定时器
    if (this.respawnTimer) {
      clearTimeout(this.respawnTimer);
    }

    this.respawnScheduled = true;

    this.respawnTimer = setTimeout(() => {
      if (this.disposed) return;
      this.respawnScheduled = false;
      this.respawnTimer = null;

      if (this.engines.has(WARMUP_KEY)) {
        log.debug("[EngineWarmup] warmup 引擎已存在，跳过重新预热");
        return;
      }
      if (this.engines.size > 0) {
        log.debug(
          `[EngineWarmup] 当前有 ${this.engines.size} 个活跃引擎，暂不重新预热`,
        );
        return;
      }

      // 使用缓存的 MCP 配置（如果有），确保 warmup 有正确的 MCP
      // 注意：lastMcpServers 来自上一次请求，如果全局配置已变更可能过期
      if (this.lastMcpServers) {
        log.debug(
          "[EngineWarmup] 使用缓存的 MCP 配置预热（可能已过期，首次请求时会校验）",
        );
      }
      const respawnConfig = this.lastMcpServers
        ? { ...baseConfig, mcpServers: this.lastMcpServers }
        : baseConfig;

      const mcpInfo = respawnConfig.mcpServers
        ? `MCP: ${Object.keys(respawnConfig.mcpServers).join(",")}`
        : "MCP: (none)";
      log.info(
        `[EngineWarmup] 🔁 会话结束，重新预热 nuwaxcode 引擎 (${mcpInfo})...`,
      );

      this.start(respawnConfig, onEngineCreated);
    }, RESPAWN_DELAY_MS);
  }

  /**
   * 获取当前 warmup 引擎状态（用于监控和调试）。
   */
  getWarmupStatus(): {
    hasWarmup: boolean;
    isReady: boolean;
    engineCount: number;
  } {
    const warmupEngine = this.engines.get(WARMUP_KEY);
    return {
      hasWarmup: this.engines.has(WARMUP_KEY),
      isReady: warmupEngine?.isReady ?? false,
      engineCount: this.engines.size,
    };
  }
}
