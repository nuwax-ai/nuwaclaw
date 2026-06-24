/**
 * ACP newSession 请求参数构建（纯构建逻辑，无 I/O 副作用*）
 *
 * 从 AcpEngine.createSession 提取：MCP server 聚合转换、GUI MCP 注入与
 * sandbox 互斥、沙箱 MCP 注入、_meta 构建（systemPrompt / requestId /
 * disallowedTools / ripgrep）。
 *
 * *getRipgrepBinPath/fs.existsSync 为只读探测；injectSandboxedMcpForSession
 *  仅向传入的 mcpServers 数组追加条目。
 */

import * as path from "path";
import * as fs from "fs";
import log from "electron-log";
import { FEATURES } from "@shared/featureFlags";
import { GUI_MCP_SERVER_ID } from "@shared/constants";
import { isGuiMcpManagedServerId } from "@shared/guiMcp";
import { getGuiAgentServerUrl } from "@main/services/packages/guiAgentServer";
import { getWindowsMcpUrl } from "@main/services/packages/windowsMcp";
import { isWindows } from "@main/services/system/shellEnv";
import {
  getResourcesPath,
  getRipgrepBinPath,
} from "@main/services/system/dependencies";
import type { SandboxProcessConfig } from "@shared/types/sandbox";
import type { AgentConfig, AgentEngineType } from "../types";
import type { AcpMcpServer, AcpEnvVariable } from "./acpClient";
import { injectSandboxedMcpForSession } from "./sandbox/acpSandboxedMcpSession";
import {
  allocateAcpMcpServerName,
  peekAcpMcpServerName,
} from "@main/services/utils/mcpServerName";

export interface NewSessionMcpServerInput {
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  url?: string;
  type?: string;
}

export interface NewSessionOpts {
  title?: string;
  cwd?: string;
  mcpServers?: Record<string, NewSessionMcpServerInput>;
  systemPrompt?: string;
  requestId?: string;
}

export interface NewSessionParamsContext {
  config: AgentConfig;
  storedSandboxConfig: SandboxProcessConfig | null;
  engineName: AgentEngineType;
  logTag: string;
}

export interface BuiltNewSessionParams {
  sessionCwd: string;
  mcpServers: AcpMcpServer[];
  _meta: Record<string, unknown> | undefined;
}

function toAcpMcpServer(
  name: string,
  srv: NewSessionMcpServerInput,
): AcpMcpServer {
  if ("url" in srv && srv.url) {
    return {
      name,
      url: srv.url,
      headers: [],
      type: (srv.type || "http") as "http" | "sse",
    };
  }
  // stdio 类型（降级）
  const envVars: AcpEnvVariable[] = [];
  if (srv.env) {
    for (const [k, v] of Object.entries(srv.env)) {
      envVars.push({ name: k, value: v });
    }
  }
  if (!srv.command) {
    throw new Error(
      `[toAcpMcpServer] MCP server "${name}" has no command and no valid url — skipping`,
    );
  }
  return {
    name,
    command: srv.command,
    args: srv.args || [],
    env: envVars,
  };
}

/**
 * 将 MCP server 加入 ACP 列表：规范 server 名（中文 → `_`）并去重。
 * 本地配置保留原始名；仅 ACP 下发侧替换，与 deepagents-flow-ts 消费侧规则一致。
 */
function pushAcpMcpServer(
  mcpServers: AcpMcpServer[],
  usedNames: Set<string>,
  rawName: string,
  srv: NewSessionMcpServerInput,
  logTag: string,
): void {
  const { name, sanitized } = allocateAcpMcpServerName(rawName, usedNames);
  if (sanitized) {
    log.warn(
      `${logTag} MCP server name sanitized for ACP (LLM tool name compatibility)`,
      { rawName, name },
    );
  }
  mcpServers.push(toAcpMcpServer(name, srv));
}

