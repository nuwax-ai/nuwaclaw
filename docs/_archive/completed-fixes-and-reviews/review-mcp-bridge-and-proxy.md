# Code Review: MCP Bridge + nuwax-mcp-stdio-proxy 统一方案

## 结论

**整体设计清晰，逻辑正确。** 临时与持久化 server 统一通过单一 `mcp-proxy`（nuwax-mcp-stdio-proxy）聚合，bridge 入口并入 proxy 后不再需要独立 mcp-bridge-client 脚本，可维护性更好。以下为可改进点与注意事项。

---

## 做得好的地方

1. **单一入口**：`getAgentMcpConfig()` 只返回一个 `mcp-proxy`，config 内同时包含 stdio 与 bridge 条目，Agent 只 spawn 一个进程。
2. **健康与 URL**：持久化 server 仅当 `getBridgeUrl(name)` 非空（即 healthy）时才加入 config，避免把不可用 bridge 暴露给引擎。
3. **fallback**：无 proxy 脚本时回退到「仅临时 server 的 stdio 配置」，行为明确。
4. **测试**：mcp.test.ts 覆盖「仅 persistent」「bridge 运行时的 url」「混合临时+持久化」「无 proxy 时 fallback」等场景。
5. **持久化 Bridge**：HTTP body 限制、session 清理、自动重启、stale session 清理等都有考虑。

---

## 建议改进

### 1. `syncMcpConfigToProxyAndReload` 可能丢失 `persistent` 标记

**位置**：`mcp.ts` 中 `syncMcpConfigToProxyAndReload`。

**问题**：入参类型为 `Record<string, { command, args?, env? }>`，没有 `persistent`。内部用 `merged = { ...DEFAULT_MCP_PROXY_CONFIG.mcpServers, ...realOnly }`，若 UI 传入的 `realOnly` 里含有与默认同名的 server（如 `chrome-devtools`）但未带 `persistent: true`，会覆盖默认项，导致该 server 的 `persistent` 被抹掉。

**建议**：  
- 若 UI/调用方会传回完整 server 列表（含是否持久化），在类型中增加 `persistent?: boolean`，并在合并时保留该字段；或  
- 合并时对「已知持久化 server 的 name」做白名单，保留其 `persistent: true`，避免被未带标记的覆盖。

---

### 2. `createHttpSession` 中 `mcpServer.connect(transport)` 未 await

**位置**：`persistentMcpBridge.ts` 第 472–474 行。

**现状**：`mcpServer.connect(transport).catch(...)` 后立即 `return { server, transport }`，调用方可能在 connect 完成前就发请求。

**影响**：取决于 MCP SDK 的 StreamableHTTPServerTransport 是否在「未 connect 完成」时排队或拒绝请求；若首包在 connect 前到达，理论上存在竞态。

**建议**：若 SDK 不保证「首请求一定在 connect 之后」，可考虑改为在 `handleRequest` 前 await 某个「session ready」状态，或文档中注明「首请求可能在 connect 完成前到达，由 transport 内部处理」。

---

### 3. nuwax-mcp-stdio-proxy README 链接

**已处理**：README 中 bridge 示例链接原指向 modelcontextprotocol.io，已改为「Electron app’s PersistentMcpBridge」描述，避免误导。

---

## 边界情况确认

| 场景 | 行为 | 评价 |
|------|------|------|
| 仅有 persistent、bridge 未运行 | `proxyServers` 为空 → 返回 null | ✓ 合理 |
| 仅有 persistent、bridge 运行 | 仅含 `{ url }` 条目，单 proxy 启动 | ✓ 正确 |
| persistentMcpBridge.start() 失败 | 打 log，不抛，主流程继续 | ✓ 可接受；getAgentMcpConfig 仍可能因 isRunning() 为 true 而带 bridge（若 HTTP 已起） |
| 打包后 proxy 脚本路径 | 先 app.getAppPath()，再 app.asar.unpacked | ✓ 与 electron-builder 常见布局一致 |

---

## 小结

- **可合并/发布**：当前实现和测试足以支撑现有用法；上述 1、2 为改进项，非阻断。
- **建议优先**：若 UI 会编辑并回写 MCP 配置，建议按 1 处理 `persistent`，避免用户把 chrome-devtools 改为非持久化后无法恢复。
