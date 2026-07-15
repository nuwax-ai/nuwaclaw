import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * lanproxy is the only component that is expected to come from a preintegrated
 * client resource. ACP adapters and file-server are normal npm package
 * dependencies; lanproxy has no npm package or GitHub Release to fetch from,
 * so the only supported source is an existing binary or the Electron client's
 * resources/lanproxy/binaries/ directory.
 */
const RUST_TARGET_MAP: Record<string, string> = {
  "darwin-arm64": "aarch64-apple-darwin",
  "darwin-x64": "x86_64-apple-darwin",
  "win32-x64": "x86_64-pc-windows-msvc",
  "linux-x64": "x86_64-unknown-linux-gnu",
  "linux-arm64": "aarch64-unknown-linux-gnu",
};

const DEFAULT_LANPROXY_PATH_CANDIDATES = [
  () => process.env.NUWACLI_LANPROXY_PATH,
  () =>
    path.join(
      path.dirname(fileURLToPath(import.meta.url)),
      "resources",
      "lanproxy",
    ),
  () => path.join(os.homedir(), ".nuwa-cli", "lanproxy"),
  () => path.join(process.cwd(), "resources", "lanproxy"),
];

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
      `在 --lanproxy-path ${pathOverride} 下未找到 ${binaryName}（也未找到 universal 兜底）。可指向 nuwa-cli/resources/lanproxy 或单个 nuwax-lanproxy 二进制。`,
    );
  }
  return found;
}

export function resolveDefaultLanproxyBinary(): string {
  const tried: string[] = [];
  for (const candidateFactory of DEFAULT_LANPROXY_PATH_CANDIDATES) {
    const candidate = candidateFactory();
    if (!candidate) continue;
    tried.push(candidate);
    if (!fs.existsSync(candidate)) continue;
    try {
      return resolveLanproxyBinary(candidate);
    } catch {
      // Try the next conventional location.
    }
  }
  throw new Error(
    `未找到 lanproxy 预置二进制。请通过 --lanproxy-path 指向二进制或 resources/lanproxy 目录，或设置 NUWACLI_LANPROXY_PATH。已尝试：${tried.join(", ")}`,
  );
}
