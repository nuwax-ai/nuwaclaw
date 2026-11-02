/**
 * macOS seatbelt strict：session/new 需 spawn bundled node + @nuwax-ai/mcp-proxy-ts。
 * strict 默认仅允许引擎本体 exec，此处解析 MCP 工具链所需的最小路径集。
 */

import * as fs from "fs";
import * as path from "path";
import {
  getNodeBinPathWithFallback,
  getResourcesPath,
  getRipgrepBinPath,
  getUvBinPath,
} from "@main/services/system/dependencies";

function pushIfExists(target: string[], candidate: string): void {
  if (!candidate) return;
  try {
    if (fs.existsSync(candidate)) {
      target.push(candidate);
    }
  } catch {
    // ignore stat errors
  }
}

/**
 * strict seatbelt 下额外允许 process-exec 的二进制（literal）。
 */
export function resolveMacOsStrictMcpExecAllowlist(): string[] {
  const literals: string[] = [];
  const nodePath = getNodeBinPathWithFallback();
  pushIfExists(literals, nodePath ?? "");

  const proxyIndex = path.join(
    getResourcesPath(),
    "mcp-proxy-ts",
    "dist",
    "index.js",
  );
  pushIfExists(literals, proxyIndex);

  pushIfExists(literals, getUvBinPath());
  pushIfExists(literals, getRipgrepBinPath());

  return [...new Set(literals)];
}

/**
 * strict seatbelt 下 MCP 子进程需读/执行的资源目录（file-write* + process-exec subpath）。
 */
export function resolveMacOsStrictMcpResourceSubpaths(): string[] {
  const resourcesPath = getResourcesPath();
  const subpaths: string[] = [];

  pushIfExists(subpaths, path.join(resourcesPath, "mcp-proxy-ts", "dist"));
  pushIfExists(subpaths, path.join(resourcesPath, "mcp-proxy-ts"));

  const nodePath = getNodeBinPathWithFallback();
  if (nodePath) {
    pushIfExists(subpaths, path.dirname(nodePath));
    // platform bundle root, e.g. resources/node/darwin-arm64
    pushIfExists(subpaths, path.dirname(path.dirname(nodePath)));
  }

  pushIfExists(subpaths, path.join(resourcesPath, "node"));

  pushIfExists(subpaths, path.join(resourcesPath, "ripgrep"));

  return [...new Set(subpaths)];
}
