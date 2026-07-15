import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { resolveInstalledPackageEntry } from "./packageResolve.js";
import type { EngineSpec, ResolvedEngine } from "./types.js";

const NUWAX_CODEX_ACP_ENTRY = "nuwax-codex-acp/bin/nuwax-codex-acp.js";

export const codexEngine: EngineSpec = {
  id: "codex",
  async resolve(): Promise<ResolvedEngine> {
    // nuwax-codex-acp is a package dependency; its wrapper resolves the
    // matching platform binary from optionalDependencies.
    const authFile = path.join(os.homedir(), ".codex", "auth.json");
    if (!fs.existsSync(authFile)) {
      throw new Error(
        "未检测到 ~/.codex/auth.json。请先用 `codex login`（或 Codex Desktop / VS Code 插件）登录一次（可运行 `nuwa-cli doctor` 复核）",
      );
    }
    const entry = resolveInstalledPackageEntry(
      "nuwax-codex-acp",
      NUWAX_CODEX_ACP_ENTRY,
    );
    return {
      command: process.execPath,
      args: [entry],
      envOverlay: {},
    };
  },
};
