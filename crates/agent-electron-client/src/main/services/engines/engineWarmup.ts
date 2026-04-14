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

import * as crypto from "crypto";
import * as fs from "fs";
import * as path from "path";
import log from "electron-log";
import { AcpEngine } from "./acp/acpEngine";
import type { AgentConfig, AgentEngineType } from "./types";
import type { McpServerEntry } from "../packages/mcp";
import { firstTokenTrace } from "./perf/firstTokenTrace";

const WARMUP_KEY = "__warmup__";
const WARMUP_ENGINE_TYPE: AgentEngineType = "nuwaxcode";
const RESPAWN_DELAY_MS = 500; // 防抖延迟
const MCP_CONFIG_HASH_RE = /mcp-config-[^-]+-([0-9a-f]{16})\.json$/i;
const WARMUP_ENV_FLAG = "NUWAX_AGENT_WARMUP";
const WARMUP_MCP_READY_FLAG = "NUWAX_AGENT_WARMUP_MCP_READY";
const WARMUP_SANDBOX_POLICY_FINGERPRINT_FLAG =
  "NUWAX_AGENT_WARMUP_SANDBOX_POLICY_FP";

type SandboxPolicyFingerprintProvider = () => string | null;

type WarmupStartOptions = {
  /** 允许在已有活跃 project 引擎时补仓 warmup */
  allowWhenActiveEngines?: boolean;
  /** 用最新请求的 MCP 覆盖 warmup 配置，避免后续复用 miss */
  mcpServers?: AgentConfig["mcpServers"];
  /** 触发原因，仅用于日志 */
  reason?: string;
};

type EngineWarmupOptions = {
  /** Return a stable fingerprint string for current sandbox policy. */
  getSandboxPolicyFingerprint?: SandboxPolicyFingerprintProvider;
};

type StdioMcpEntry = Extract<McpServerEntry, { command: string }>;
type RemoteMcpEntry = Extract<McpServerEntry, { url: string }>;

export class EngineWarmup {
  private respawnScheduled = false;
  private respawnTimer: NodeJS.Timeout | null = null;
  // 缓存上一次会话的 MCP 配置，用于 respawn() 时预热
  private lastMcpServers: AgentConfig["mcpServers"] | null = null;
  // 缓存上一次请求的运行时配置，确保 refill warmup 能命中后续请求
  private lastRuntimeConfig: Pick<
    AgentConfig,
    "model" | "apiKey" | "baseUrl" | "apiProtocol"
  > | null = null;
  private disposed = false;

  constructor(
    private readonly engines: Map<string, AcpEngine>,
    private readonly configs: Map<string, AgentConfig>,
    private readonly rawMcpServers: Map<string, Record<string, McpServerEntry>>,
    private readonly options?: EngineWarmupOptions,
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
    this.lastRuntimeConfig = null;
  }

  /** 重新启用 warmup（用于 service destroy 后再次 init）。 */
  reactivate(): void {
    this.disposed = false;
    this.respawnScheduled = false;
    this.respawnTimer = null;
  }

