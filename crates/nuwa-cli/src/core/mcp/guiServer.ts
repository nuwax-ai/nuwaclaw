import * as fs from "node:fs";
import * as path from "node:path";
import { spawnSync } from "node:child_process";
import type { McpServer } from "@agentclientprotocol/sdk";
import { cliToolsDir, ensureDir } from "../../util/paths.js";

const GUI_AGENT_SERVER_VERSION =
  process.env.NUWACLAW_GUI_AGENT_VERSION || "latest";

function installedEntryPath(): string {
  return path.join(
    cliToolsDir(),
    "node_modules",
    "agent-gui-server",
    "dist",
    "index.js",
  );
}

function resolveDevPathEntry(devPath: string): string {
  const stat = fs.statSync(devPath);
  return stat.isDirectory() ? path.join(devPath, "dist", "index.js") : devPath;
}

/**
 * Locates the agent-gui-server entry point, installing it on first use.
 * `--gui-mcp-path` is an escape hatch for pointing at a local checkout
 * (e.g. crates/agent-gui-server in this repo) before the package is
 * published to npm.
 */
function ensureGuiAgentServerEntry(devPathOverride?: string): string {
  if (devPathOverride) {
    if (!fs.existsSync(devPathOverride)) {
      throw new Error(`--gui-mcp-path 路径不存在: ${devPathOverride}`);
    }
    const entry = resolveDevPathEntry(devPathOverride);
    if (!fs.existsSync(entry)) {
      throw new Error(`--gui-mcp-path 指向的入口不存在: ${entry}`);
    }
    return entry;
  }

  const installed = installedEntryPath();
  if (fs.existsSync(installed)) return installed;

  const toolsDir = cliToolsDir();
  ensureDir(toolsDir);
  if (!fs.existsSync(path.join(toolsDir, "package.json"))) {
    fs.writeFileSync(
      path.join(toolsDir, "package.json"),
      JSON.stringify(
        { name: "nuwa-cli-tools", private: true, version: "0.0.0" },
        null,
        2,
      ),
    );
  }
  console.error(
    `[nuwa-cli] 首次使用 --gui-mcp，正在安装 agent-gui-server@${GUI_AGENT_SERVER_VERSION}...`,
  );
  const result = spawnSync(
    "npm",
    [
      "install",
      `agent-gui-server@${GUI_AGENT_SERVER_VERSION}`,
      "--no-save",
      "--no-audit",
      "--no-fund",
    ],
    { cwd: toolsDir, stdio: "inherit" },
  );
  if (result.status !== 0 || !fs.existsSync(installed)) {
    throw new Error(
      "安装 agent-gui-server 失败（该包可能尚未发布到 npm）。可用 --gui-mcp-path <本仓 crates/agent-gui-server 路径> 指向本地构建产物作为替代。",
    );
  }
  return installed;
}

export interface GuiMcpOptions {
  devPath?: string;
  apiKey?: string;
}

/**
 * Builds the gui-agent MCP server entry to append to session/new or
 * session/load's mcpServers array. Always additive — callers must not
 * replace the user's own configured MCP servers with just this one.
 */
export function buildGuiAgentMcpServer(options: GuiMcpOptions): McpServer {
  const entry = ensureGuiAgentServerEntry(options.devPath);
  return {
    name: "gui-agent",
    command: process.execPath,
    args: [entry, "--transport", "stdio"],
    env: options.apiKey
      ? [{ name: "GUI_AGENT_API_KEY", value: options.apiKey }]
      : [],
  };
}
