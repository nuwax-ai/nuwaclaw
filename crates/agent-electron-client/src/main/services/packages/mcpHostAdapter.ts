import * as path from "path";
import * as fs from "fs";
import { getBundledMcpProxyDir } from "./packageLocator";
import type * as McpProxyHost from "@nuwax-ai/mcp-proxy-ts/host";

let cachedHostAdapter: typeof McpProxyHost | null = null;

/** 从 extraResources 延迟加载自包含的原生 ESM，避开 bridge/SDK 的打包循环。 */
export function loadHostAdapter(): typeof McpProxyHost {
  if (cachedHostAdapter) return cachedHostAdapter;
  const localDev = process.env.NUWAX_MCP_PROXY_LOCAL_PATH;
  const dir =
    (localDev && fs.existsSync(path.join(localDev, "package.json"))
      ? localDev
      : null) ?? getBundledMcpProxyDir();
  if (!dir) {
    throw new Error(
      "[McpProxy] @nuwax-ai/mcp-proxy-ts not found; run `npm run prepare:mcp-proxy`",
    );
  }
  // prepare:mcp-proxy 为此目录写入 type=module；Node 22+/Electron 可同步 require
  // 无 top-level await 的 ESM。直接读取 rewrite.js，避免 host/index 引入 bridge。
  const hostModule = path.join(dir, "dist", "host", "rewrite.js");
  if (!fs.existsSync(hostModule)) {
    throw new Error(
      `[McpProxy] Host adapter missing: ${hostModule}; run \`npm run prepare:mcp-proxy\``,
    );
  }
  cachedHostAdapter = require(hostModule) as typeof McpProxyHost;
  return cachedHostAdapter;
}
