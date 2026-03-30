/**
 * EngineWarmup — nuwaxcode 引擎热启动管理
 *
 * 在服务 init() 后台预创建一个 ACP 引擎进程，以 "__warmup__" 占位。
 * 首次会话请求时复用并 re-key 为实际 projectId，省掉 ~2s 进程冷启动。
 *
 * 用法（UnifiedAgentService 中仅两行）：
 *   this.warmup = new EngineWarmup(engines, configs, rawMcp);
 *   this.warmup.start(engineType, baseConfig, (e) => this.forwardEvents(e));
 *   // getOrCreateEngine 中：
 *   const reused = await this.warmup.tryReuse(projectId, effectiveConfig);
 */

import log from "electron-log";
import { AcpEngine } from "./acp/acpEngine";
import type { AgentConfig } from "./types";
import type { McpServerEntry } from "../packages/mcp";

const WARMUP_KEY = "__warmup__";

export class EngineWarmup {
  constructor(
    private readonly engines: Map<string, AcpEngine>,
    private readonly configs: Map<string, AgentConfig>,
    private readonly rawMcpServers: Map<string, Record<string, McpServerEntry>>,
  ) {}

  /** 后台预创建 nuwaxcode 引擎。非阻塞，失败不影响正常流程。 */
  start(
    engineType: string | null,
    baseConfig: AgentConfig | null,
    onEngineCreated: (engine: AcpEngine) => void,
  ): void {
    if (engineType !== "nuwaxcode" || !baseConfig) return;
    if (this.engines.has(WARMUP_KEY) || this.engines.size > 0) return;

    log.info("[EngineWarmup] 🔥 后台预热 nuwaxcode 引擎...");
    const engine = new AcpEngine(engineType);
    onEngineCreated(engine);

    // 立即占位，避免 warmup 进行中 getOrCreateEngine 创建重复引擎
    this.engines.set(WARMUP_KEY, engine);
    this.configs.set(WARMUP_KEY, baseConfig);

    const cleanup = () => {
      this.engines.delete(WARMUP_KEY);
      this.configs.delete(WARMUP_KEY);
      this.rawMcpServers.delete(WARMUP_KEY);
      engine.removeAllListeners();
      engine.destroy().catch(() => {});
    };

    engine
      .init(baseConfig)
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

  /**
   * 尝试复用 warmup 引擎。成功时 re-key 为 projectId 并返回引擎；
   * 未就绪/已死时清理并返回 null。
   */
  async tryReuse(
    projectId: string,
    effectiveConfig: AgentConfig,
  ): Promise<AcpEngine | null> {
    if (!this.engines.has(WARMUP_KEY)) return null;

    const engine = this.engines.get(WARMUP_KEY)!;
    if (engine.isReady) {
      log.info(
        `[EngineWarmup] ♻️ 复用 warmup 引擎，分配给 project: ${projectId}`,
      );
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
}
