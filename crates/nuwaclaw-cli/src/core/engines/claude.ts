import * as fs from "node:fs";
import * as path from "node:path";
import { spawnSync } from "node:child_process";
import pc from "picocolors";
import { cliToolsDir, ensureDir } from "../../util/paths.js";
import { findOnPath } from "../../util/which.js";
import type { EngineSpec, ResolvedEngine } from "./types.js";

/** Pinned to the npm-published version confirmed to exist at plan time; bump deliberately. */
const CLAUDE_CODE_ACP_TS_VERSION = "0.53.0";

function adapterEntryPath(): string {
  return path.join(
    cliToolsDir(),
    "node_modules",
    "claude-code-acp-ts",
    "dist",
    "index.js",
  );
}

/**
 * Installs the ACP adapter (a thin ~300KB JS package) into ~/.nuwaclaw-cli/tools.
 * `--omit=optional` skips the ~210MB platform-specific claude binary that
 * @anthropic-ai/claude-agent-sdk would otherwise pull down — safe because the
 * adapter's own claudeCliPath() checks CLAUDE_CODE_EXECUTABLE first and never
 * touches that fallback when we always set it (see resolveClaudeEngine).
 */
function ensureToolsProjectMarker(toolsDir: string): void {
  // npm walks up from cwd looking for the nearest package.json to use as the
  // install root. Without one here, it would walk past an empty tools dir and
  // pick up ~/.nuwaclaw/package.json (the Electron client's own dependency
  // tree) instead, colliding with its node_modules. A minimal marker here
  // stops the walk exactly where we want it.
  const marker = path.join(toolsDir, "package.json");
  if (fs.existsSync(marker)) return;
  fs.writeFileSync(
    marker,
    JSON.stringify(
      { name: "nuwaclaw-cli-tools", private: true, version: "0.0.0" },
      null,
      2,
    ),
  );
}

function ensureClaudeAdapter(): string {
  const entry = adapterEntryPath();
  if (fs.existsSync(entry)) return entry;

  const toolsDir = cliToolsDir();
  ensureDir(toolsDir);
  ensureToolsProjectMarker(toolsDir);
  console.error(
    pc.dim(
      `[nuwaclaw] 首次使用 claude 引擎，正在安装适配器 claude-code-acp-ts@${CLAUDE_CODE_ACP_TS_VERSION}...`,
    ),
  );
  const result = spawnSync(
    "npm",
    [
      "install",
      `claude-code-acp-ts@${CLAUDE_CODE_ACP_TS_VERSION}`,
      "--omit=optional",
      "--no-save",
      "--no-audit",
      "--no-fund",
    ],
    { cwd: toolsDir, stdio: "inherit" },
  );
  if (result.status !== 0) {
    throw new Error("安装 claude-code-acp-ts 失败，请检查网络或 npm 镜像配置");
  }
  if (!fs.existsSync(entry)) {
    throw new Error(`安装完成但未找到适配器入口: ${entry}`);
  }
  return entry;
}

export const claudeEngine: EngineSpec = {
  id: "claude",
  async resolve(): Promise<ResolvedEngine> {
    const claudeBin = findOnPath("claude");
    if (!claudeBin) {
      throw new Error(
        "未找到 claude CLI。请先安装并登录：https://docs.claude.com/claude-code（可运行 `nuwaclaw doctor` 复核）",
      );
    }
    const entry = ensureClaudeAdapter();
    return {
      command: process.execPath,
      args: [entry],
      envOverlay: { CLAUDE_CODE_EXECUTABLE: claudeBin },
    };
  },
};
