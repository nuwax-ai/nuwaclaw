import { findOnPath } from "../../util/which.js";
import { resolveInstalledPackageEntry } from "./packageResolve.js";
import type { EngineSpec, ResolvedEngine } from "./types.js";

const CLAUDE_CODE_ACP_ENTRY = "claude-code-acp-ts/dist/index.js";

export const claudeEngine: EngineSpec = {
  id: "claude",
  async resolve(): Promise<ResolvedEngine> {
    const claudeBin = findOnPath("claude");
    if (!claudeBin) {
      throw new Error(
        "未找到 claude CLI。请先安装并登录：https://docs.claude.com/claude-code（可运行 `nuwa-cli doctor` 复核）",
      );
    }
    const entry = resolveInstalledPackageEntry(
      "claude-code-acp-ts",
      CLAUDE_CODE_ACP_ENTRY,
    );
    return {
      command: process.execPath,
      args: [entry],
      envOverlay: { CLAUDE_CODE_EXECUTABLE: claudeBin },
    };
  },
};
