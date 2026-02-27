# nuwax-mcp-stdio-proxy

TypeScript stdio MCP proxy — aggregates multiple MCP servers into a single stdio endpoint. Supports **stdio** (spawn child processes) and **bridge** (Streamable HTTP to a persistent MCP bridge).

## Requirements

- **Node.js** >= 22.0.0

## Usage

```bash
nuwax-mcp-stdio-proxy --config '{"mcpServers":{...}}'
```

The proxy reads JSON from `--config` and runs as a stdio MCP server. Upstream servers can be:

- **stdio**: `{ "command", "args?", "env?" }` — proxy spawns a child process and talks MCP over stdin/stdout.
- **bridge**: `{ "url" }` — proxy connects via HTTP (Streamable HTTP) to a long-lived MCP bridge (e.g. Electron app’s PersistentMcpBridge).

## Config format

| Entry type | Shape | Description |
|------------|--------|-------------|
| **stdio** | `{ "command": string, "args"?: string[], "env"?: Record<string, string> }` | Spawn subprocess; MCP over stdio. |
| **bridge** | `{ "url": string }` | Connect to MCP over HTTP (e.g. `http://127.0.0.1:PORT/mcp/<serverId>`). |

Example:

```json
{
  "mcpServers": {
    "filesystem": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-filesystem", "/path/to/allowed"]
    },
    "chrome-devtools": {
      "url": "http://127.0.0.1:57278/mcp/chrome-devtools"
    }
  }
}
```

- `filesystem` → stdio (child process).
- `chrome-devtools` → bridge (HTTP to a persistent bridge).

## Architecture

```
Agent / ACP engine (stdin/stdout)
        ↕
  nuwax-mcp-stdio-proxy (StdioServerTransport)
        ├→ stdio upstream  → child process (StdioClientTransport)
        └→ bridge upstream → StreamableHTTPClientTransport → PersistentMcpBridge HTTP
```

- **Downstream**: one stdio MCP server; the agent talks to the proxy over stdin/stdout.
- **Upstream**: multiple backends — some are child processes (stdio), some are HTTP bridge endpoints. Tools from all upstreams are aggregated and exposed as one tool list.

## Scripts

| Command | Description |
|---------|-------------|
| `npm run build` | Compile TypeScript to `dist/`. |
| `npm run test` | Run tests (Vitest). |
| `npm run test:run` | Run tests once (no watch). |
| `npm run test:coverage` | Run tests with coverage. |

## License

MIT
