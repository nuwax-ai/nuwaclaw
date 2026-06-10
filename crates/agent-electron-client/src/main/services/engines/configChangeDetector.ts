/**
 * 引擎配置变更检测（从 UnifiedAgentService.detectConfigChange 提取的纯比较逻辑）
 *
 * 比较运行中引擎的存量配置与本次请求解析出的候选配置，
 * 判断是否需要销毁重建引擎。调用方负责提供存量快照。
 */

import * as fs from "fs";
import log from "electron-log";
import type { ModelProviderConfig } from "@shared/types/computerTypes";
import type { McpServerEntry } from "../packages/mcp";
import { rawMcpServersEqual } from "../packages/mcpHelpers";
import { normalizeLogDirInEnv } from "./utils/normalizeLogDir";
import type { AgentConfig, AgentEngineType } from "./types";

type EnvRecord = Record<string, string | undefined>;

/** 敏感字段（仅日志脱敏用，不影响任何业务判断） */
const isSensitiveEnvKey = (key: string) =>
  /(key|token|secret|password|authorization|credential)/i.test(key);

export interface ConfigChangeCandidate {
  requiredEngine: AgentEngineType | null;
  resolvedEnv?: Record<string, string>;
  model?: string;
  mp?: ModelProviderConfig;
  requestMcpServersEarly: Record<string, McpServerEntry>;
}

export interface ConfigChangeStored {
  /** 仅用于日志定位 */
  projectId: string;
  /** 运行中引擎的有效配置快照（engineConfigs.get(projectId) || baseConfig） */
  currentConfig: AgentConfig | null;
  /** 上次请求的原始 MCP servers 快照（engineRawMcpServers.get(projectId)） */
  storedRawMcp: Record<string, McpServerEntry> | undefined;
}

export function detectEngineConfigChange(
  stored: ConfigChangeStored,
  params: ConfigChangeCandidate,
): boolean {
  const { requiredEngine, resolvedEnv, model, mp, requestMcpServersEarly } =
    params;
  const { projectId, currentConfig, storedRawMcp } = stored;

  const needsSwitch =
    !!requiredEngine && requiredEngine !== currentConfig?.engine;

  // 先对 resolvedEnv 进行本地化处理（与 requestConfigResolver 中的逻辑一致）
  // 避免因为路径本地化导致的误判
  const normalizedResolvedEnv = normalizeLogDirInEnv(resolvedEnv);

  // JSON.stringify 会静默丢弃 undefined 值的 key，导致 {A: undefined, B: 'x'} 与 {B: 'x'} 等价。
  // 显式过滤 undefined 值后再比较，确保语义一致。
  const stripUndefined = (env?: Record<string, string | undefined>) => {
    if (!env) return {};
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(env)) {
      if (v !== undefined) out[k] = v;
    }
    return out;
  };
  const currentEnvStr = currentConfig?.env
    ? JSON.stringify(
        stripUndefined(currentConfig.env),
        Object.keys(stripUndefined(currentConfig.env)).sort(),
      )
    : "";
  const newEnvStr = normalizedResolvedEnv
    ? JSON.stringify(
        stripUndefined(normalizedResolvedEnv),
        Object.keys(stripUndefined(normalizedResolvedEnv)).sort(),
      )
    : "";
  const envChanged = !!normalizedResolvedEnv && newEnvStr !== currentEnvStr;

  const modelChanged = !!model && model !== (currentConfig?.model || "");
  // 使用 != null 而非 !!，避免空字符串 '' 被当作"无变更"——api_key 从有效值变为空串应触发重建
  const apiKeyChanged =
    mp?.api_key != null && mp.api_key !== (currentConfig?.apiKey || "");
  const baseUrlChanged =
    mp?.base_url != null && mp.base_url !== (currentConfig?.baseUrl || "");

  // MCP servers 变更检测 — caller (unifiedAgent.ts) 已过滤掉 mcp-proxy bridge 入口，
  // requestMcpServersEarly 为原始格式（command=uvx/npx/...），与上次请求的原始配置做同格式比较。
  const requestMcpServers = requestMcpServersEarly;
  const mcpChanged = !rawMcpServersEqual(requestMcpServers, storedRawMcp);

  const result =
    needsSwitch ||
    envChanged ||
    modelChanged ||
    apiKeyChanged ||
    baseUrlChanged ||
    mcpChanged;

  // 调试日志：输出触发配置变更的具体原因
  if (result) {
    // 计算环境变量差异（敏感字段仅记录掩码，避免日志泄露 secret/token/apiKey）。
    const envDiffDetails: Record<string, unknown> = {};
    if (envChanged && resolvedEnv && currentConfig?.env) {
      const currentEnv = currentConfig.env as EnvRecord;
      const allKeys = new Set([
        ...Object.keys(currentEnv),
        ...Object.keys(resolvedEnv),
      ]);
      const normalizeEnvValue = (key: string, value: string | undefined) => {
        if (isSensitiveEnvKey(key)) return "***";
        if (typeof value !== "string") return value;
        return value.length > 50 ? value.slice(0, 50) + "..." : value;
      };
      for (const key of allKeys) {
        const oldVal = currentEnv[key];
        const newVal = resolvedEnv[key];
        if (oldVal !== newVal) {
          envDiffDetails[key] = {
            old: normalizeEnvValue(key, oldVal),
            new: normalizeEnvValue(key, newVal),
          };
        }
      }
    } else if (envChanged && resolvedEnv && !currentConfig?.env) {
      envDiffDetails["reason"] =
        "currentConfig.env is empty but resolvedEnv has values";
      // 过滤敏感 key 名，避免泄露业务特征
      envDiffDetails["resolvedEnvKeys"] = Object.keys(resolvedEnv).filter(
        (k) => !isSensitiveEnvKey(k),
      );
    }
    log.info(
      `[UnifiedAgent] 🔍 detectConfigChange(${projectId}): ${result ? "CHANGED" : "unchanged"}`,
      {
        needsSwitch,
        envChanged,
        modelChanged,
        apiKeyChanged,
        baseUrlChanged,
        mcpChanged,
        details: {
          currentModel: currentConfig?.model,
          newModel: model,
          currentApiKeyLen: currentConfig?.apiKey?.length,
          newApiKeyLen: mp?.api_key?.length,
          currentBaseUrl: currentConfig?.baseUrl,
          newBaseUrl: mp?.base_url,
          storedMcpKeys: storedRawMcp ? Object.keys(storedRawMcp) : "(none)",
          requestMcpKeys: Object.keys(requestMcpServers),
          currentEnvKeys: currentConfig?.env
            ? Object.keys(currentConfig.env)
            : "(none)",
          resolvedEnvKeys: resolvedEnv ? Object.keys(resolvedEnv) : "(none)",
          envDiff:
            Object.keys(envDiffDetails).length > 0
              ? envDiffDetails
              : "(no diff)",
        },
      },
    );
  }

  return result;
}
