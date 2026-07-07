import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { ensureCodexAcpBinary } from "./codexDownload.js";
import type { EngineSpec, ResolvedEngine } from "./types.js";

export const codexEngine: EngineSpec = {
  id: "codex",
  async resolve(): Promise<ResolvedEngine> {
    // nuwax-codex-acp embeds codex-core directly (it's a fork of codex-acp
    // built against the same Rust crate the official `codex` CLI uses) — it
    // does not shell out to a separate `codex` binary. The real prerequisite
    // is ~/.codex/auth.json, which HOME-inheritance makes visible to it,
    // regardless of which tool (codex CLI, Codex Desktop, VS Code extension)
    // originally produced it.
    const authFile = path.join(os.homedir(), ".codex", "auth.json");
    if (!fs.existsSync(authFile)) {
      throw new Error(
        "未检测到 ~/.codex/auth.json。请先用 `codex login`（或 Codex Desktop / VS Code 插件）登录一次（可运行 `nuwaclaw doctor` 复核）",
      );
    }
    const binPath = await ensureCodexAcpBinary();
    return {
      command: binPath,
      args: [],
      envOverlay: {},
    };
  },
};
