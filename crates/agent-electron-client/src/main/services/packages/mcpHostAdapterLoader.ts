import * as fs from "fs";
import * as path from "path";
import type * as McpProxyHost from "@nuwax-ai/mcp-proxy-ts/host";
import { getBundledMcpProxyDir } from "./packageLocator";

let cachedHostAdapter: typeof McpProxyHost | null = null;

/** Load the extraResource host adapter without introducing a packaged bare import. */
export function loadMcpProxyHostAdapter(): typeof McpProxyHost {
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

  const hostModule = path.join(dir, "dist", "host", "rewrite.js");
  if (!fs.existsSync(hostModule)) {
    throw new Error(
      `[McpProxy] Host adapter missing: ${hostModule}; run \`npm run prepare:mcp-proxy\``,
    );
  }
  // Packaged extraResources live outside the bundle, so this boundary must load
  // the resolved runtime file dynamically rather than through a bare import.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  cachedHostAdapter = require(hostModule) as typeof McpProxyHost;
  return cachedHostAdapter;
}
