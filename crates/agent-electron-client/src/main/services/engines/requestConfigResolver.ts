/**
 * chat 请求 → 引擎配置解析（从 UnifiedAgentService.ensureEngineForRequest 提取）
 *
 * - parseContextServers：ACP context_servers → 原始 MCP server 表（mcp-proxy 提取 / uv 解析）
 * - resolveRequestEngineParams：引擎类型 / env 模板 / 模型归一化
 * - resolveMcpServersForEngine：bridge 提取 + proxy bridge 启动 + agent 视角 MCP 配置
 * - buildEffectiveConfig：合成引擎有效配置（env 合并、日志目录本地化、codex cwd 覆盖）
 *
 * ensureEngineForRequest 仅保留编排骨架（快速路径、变更检测、引擎重建）。
 */

import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import log from "electron-log";
import type {
  ComputerChatRequest,
  ModelProviderConfig,
} from "@shared/types/computerTypes";
import type { McpServerEntry } from "../packages/mcp";
import { APP_DATA_DIR_NAME } from "../constants";
import { resolveComputerProjectWorkspaceDir } from "../workspacePaths";
import { perfEmitter } from "./perf/perfEmitter";
import { mapAgentCommand, resolveAgentEnv } from "./agentHelpers";
import { resolveOpenAICompatModel } from "./acp/openAICompatRouting";
import type { AgentConfig, AgentEngineType } from "./types";

export function resolveRequiredAgentEngine(args: {
  agentCommand?: string | null;
  apiProtocol?: string | null;
  fallbackEngine?: AgentEngineType | null;
}): AgentEngineType | null {
  const acpEngine = args.agentCommand
    ? mapAgentCommand(args.agentCommand)
    : null;
  if (acpEngine) return acpEngine;

  const apiProtocol = (args.apiProtocol || "").trim().toLowerCase();
  if (apiProtocol === "anthropic") return "claude-code";

  return args.fallbackEngine ?? null;
}

function shouldNormalizeCodexModelToOpenAICompat(args: {
  engine: AgentEngineType | null | undefined;
  apiProtocol?: string | null;
  baseUrl?: string | null;
  model?: string | null;
}): boolean {
  if (args.engine !== "codex-cli") return false;
  const model = (args.model || "").trim();
  if (!model || model.includes("/")) return false;
  const protocol = (args.apiProtocol || "").trim().toLowerCase();
  if (protocol !== "anthropic") return false;
  const baseUrl = (args.baseUrl || "").trim().toLowerCase();
  return baseUrl.includes("open.bigmodel.cn/api/anthropic");
}

/**
 * 解析 ACP context_servers 为原始 MCP server 表。
 * mcp-proxy bridge 入口会展开为内部真实 server；uv 命令做本地路径解析。
 */
export async function parseContextServers(
  contextServers:
    | NonNullable<ComputerChatRequest["agent_config"]>["context_servers"]
    | undefined,
): Promise<Record<string, McpServerEntry>> {
  const requestMcpServersEarly: Record<string, McpServerEntry> = {};
  if (!contextServers) return requestMcpServersEarly;

  let mcpModule: {
    resolveUvCommand: (
      cmd: string,
      args: string[],
      dir?: string,
    ) => { command: string; args: string[] };
    extractRealMcpServers: (
      cmd: string,
      args: string[],
      env?: Record<string, string>,
      dir?: string,
    ) => Record<string, McpServerEntry> | null;
  } | null = null;
  try {
    mcpModule = await import("../packages/mcp");
  } catch {
    // mcp module not available, proceed without resolution
  }
  for (const [name, srv] of Object.entries(contextServers)) {
    if (srv.enabled === false || !srv.command) continue;
    const command = srv.command;
    const args = srv.args || [];
    if (mcpModule) {
      if (command === "mcp-proxy" || path.basename(command) === "mcp-proxy") {
        const extracted = mcpModule.extractRealMcpServers(
          command,
          args,
          srv.env,
        );
        if (extracted) {
          for (const [innerName, innerSrv] of Object.entries(extracted)) {
            requestMcpServersEarly[innerName] = innerSrv;
          }
        }
      } else {
        const resolved = mcpModule.resolveUvCommand(command, args);
        requestMcpServersEarly[name] = {
          command: resolved.command,
          args: resolved.args,
          env: srv.env,
        };
      }
    } else {
      requestMcpServersEarly[name] = { command, args, env: srv.env };
    }
  }
  return requestMcpServersEarly;
}

export interface ResolvedRequestEngineParams {
  requiredEngine: AgentEngineType | null;
  resolvedEnv: Record<string, string> | undefined;
  requestedModel: string | undefined;
}