  /** 后台预创建 nuwaxcode 引擎。非阻塞，失败不影响正常流程。始终预热 nuwaxcode。 */
  start(
    baseConfig: AgentConfig | null,
    onEngineCreated: (engine: AcpEngine) => void,
    options?: WarmupStartOptions,
  ): void {
    if (!baseConfig || this.disposed) return;
    // 仅检查是否已有 warmup 引擎，不检查其他引擎
    // 确保 init() 时一定会初始化 warmup 一次
    if (this.engines.has(WARMUP_KEY)) {
      log.debug("[EngineWarmup] Warmup engine already exists, skipping warmup");
      return;
    }
    const activeEngineCount = this.engines.size;
    if (activeEngineCount > 0 && !options?.allowWhenActiveEngines) {
      log.debug(
        `[EngineWarmup] ${activeEngineCount} active engine(s) present, skipping warmup`,
      );
      return;
    }
    if (options?.mcpServers !== undefined) {
      this.lastMcpServers =
        options.mcpServers && Object.keys(options.mcpServers).length > 0
          ? options.mcpServers
          : null;
    }

    const reason = options?.reason ? `, reason=${options.reason}` : "";
    log.info(
      `[EngineWarmup] 🔥 Background warming nuwaxcode engine...${reason}`,
    );
    const engine = new AcpEngine(WARMUP_ENGINE_TYPE);
    onEngineCreated(engine);

    // 确保 config.engine 与实际引擎类型一致（init 时 engineType 可能是 claude-code）
    // 应用缓存的运行时配置（model/apiKey/baseUrl/apiProtocol），确保 refill warmup 可命中后续请求
    const warmupConfig: AgentConfig = {
      ...baseConfig,
      engine: WARMUP_ENGINE_TYPE,
      ...(this.lastRuntimeConfig
        ? {
            model: this.lastRuntimeConfig.model || baseConfig.model,
            apiKey: this.lastRuntimeConfig.apiKey || baseConfig.apiKey,
            baseUrl: this.lastRuntimeConfig.baseUrl || baseConfig.baseUrl,
            apiProtocol:
              this.lastRuntimeConfig.apiProtocol || baseConfig.apiProtocol,
          }
        : {}),
      env: {
        ...(baseConfig.env || {}),
        [WARMUP_ENV_FLAG]: "1",
      },
    };
    const seededMcpServers =
      options?.mcpServers !== undefined
        ? options.mcpServers
        : (this.lastMcpServers ?? baseConfig.mcpServers);
    if (seededMcpServers) {
      warmupConfig.mcpServers = seededMcpServers;
      warmupConfig.env = {
        ...(warmupConfig.env || {}),
        [WARMUP_MCP_READY_FLAG]: "1",
      };
    }
    const sandboxPolicyFingerprint =
      this.options?.getSandboxPolicyFingerprint?.() || null;
    if (sandboxPolicyFingerprint) {
      warmupConfig.env = {
        ...(warmupConfig.env || {}),
        [WARMUP_SANDBOX_POLICY_FINGERPRINT_FLAG]: sandboxPolicyFingerprint,
      };
      log.debug("[EngineWarmup] warmup sandbox policy snapshot", {
        fingerprintDigest: this.digest(sandboxPolicyFingerprint),
      });
    }

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
          log.info(
            "[EngineWarmup] 🔥 nuwaxcode warm start complete, engine ready",
          );
        } else {
          log.warn("[EngineWarmup] 🔥 Warm start failed (init returned false)");
          cleanup();
        }
      })
      .catch((err) => {
        log.warn(
          "[EngineWarmup] 🔥 Warm start failed:",
          err instanceof Error ? err.message : String(err),
        );
        cleanup();
      });
  }

  private sortValue(value: unknown): unknown {
    if (Array.isArray(value)) return value.map((v) => this.sortValue(v));
    if (!value || typeof value !== "object") return value;
    const src = value as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(src).sort()) {
      out[key] = this.sortValue(src[key]);
    }
    return out;
  }

  private stableStringify(value: unknown): string {
    return JSON.stringify(this.sortValue(value));
  }

  private digest(value: string): string {
    return crypto.createHash("sha1").update(value).digest("hex").slice(0, 12);
  }

  private sortedStringRecord(
    record: Record<string, string | undefined> | undefined,
  ): Record<string, string> {
    const out: Record<string, string> = {};
    if (!record) return out;
    for (const key of Object.keys(record).sort()) {
      const value = record[key];
      if (typeof value === "string") {
        out[key] = value;
      }
    }
    return out;
  }

  private normalizeTransport(
    value: string | undefined,
  ): "sse" | "streamable-http" {
    return value === "sse" ? "sse" : "streamable-http";
  }

  private readConfigFileFingerprint(
    configFilePath: string | undefined,
  ): string {
    if (!configFilePath) return "missing";
    try {
      const raw = fs.readFileSync(configFilePath, "utf8");
      const parsed = JSON.parse(raw);
      return this.stableStringify(parsed);
    } catch {
      const match = path.basename(configFilePath).match(MCP_CONFIG_HASH_RE);
      if (match?.[1]) return `hash:${match[1].toLowerCase()}`;
      return `basename:${path.basename(configFilePath)}`;
    }
  }

  private extractConfigFilePath(args: string[]): string | undefined {
    const idx = args.indexOf("--config-file");
    if (idx < 0 || idx + 1 >= args.length) return undefined;
    return args[idx + 1];
  }

  private isProxyLikeStdio(entry: StdioMcpEntry): boolean {
    const commandBase = path.basename(entry.command).toLowerCase();
    const args = entry.args || [];
    if (commandBase === "mcp-proxy") return true;
    if (args.includes("--config-file")) return true;
    const scriptPath = args[0];
    if (typeof scriptPath === "string") {
      const scriptBase = path.basename(scriptPath).toLowerCase();
      if (scriptBase.includes("mcp") && scriptBase.endsWith(".js")) {
        return true;
      }
    }
    return false;
  }

  private normalizeProxyArgs(args: string[]): string[] {
    const normalized: string[] = [];
    for (let i = 0; i < args.length; i++) {
      const arg = args[i];
      if (arg === "--config-file") {
        i += 1; // Skip the transient config file path argument.
        continue;
      }
      if (
        i === 0 &&
        (arg.endsWith(".js") || arg.endsWith(".cjs") || arg.endsWith(".mjs"))
      ) {
        normalized.push(path.basename(arg));
        continue;
      }
      normalized.push(arg);
    }
    return normalized;
  }

  private tryExtractBridgeServerFromUrl(urlValue: string): string | null {
    try {
      const parsed = new URL(urlValue);
      const host = parsed.hostname.toLowerCase();
      if (host !== "127.0.0.1" && host !== "localhost") return null;
      const segments = parsed.pathname.split("/").filter(Boolean);
      if (segments.length === 2 && segments[0] === "mcp" && segments[1]) {
        return decodeURIComponent(segments[1]);
      }
      return null;
    } catch {
      return null;
    }
  }

  private readProxyConfigMeta(configFilePath: string | undefined): {
    serverName: string;
    persistent: boolean;
  } | null {
    if (!configFilePath) return null;
    try {
      const raw = fs.readFileSync(configFilePath, "utf8");
      const parsed = JSON.parse(raw) as {
        mcpServers?: Record<string, { persistent?: boolean }>;
      };
      const servers = parsed.mcpServers;
      if (!servers) return null;
      const serverNames = Object.keys(servers);
      if (serverNames.length !== 1) return null;
      const keyName = serverNames[0];
      const server = servers[keyName] as { persistent?: boolean; url?: string };
      const urlServerName =
        typeof server?.url === "string"
          ? this.tryExtractBridgeServerFromUrl(server.url)
          : null;
      const serverName = urlServerName || keyName;
      const persistent = server?.persistent === true || !!urlServerName;
      return { serverName, persistent };
    } catch {
      return null;
    }
  }

  private serializeRemoteEntry(entry: RemoteMcpEntry): string {
    const transportSource =
      (entry as { type?: string; transport?: string }).type ??
      (entry as { type?: string; transport?: string }).transport;
    const transport = this.normalizeTransport(transportSource);
    const headers = this.sortedStringRecord(
      (entry as { headers?: Record<string, string> }).headers,
    );
    const allowTools = [
      ...((entry as { allowTools?: string[] }).allowTools || []),
    ].sort();
    const denyTools = [
      ...((entry as { denyTools?: string[] }).denyTools || []),
    ].sort();
    // PersistentMcpBridge 的 URL 形态（http://127.0.0.1:<port>/mcp/<name>）
    // 与 warmup 时可能出现的 proxy-stdio 形态语义等价，统一归一化。
    const bridgeServerName = this.tryExtractBridgeServerFromUrl(entry.url);
    if (bridgeServerName) {
      return this.stableStringify({
        mode: "persistent-bridge",
        server: bridgeServerName,
        allowTools,
        denyTools,
      });
    }
    const authToken = (entry as { authToken?: string }).authToken;
    const authTokenDigest = authToken ? this.digest(authToken) : undefined;
    return this.stableStringify({
      mode: "remote",
      url: entry.url,
      transport,
      headers,
      authTokenDigest,
      allowTools,
      denyTools,
    });
  }

  private serializeStdioEntry(entry: StdioMcpEntry): string {
    const env = { ...(entry.env || {}) };
    delete env.MCP_PROXY_LOG_FILE;
    const isProxy = this.isProxyLikeStdio(entry);
    const args = [...(entry.args || [])];
    const configFilePath = this.extractConfigFilePath(args);
    const allowTools = [...(entry.allowTools || [])].sort();
    const denyTools = [...(entry.denyTools || [])].sort();

    if (isProxy) {
      // getAgentMcpConfig() 在 bridge 未 ready 时会返回 proxy-stdio 入口；
      // bridge ready 后同一 persistent server 会变成 URL 入口。
      // 若 config-file 解析到 persistent server，则归一化为同一语义键，避免误判不兼容。
      const meta = this.readProxyConfigMeta(configFilePath);
      if (meta?.persistent) {
        return this.stableStringify({
          mode: "persistent-bridge",
          server: meta.serverName,
          allowTools,
          denyTools,
        });
      }
      return this.stableStringify({
        mode: "proxy-stdio",
        // Node path may differ between warmup and request; compare basename only.
        command: path.basename(entry.command).toLowerCase(),
        args: this.normalizeProxyArgs(args),
        configFingerprint: this.readConfigFileFingerprint(configFilePath),
        env: this.sortedStringRecord(env),
        allowTools,
        denyTools,
      });
    }

    return this.stableStringify({
      mode: "stdio",
      command: entry.command,
      args,
      env: this.sortedStringRecord(env),
      allowTools,
      denyTools,
    });
  }

  private serializeMcpEntry(entry: McpServerEntry): string {
    if ("url" in entry && typeof entry.url === "string") {
      return this.serializeRemoteEntry(entry as RemoteMcpEntry);
    }
    if ("command" in entry) {
      return this.serializeStdioEntry(entry as StdioMcpEntry);
    }
    return this.stableStringify(entry);
  }

  private checkMcpCompatibility(
    warmupMcp: NonNullable<AgentConfig["mcpServers"]>,
    requestMcp: NonNullable<AgentConfig["mcpServers"]>,
  ): { compatible: boolean; reason: string; detail?: Record<string, string> } {
    const warmupKeys = Object.keys(warmupMcp).sort();
    const requestKeys = Object.keys(requestMcp).sort();

    if (warmupKeys.join("\0") !== requestKeys.join("\0")) {
      return {
        compatible: false,
        reason: `MCP key set mismatch (warmup=${warmupKeys.join(",") || "(none)"}, request=${requestKeys.join(",") || "(none)"})`,
      };
    }

    for (const key of warmupKeys) {
      const aSer = this.serializeMcpEntry(warmupMcp[key]);
      const bSer = this.serializeMcpEntry(requestMcp[key]);
      if (aSer !== bSer) {
        return {
          compatible: false,
          reason: `MCP[${key}] config mismatch`,
          detail: {
            warmupDigest: this.digest(aSer),
            requestDigest: this.digest(bSer),
          },
        };
      }
    }

    return { compatible: true, reason: "ok" };
  }

  /**
   * 缓存请求中的运行时配置（model/apiKey/baseUrl/apiProtocol），
   * 确保后续 warmup refill 创建的引擎与实际请求配置一致。
   */
  private cacheRuntimeConfig(config: AgentConfig): void {
    if (config.model || config.apiKey || config.baseUrl || config.apiProtocol) {
      this.lastRuntimeConfig = {
        model: config.model,
        apiKey: config.apiKey,
        baseUrl: config.baseUrl,
        apiProtocol: config.apiProtocol,
      };
      log.debug(
        "[EngineWarmup] 💾 Caching runtime config for subsequent warmup",
        {
          model: config.model || "(none)",
          baseUrl: config.baseUrl || "(none)",
          apiKeySet: !!config.apiKey,
          apiProtocol: config.apiProtocol || "(none)",
        },
      );
    }
  }

  /**
   * 统一的 warmup 引擎销毁 + 清理逻辑。
   * 所有 tryReuse() 中的"不复用"分支都应调用此方法，避免重复代码。
   */
  private async teardownWarmup(
    engine: AcpEngine,
    reason: string,
    traceData?: { projectId: string; engineType: string; reason: string },
  ): Promise<null> {
    if (traceData) {
      firstTokenTrace.trace(
        "warmup.reuse.miss",
        { projectId: traceData.projectId, engine: traceData.engineType },
        { reason: traceData.reason },
      );
    }
    log.debug(`[EngineWarmup] teardown warmup: ${reason}`);
    engine.removeAllListeners();
    await engine.destroy().catch(() => {});
    this.engines.delete(WARMUP_KEY);
    this.configs.delete(WARMUP_KEY);
    this.rawMcpServers.delete(WARMUP_KEY);
    return null;
  }

  /**
   * 尝试复用 warmup 引擎。成功时 re-key 为 projectId 并返回引擎；
   * 未就绪或已死时清理并返回 null。
   *
   * 复用限制：由于 updateConfig() 无法改变已启动进程的环境，因此：
   * - 仅当 warmup 的运行时配置（model/api/baseUrl/apiProtocol）与请求兼容时才复用
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
          `[EngineWarmup] ⚠️ Engine type incompatible (warmup=${warmupEngineType}, request=${requestEngineType}), not reusing`,
        );
        return this.teardownWarmup(engine, "engine_type_incompatible", {
          projectId,
          engineType: requestEngineType,
          reason: "engine_type_incompatible",
        });
      }

      const warmupSandboxPolicyFingerprint =
        (warmupConfig.env || {})[WARMUP_SANDBOX_POLICY_FINGERPRINT_FLAG] || "";
      const currentSandboxPolicyFingerprint =
        this.options?.getSandboxPolicyFingerprint?.() || "";
      if (currentSandboxPolicyFingerprint) {
        log.debug("[EngineWarmup] warmup sandbox policy compatibility check", {
          hasWarmupMarker: !!warmupSandboxPolicyFingerprint,
          warmupFingerprintDigest: warmupSandboxPolicyFingerprint
            ? this.digest(warmupSandboxPolicyFingerprint)
            : "(none)",
          currentFingerprintDigest: this.digest(
            currentSandboxPolicyFingerprint,
          ),
          compatible:
            warmupSandboxPolicyFingerprint === currentSandboxPolicyFingerprint,
        });
      }
      if (currentSandboxPolicyFingerprint && !warmupSandboxPolicyFingerprint) {
        log.info(
          "[EngineWarmup] ⚠️ Warmup sandbox policy marker missing, skipping reuse for safety",
        );
        return this.teardownWarmup(
          engine,
          "legacy_warmup_without_sandbox_policy_marker",
          {
            projectId,
            engineType: requestEngineType || warmupEngineType,
            reason: "legacy_warmup_without_sandbox_policy_marker",
          },
        );
      }
      if (
        currentSandboxPolicyFingerprint &&
        warmupSandboxPolicyFingerprint &&
        warmupSandboxPolicyFingerprint !== currentSandboxPolicyFingerprint
      ) {
        log.info(
          "[EngineWarmup] ⚠️ Sandbox policy changed, skipping warmup reuse",
          {
            warmupFingerprintDigest: this.digest(
              warmupSandboxPolicyFingerprint,
            ),
            currentFingerprintDigest: this.digest(
              currentSandboxPolicyFingerprint,
            ),
          },
        );
        return this.teardownWarmup(engine, "sandbox_policy_incompatible", {
          projectId,
          engineType: requestEngineType || warmupEngineType,
          reason: "sandbox_policy_incompatible",
        });
      }

      // Runtime config compatibility check.
      // updateConfig() cannot patch process env after spawn, so mismatched
      // model/auth/baseUrl/protocol must fallback to cold create.
      const runtimeMismatch: string[] = [];
      if (
        effectiveConfig.model &&
        effectiveConfig.model !== (warmupConfig.model || "")
      ) {
        runtimeMismatch.push("model");
      }
      if (
        effectiveConfig.apiKey &&
        effectiveConfig.apiKey !== (warmupConfig.apiKey || "")
      ) {
        runtimeMismatch.push("apiKey");
      }
      if (
        effectiveConfig.baseUrl &&
        effectiveConfig.baseUrl !== (warmupConfig.baseUrl || "")
      ) {
        runtimeMismatch.push("baseUrl");
      }
      if (
        effectiveConfig.apiProtocol &&
        effectiveConfig.apiProtocol !== (warmupConfig.apiProtocol || "")
      ) {
        runtimeMismatch.push("apiProtocol");
      }

      if (runtimeMismatch.length > 0) {
        const requestMcp = effectiveConfig.mcpServers || {};
        const requestMcpKeys = Object.keys(requestMcp).sort();
        // 缓存本次请求的运行时配置，供后续 warmup refill 使用
        this.cacheRuntimeConfig(effectiveConfig);
        log.info(
          `[EngineWarmup] ⚠️ Runtime config incompatible, not reusing warmup (${runtimeMismatch.join(",")})`,
          {
            warmupModel: warmupConfig.model || "(none)",
            requestModel: effectiveConfig.model || "(none)",
            warmupBaseUrl: warmupConfig.baseUrl || "(none)",
            requestBaseUrl: effectiveConfig.baseUrl || "(none)",
            warmupApiKeySet: !!warmupConfig.apiKey,
            requestApiKeySet: !!effectiveConfig.apiKey,
            warmupApiProtocol: warmupConfig.apiProtocol || "(none)",
            requestApiProtocol: effectiveConfig.apiProtocol || "(none)",
          },
        );
        this.lastMcpServers = requestMcpKeys.length > 0 ? requestMcp : null;
        return this.teardownWarmup(engine, "runtime_config_incompatible", {
          projectId,
          engineType: requestEngineType || warmupEngineType,
          reason: "runtime_config_incompatible",
        });
      }

      // Sandbox mode compatibility check.
      // The sandbox mode (strict/compat/permissive) is baked into the process wrapper
      // at spawn time (nuwax-sandbox-helper.exe serve --write-restricted).
      // updateConfig() cannot change the process-level sandbox after spawn,
      // so mismatched modes must fallback to cold create.
      const warmupSandboxMode = engine.sandboxMode;
      if (!effectiveConfig.__sandboxMode) {
        log.debug(
          "[EngineWarmup] __sandboxMode not set on effectiveConfig, assuming compat",
        );
      }
      const requestSandboxMode = effectiveConfig.__sandboxMode ?? "compat";
      if (warmupSandboxMode !== requestSandboxMode) {
        log.info(
          `[EngineWarmup] ⚠️ Sandbox mode incompatible (warmup=${warmupSandboxMode}, request=${requestSandboxMode}), not reusing`,
        );
        this.lastMcpServers =
          Object.keys(effectiveConfig.mcpServers || {}).length > 0
            ? effectiveConfig.mcpServers || null
            : null;
        return this.teardownWarmup(engine, "sandbox_mode_incompatible", {
          projectId,
          engineType: requestEngineType || warmupEngineType,
          reason: "sandbox_mode_incompatible",
        });
      }

      const warmupMcp = warmupConfig.mcpServers || {};
      const requestMcp = effectiveConfig.mcpServers || {};
      const warmupMcpKeys = Object.keys(warmupMcp).sort();
      const requestMcpKeys = Object.keys(requestMcp).sort();

      // 兼容旧 warmup 进程：
      // 历史版本 warmup 进程未注入 MCP（仅 permission），即使 mcpServers 配置看起来一致，
      // 实际运行时仍可能出现 MCP.tools()=0。检测到缺少新标记时强制放弃复用，回退冷启动。
      const warmupMcpReady =
        (warmupConfig.env || {})[WARMUP_MCP_READY_FLAG] === "1";
      if (requestMcpKeys.length > 0 && !warmupMcpReady) {
        log.info(
          "[EngineWarmup] ⚠️ Legacy warmup process detected (missing MCP ready marker), not reusing",
          { requestMcpKeys, warmupMcpKeys },
        );
        this.lastMcpServers = requestMcp;
        return this.teardownWarmup(
          engine,
          "legacy_warmup_without_mcp_ready_marker",
          {
            projectId,
            engineType: requestEngineType || warmupEngineType,
            reason: "legacy_warmup_without_mcp_ready_marker",
          },
        );
      }

      const { compatible, reason, detail } = this.checkMcpCompatibility(
        warmupMcp,
        requestMcp,
      );

      if (!compatible) {
        log.info(
          `[EngineWarmup] ⚠️ MCP config incompatible, not reusing warmup (${reason})`,
        );
        if (detail) {
          log.debug("[EngineWarmup] MCP compatibility diff details:", detail);
        }
        // 缓存本次请求的 MCP 配置，供 respawn() 使用
        if (requestMcpKeys.length > 0) {
          this.lastMcpServers = requestMcp;
          log.debug(
            `[EngineWarmup] 💾 Cached MCP config for respawn: ${requestMcpKeys.join(",")}`,
          );
        } else {
          this.lastMcpServers = null;
        }
        return this.teardownWarmup(engine, `mcp_incompatible: ${reason}`, {
          projectId,
          engineType: requestEngineType || warmupEngineType,
          reason: `mcp_incompatible: ${reason}`,
        });
      }

      log.info(
        `[EngineWarmup] ♻️ Reusing warmup engine for project: ${projectId} (saved ~${savedTime}ms, MCP: ${requestMcpKeys.join(",") || "(none)"})`,
      );
      // 复用成功时也缓存运行时配置，确保 refill warmup 有一致的配置
      this.cacheRuntimeConfig(effectiveConfig);
      firstTokenTrace.trace(
        "warmup.reuse.hit",
        { projectId, engine: warmupEngineType },
        {
          savedMs: savedTime,
          mcpKeys: requestMcpKeys,
        },
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
    // 缓存运行时配置，确保后续 refill warmup 有正确的 model/apiKey/baseUrl/apiProtocol
    this.cacheRuntimeConfig(effectiveConfig);
    return this.teardownWarmup(engine, "warmup_not_ready", {
      projectId,
      engineType: effectiveConfig.engine || WARMUP_ENGINE_TYPE,
      reason: "warmup_not_ready",
    });
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
        log.debug(
          "[EngineWarmup] Warmup engine already exists, skipping re-warmup",
        );
        return;
      }
      if (this.engines.size > 0) {
        log.debug(
          `[EngineWarmup] ${this.engines.size} active engine(s) present, skipping re-warmup`,
        );
        return;
      }

      // 使用缓存的 MCP 配置（如果有），确保 warmup 有正确的 MCP
      // 注意：lastMcpServers 来自上一次请求，如果全局配置已变更可能过期
      if (this.lastMcpServers) {
        log.debug(
          "[EngineWarmup] Warming up with cached MCP config (may be stale; first request will validate)",
        );
      }
      const respawnConfig = this.lastMcpServers
        ? { ...baseConfig, mcpServers: this.lastMcpServers }
        : baseConfig;

      const mcpInfo = respawnConfig.mcpServers
        ? `MCP: ${Object.keys(respawnConfig.mcpServers).join(",")}`
        : "MCP: (none)";
      log.info(
        `[EngineWarmup] 🔁 Session ended, re-warming nuwaxcode engine (${mcpInfo})...`,
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
