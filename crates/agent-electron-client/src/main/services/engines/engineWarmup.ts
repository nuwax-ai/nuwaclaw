/**
 * EngineWarmup — nuwaxcode 引擎热启动管理
 *
 * 在服务 init() 后台预创建一个 nuwaxcode ACP 引擎进程，以 "__warmup__" 占位。
 * 当前不复用（因浏览器 MCP 加载问题），仅用于预热 OS 缓存。
 * 首次会话请求时 cleanup() 销毁 warmup 引擎，正常创建新引擎。
 *
 * 注意：始终预热 nuwaxcode，与 init() 传入的 engineType 无关。
 *       因为实际请求中 agent_server.command 会动态决定引擎类型。
 *
 * 用法（UnifiedAgentService 中仅两行）：
 *   this.warmup.start(baseConfig, (e) => this.forwardEvents(e));
 *   // getOrCreateEngine 中：
 *   await this.warmup.cleanup();
 */

import log from "electron-log";
import { AcpEngine } from "./acp/acpEngine";
import type { AgentConfig, AgentEngineType } from "./types";
import type { McpServerEntry } from "../packages/mcp";

const WARMUP_KEY = "__warmup__";
const WARMUP_ENGINE_TYPE: AgentEngineType = "nuwaxcode";

export class EngineWarmup {
  constructor(
    private readonly engines: Map<string, AcpEngine>,
    private readonly configs: Map<string, AgentConfig>,
    private readonly rawMcpServers: Map<string, Record<string, McpServerEntry>>,
  ) {}

  /** 后台预创建 nuwaxcode 引擎。非阻塞，失败不影响正常流程。始终预热 nuwaxcode。 */
  start(
    baseConfig: AgentConfig | null,
    onEngineCreated: (engine: AcpEngine) => void,
  ): void {
    if (!baseConfig) return;
    if (this.engines.has(WARMUP_KEY) || this.engines.size > 0) {
      log.debug(
        `[EngineWarmup] 跳过预热 (已有 ${this.engines.size} 个引擎或 warmup 占位)`,
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

  /**
   * 清理 warmup 引擎（不复用，因浏览器 MCP 加载问题）。
   * 无论引擎是否就绪均销毁，为首次真实请求让路。
   */
  async cleanup(): Promise<void> {
    if (!this.engines.has(WARMUP_KEY)) return;

    setTimeout(async () => {
      const engine = this.engines.get(WARMUP_KEY)!;
      this.engines.delete(WARMUP_KEY);
      this.configs.delete(WARMUP_KEY);
      this.rawMcpServers.delete(WARMUP_KEY);
      engine.removeAllListeners();
      await engine.destroy().catch(() => {});
      log.info("[EngineWarmup] 🧹 warmup 引擎已清理（不复用）");
    }, 1000);
  }
}