export function buildNewSessionParams(
  opts: NewSessionOpts | undefined,
  ctx: NewSessionParamsContext,
): BuiltNewSessionParams {
  const { config, storedSandboxConfig, engineName, logTag } = ctx;

  // Build mcpServers array for ACP (McpServerStdio format)
  const mcpServers: AcpMcpServer[] = [];
  const usedMcpNames = new Set<string>();

  // 1. Global MCP servers from config
  if (config.mcpServers) {
    for (const [name, srv] of Object.entries(config.mcpServers)) {
      pushAcpMcpServer(mcpServers, usedMcpNames, name, srv, logTag);
    }
  }

  // 2. Per-request MCP servers
  if (opts?.mcpServers) {
    for (const [name, srv] of Object.entries(opts.mcpServers)) {
      const canonical = peekAcpMcpServerName(name, usedMcpNames);
      if (mcpServers.some((m) => m.name === canonical)) continue;
      pushAcpMcpServer(mcpServers, usedMcpNames, name, srv, logTag);
    }
  }

  const sandboxEnabled = storedSandboxConfig?.enabled === true;
  const sandboxMode = storedSandboxConfig?.mode ?? "compat";
  const isStrictOrCompat = sandboxMode !== "permissive";
  const sessionCwd = (() => {
    const raw = opts?.cwd || config.workspaceDir;
    if (path.isAbsolute(raw)) return raw;
    log.warn(`${logTag} sessionCwd is not absolute (${raw}), resolving`);
    return path.resolve(raw);
  })();

  // GUI MCP (gui-agent) and sandbox are mutually exclusive for now.
  // Drop gui-agent from both global and per-request MCP inputs when sandbox is on.
  if (sandboxEnabled) {
    const before = mcpServers.length;
    const filtered = mcpServers.filter(
      (server) => !isGuiMcpManagedServerId(server.name),
    );
    const removed = before - filtered.length;
    if (removed > 0) {
      mcpServers.length = 0;
      mcpServers.push(...filtered);
      log.warn(
        `${logTag} Removed gui-agent MCP from session request because sandbox is enabled`,
        { removed },
      );
    }
  }

  // [临时测试代码 - 正式发布前将 .env.production 中 INJECT_GUI_MCP 设为 false]
  // 通过 FEATURES.INJECT_GUI_MCP 控制是否注入 GUI Agent MCP（由 .env.development/.env.production 在运行时决定）
  // 用于本地开发/打包测试 GUI 桌面自动化功能，正式发布时由服务器下发 context_servers
  // macOS/Linux：内嵌 agent-gui-server → getGuiAgentServerUrl()
  // Windows：独立 windows-mcp 子进程（uv）→ getWindowsMcpUrl()；getGuiAgentServerUrl() 在 Win 上恒为 null
  if (
    FEATURES.INJECT_GUI_MCP &&
    !sandboxEnabled &&
    !mcpServers.some((m) => isGuiMcpManagedServerId(m.name))
  ) {
    const guiMcpUrl = isWindows() ? getWindowsMcpUrl() : getGuiAgentServerUrl();
    if (guiMcpUrl) {
      mcpServers.push({
        name: GUI_MCP_SERVER_ID,
        url: guiMcpUrl,
        headers: [],
        type: "http",
      });
      log.info(`${logTag} 🔧 Injecting GUI Agent MCP: ${guiMcpUrl}`);
    }
  } else if (FEATURES.INJECT_GUI_MCP && sandboxEnabled) {
    log.info(
      `${logTag} Skip GUI Agent MCP injection because sandbox is enabled`,
    );
  }

  const { sandboxedBashInjected, sandboxedFsInjected } =
    injectSandboxedMcpForSession({
      engineId: engineName,
      logTag,
      sandboxConfig: storedSandboxConfig,
      sessionCwd,
      mcpServers,
      resourcesPath: getResourcesPath(),
    });

  // Build _meta with systemPrompt if provided (skip if empty or whitespace only)
  const systemPromptTrimmed = opts?.systemPrompt?.trim();
  const requestId = opts?.requestId;
  const isSandboxed =
    storedSandboxConfig?.enabled === true &&
    storedSandboxConfig.type !== "none";

  const _meta: Record<string, unknown> | undefined = (() => {
    const meta: Record<string, unknown> = {};
    if (systemPromptTrimmed) {
      meta.systemPrompt = { append: systemPromptTrimmed };
    }
    if (requestId) {
      meta.requestId = requestId;
      meta.request_id = requestId;
    }
    // Optionally disable built-in Claude Code tools when sandbox MCP replacements exist.
    // claude-code-acp-ts reads _meta.claudeCode.options.disallowedTools and merges
    // with its default disallowedTools (["AskUserQuestion"]).
    // - Bash: disallowed only if sandboxed-bash MCP was injected (Windows + helper + script).
    // - Write/Edit/NotebookEdit: in strict/compat, disallowed only if sandboxed-fs MCP
    //   was injected; if the FS script is missing we keep built-ins so the session can still write.
    // - Permissive mode: built-in Write/Edit/NotebookEdit stay available (no FS MCP injection).
    if (isSandboxed) {
      const disallowed: string[] = [];
      // Bash: only list as disallowed when sandboxed-bash MCP was actually injected
      // (Windows helper path). macOS/Linux rely on seatbelt/bwrap for shell, not this MCP.
      if (sandboxedBashInjected) {
        disallowed.push("Bash");
      }
      // Write/Edit: only disable built-ins when sandboxed-fs MCP is present; otherwise
      // the model would have no file-write path in strict/compat.
      if (isStrictOrCompat) {
        if (sandboxedFsInjected) {
          disallowed.push("Write", "Edit", "NotebookEdit");
        } else {
          log.warn(
            `${logTag} Sandboxed FS MCP unavailable, keep built-in Write/Edit tools`,
          );
        }
      }
      if (disallowed.length > 0) {
        meta.claudeCode = {
          options: {
            disallowedTools: disallowed,
          },
        };
      }
    }

    // Inject bundled ripgrep path into SDK sandbox config so GrepTool/GlobTool
    // can find rg without relying on PATH inheritance in child shells.
    try {
      const rgPath = getRipgrepBinPath();
      if (fs.existsSync(rgPath)) {
        const cc = (meta.claudeCode ??= {}) as Record<string, unknown>;
        const ccOpts = (cc.options ??= {}) as Record<string, unknown>;
        ccOpts.sandbox = {
          ...(ccOpts.sandbox as Record<string, unknown> | undefined),
          ripgrep: { command: rgPath },
        };
        log.info(
          `${logTag} Injected bundled ripgrep into SDK sandbox config: ${rgPath}`,
        );
      }
    } catch {
      // bundled ripgrep optional
    }

    return Object.keys(meta).length > 0 ? meta : undefined;
  })();

  return { sessionCwd, mcpServers, _meta };
}