/** 解析本次请求要求的引擎类型、env 模板与模型（含 codex OpenAI-compat 归一化） */
export function resolveRequestEngineParams(args: {
  request: ComputerChatRequest;
  fallbackEngine: AgentEngineType | null;
  baseModel?: string;
}): ResolvedRequestEngineParams {
  const { request, fallbackEngine, baseModel } = args;
  const agentServer = request.agent_config?.agent_server;
  const mp = request.model_provider;
  const requiredEngine = resolveRequiredAgentEngine({
    agentCommand: agentServer?.command,
    apiProtocol: mp?.api_protocol,
    fallbackEngine,
  });
  const resolvedEnv = agentServer?.env
    ? resolveAgentEnv(agentServer.env, mp)
    : undefined;
  const resolvedOpenAICompatModel = resolveOpenAICompatModel({
    model: mp?.model,
    defaultModel: mp?.default_model,
    envModel:
      resolvedEnv?.OPENCODE_MODEL ||
      resolvedEnv?.ANTHROPIC_MODEL ||
      resolvedEnv?.CODEX_MODEL,
  });
  let requestedModel =
    resolvedOpenAICompatModel?.rawModel ||
    mp?.model ||
    mp?.default_model ||
    resolvedEnv?.OPENCODE_MODEL ||
    resolvedEnv?.ANTHROPIC_MODEL ||
    resolvedEnv?.CODEX_MODEL ||
    baseModel;
  if (
    shouldNormalizeCodexModelToOpenAICompat({
      engine: requiredEngine,
      apiProtocol: mp?.api_protocol,
      baseUrl: mp?.base_url,
      model: requestedModel,
    })
  ) {
    requestedModel = `openai-compatible/${requestedModel}`;
    log.info(
      `[UnifiedAgent] normalized codex model to OpenAI-compatible variant: ${requestedModel}`,
    );
  }
  return { requiredEngine, resolvedEnv, requestedModel };
}

/**
 * 解析传给引擎的最终 MCP servers：
 * bridge 入口展开 → 暂存 proxy manager → 启动 bridge → 取 agent 视角配置。
 * 动态 MCP 为空时仍确保 bridge 启动（包含默认服务如 chrome-devtools）。
 */
export async function resolveMcpServersForEngine(args: {
  requestMcpServersRuntime: Record<string, McpServerEntry>;
  engineKey: string;
  /** 上一阶段（syncMcp）完成时间戳，用于 perf 埋点 */
  perfStartMs: number;
}): Promise<AgentConfig["mcpServers"] | undefined> {
  const { requestMcpServersRuntime, engineKey, perfStartMs } = args;
  const t2 = perfStartMs;
  let t3 = t2;
  let t4 = t2;

  let freshMcpServers: AgentConfig["mcpServers"] | undefined;
  if (Object.keys(requestMcpServersRuntime).length > 0) {
    // 处理 bridge 入口（mcp-proxy）：提取内部真实 MCP 服务器配置
    // 并转换为 bridge URL 格式（用于传递给 agent）
    const { extractRealMcpServers } = await import("../packages/mcp");
    const realMcpServers: Record<string, McpServerEntry> = {};
    for (const [name, entry] of Object.entries(requestMcpServersRuntime)) {
      if (!("command" in entry)) {
        // URL 类型（RemoteMcpServerEntry），直接保留
        realMcpServers[name] = entry;
        continue;
      }
      // command 类型：检查是否为 bridge 入口
      const isBridge =
        entry.command === "mcp-proxy" ||
        path.basename(entry.command) === "mcp-proxy";
      if (isBridge) {
        // Bridge 入口：提取内部真实 MCP 服务器配置
        const extracted = extractRealMcpServers(
          entry.command,
          entry.args || [],
          entry.env,
        );
        if (extracted) {
          // 将提取的服务器配置添加到 realMcpServers
          for (const [innerName, innerEntry] of Object.entries(extracted)) {
            realMcpServers[innerName] = innerEntry;
          }
        }
      } else {
        // 非 bridge 入口：直接保留
        realMcpServers[name] = entry;
      }
    }
    t3 = Date.now();
    perfEmitter.duration("engine.extractMcp", t3 - t2);

    if (Object.keys(realMcpServers).length > 0) {
      freshMcpServers = realMcpServers;
      // 暂存到 proxy manager 并启动 bridge
      const { mcpProxyManager } = await import("../packages/mcp");
      // 合并现有配置（保留默认服务如 chrome-devtools）
      mcpProxyManager.setConfig({
        ...mcpProxyManager.getConfig(),
        mcpServers: {
          ...(mcpProxyManager.getConfig().mcpServers || {}),
          ...realMcpServers,
        },
      });
      await mcpProxyManager.ensureBridgeStarted();
      t4 = Date.now();
      perfEmitter.duration("engine.ensureBridge(mcp)", t4 - t3);
      // 获取代理格式的配置（包含 bridge URL 和 allowTools）
      freshMcpServers =
        mcpProxyManager.getAgentMcpConfig(engineKey) || undefined;
    }
  } else {
    // 无动态 MCP 服务器时，仍需确保 bridge 启动（包含默认服务如 chrome-devtools）
    const { mcpProxyManager } = await import("../packages/mcp");
    t3 = Date.now();
    await mcpProxyManager.ensureBridgeStarted();
    t4 = Date.now();
    perfEmitter.duration("engine.ensureBridge(no-mcp)", t4 - t3);
    freshMcpServers = mcpProxyManager.getAgentMcpConfig(engineKey) || undefined;
  }
  return freshMcpServers;
}

