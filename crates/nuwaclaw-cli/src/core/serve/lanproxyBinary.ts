import * as fs from "node:fs";
import * as path from "node:path";

/**
 * Unlike codex-acp and nuwax-file-server, lanproxy currently has **no
 * independent distribution channel** — its binaries only exist checked into
 * the Electron client's own resources/lanproxy/binaries/ (confirmed: no npm
 * package, no GitHub Release). There's nothing for nuwaclaw to lazily
 * download.
 *
 * `--lanproxy-path` is therefore not a "before npm publish" escape hatch
 * like --gui-mcp-path — it's the *only* path today. It accepts either a
 * direct binary file, or a directory shaped like the Electron client's
 * resources/lanproxy/binaries/ (this repo's own agent-electron-client crate
 * is a valid value when running from a source checkout).
 */
const RUST_TARGET_MAP: Record<string, string> = {
  "darwin-arm64": "aarch64-apple-darwin",
  "darwin-x64": "x86_64-apple-darwin",
  "win32-x64": "x86_64-pc-windows-msvc",
  "linux-x64": "x86_64-unknown-linux-gnu",
  "linux-arm64": "aarch64-unknown-linux-gnu",
};

function binaryNameForCurrentPlatform(): string {
  const key = `${process.platform}-${process.arch}`;
  const target = RUST_TARGET_MAP[key];
  if (!target) {
    throw new Error(`lanproxy 暂不支持当前平台 (${key})`);
  }
  const ext = process.platform === "win32" ? ".exe" : "";
  return `nuwax-lanproxy-${target}${ext}`;
}

export function resolveLanproxyBinary(pathOverride: string): string {
  if (!fs.existsSync(pathOverride)) {
    throw new Error(`--lanproxy-path 路径不存在: ${pathOverride}`);
  }
  const stat = fs.statSync(pathOverride);
  if (stat.isFile()) return pathOverride;

  const binaryName = binaryNameForCurrentPlatform();
  const candidates = [
    path.join(pathOverride, binaryName),
    path.join(pathOverride, "binaries", binaryName),
    // macOS arm64 often ships a universal binary instead of an arm64-specific one.
    ...(process.platform === "darwin"
      ? [
          path.join(pathOverride, "nuwax-lanproxy-universal-apple-darwin"),
          path.join(
            pathOverride,
            "binaries",
            "nuwax-lanproxy-universal-apple-darwin",
          ),
        ]
      : []),
  ];
  const found = candidates.find((candidate) => fs.existsSync(candidate));
  if (!found) {
    throw new Error(
      `在 --lanproxy-path ${pathOverride} 下未找到 ${binaryName}（也未找到 universal 兜底）。lanproxy 目前没有独立分发渠道，可指向本仓 crates/agent-electron-client/resources/lanproxy/binaries/`,
    );
  }
  return found;
}