/** 合成引擎有效配置（env 合并、OPENCODE_LOG_DIR 本地化、codex workspaceDir 覆盖） */
export function buildEffectiveConfig(args: {
  base: AgentConfig;
  requiredEngine: AgentEngineType | null;
  mp: ModelProviderConfig | undefined;
  model: string | undefined;
  resolvedEnv: Record<string, string> | undefined;
  freshMcpServers: AgentConfig["mcpServers"] | undefined;
  request: ComputerChatRequest;
  engineKey: string;
}): AgentConfig {
  const {
    base,
    requiredEngine,
    mp,
    model,
    resolvedEnv,
    freshMcpServers,
    request,
    engineKey,
  } = args;

  if (!model) {
    log.warn(
      `[UnifiedAgent] ⚠️ Model not set! model_provider.model and agent_config env both have no model info`,
    );
  }

  const mergedEnv = { ...(base.env || {}), ...(resolvedEnv || {}) };

  // OPENCODE_LOG_DIR 容器路径本地化
  if (
    mergedEnv.OPENCODE_LOG_DIR &&
    !fs.existsSync(mergedEnv.OPENCODE_LOG_DIR)
  ) {
    const localLogDir = path.join(os.homedir(), APP_DATA_DIR_NAME, "logs");
    log.info(
      `[UnifiedAgent] 📂 OPENCODE_LOG_DIR localized: ${mergedEnv.OPENCODE_LOG_DIR} → ${localLogDir}`,
    );
    mergedEnv.OPENCODE_LOG_DIR = localLogDir;
  }

  const effectiveConfig: AgentConfig = {
    ...base,
    engine: requiredEngine || base.engine,
    apiKey: mp?.api_key || base.apiKey,
    baseUrl: mp?.base_url || base.baseUrl,
    model,
    apiProtocol: mp?.api_protocol || base.apiProtocol,
    env: mergedEnv,
    mcpServers: freshMcpServers,
  };

  // nuwax-codex-acp ignores ACP session cwd, so we must spawn the process
  // directly in the project workspace to ensure correct working directory
  if (requiredEngine === "codex-cli" && request.project_id && request.user_id) {
    effectiveConfig.workspaceDir = resolveComputerProjectWorkspaceDir(
      effectiveConfig.workspaceDir,
      request.user_id,
      request.project_id,
    );
    fs.mkdirSync(effectiveConfig.workspaceDir, { recursive: true });
    log.info(
      `[UnifiedAgent] 🎯 codex-cli workspaceDir overridden to: ${effectiveConfig.workspaceDir}`,
    );
  }

  log.info(
    `[UnifiedAgent] 📌 Engine config for project ${engineKey}:\n` +
      `├─ engine: ${effectiveConfig.engine}\n` +
      `├─ config.model: ${effectiveConfig.model || "⚠️ not set"}\n` +
      `├─ env OPENCODE_MODEL: ${effectiveConfig.env?.OPENCODE_MODEL || "(not set)"}\n` +
      `├─ env ANTHROPIC_MODEL: ${effectiveConfig.env?.ANTHROPIC_MODEL || "(not set)"}\n` +
      `├─ baseUrl: ${effectiveConfig.baseUrl || "(not set)"}\n` +
      `├─ apiKeySet: ${!!effectiveConfig.apiKey}\n` +
      `└─ mcpServers: ${effectiveConfig.mcpServers ? Object.keys(effectiveConfig.mcpServers).join(", ") : "(none)"}`,
  );

  return effectiveConfig;
}
