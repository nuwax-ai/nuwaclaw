# codex-acp OpenAI-Compatible Routing

Last updated: 2026-05-14

## 背景

NuwaClaw 的 `codex-cli` 引擎实际通过 `codex-acp` 运行。国内 OpenAI 协议模型需要走本地 gateway 的 `chat2response` 兼容层：

```text
NuwaClaw Electron -> codex-acp -> local gateway /chat2response/v1 -> upstream OpenAI-compatible /chat/completions
```

本次修复的直接问题是 `glm-5` 被 codex-acp 内部默认模型覆盖，最终向上游发送了 `gpt-5.1-codex-max`，触发：

```json
{"error":{"code":"1211","message":"模型不存在，请检查模型代码。"}}
```

后续验证还发现两个运行时问题：

- codex-acp 会优先尝试 WebSocket，gateway 对 `/v1/responses` 的 WebSocket GET 返回 404。
- gateway 的 chat2response 插件为了覆盖模型提前读取了请求体，upstream Express body-parser 再次读取时触发 `stream is not readable`。

## 最终约定

NuwaClaw 和 codex-acp 之间只通过环境变量传递运行时模型配置，不写入 `config.toml`，不落盘保存密钥。

| 变量 | 生产者 | 消费者 | 含义 |
| --- | --- | --- | --- |
| `CODEX_MODEL` | NuwaClaw | codex-acp, gateway | provider 原始模型名，例如 `glm-5` |
| `CODEX_BASE_URL` | NuwaClaw | codex-acp | 本地 Responses 兼容地址，例如 `http://127.0.0.1:60009/chat2response/v1` |
| `CODEX_API_KEY` | NuwaClaw | codex-acp | 上游模型 provider key |
| `OPENAI_BASE_URL` | NuwaClaw | gateway chat2response | 上游 OpenAI-compatible base URL |
| `OPENAI_API_KEY` | NuwaClaw | gateway chat2response, codex-acp auth | 上游模型 provider key |
| `OPENAI_MODEL` | NuwaClaw | gateway chat2response | provider 原始模型名 |

模型解析优先级为：

```text
agent_server.env model override
  -> model_provider.model
  -> model_provider.default_model
```

支持的 env model override 包括 `OPENCODE_MODEL`、`ANTHROPIC_MODEL`、`CODEX_MODEL`。如果模型带 `openai-compatible/` 前缀，NuwaClaw 保留 raw model 用于识别路由，但传给 provider 的模型会剥离前缀：

```text
openai-compatible/glm-5 -> glm-5
```

## NuwaClaw 侧实现

### 模型解析

`crates/agent-electron-client/src/main/services/engines/acp/openAICompatRouting.ts`

- 新增 `resolveOpenAICompatModel`。
- env model override 优先于 fallback/default model，避免 agent 显式选择的模型被覆盖。
- `applyOpenAICompatibleEnv` 用统一的解析结果判断是否启用 OpenAI-compatible 路由。

### 统一入口

`crates/agent-electron-client/src/main/services/engines/unifiedAgent.ts`

- 在收到远端 `agent_config.agent_server.env` 后先解析 env。
- 用解析出的 provider model 启动 gateway。
- 对 `codex-cli` 保证 `model_provider.default_model` 也能参与路由。

### ACP 进程环境

`crates/agent-electron-client/src/main/services/engines/acp/acpClient.ts`

- 对 `codex` / `codex-cli` 注入：
  - `CODEX_API_KEY`
  - `OPENAI_API_KEY`
  - `CODEX_MODEL`
  - `CODEX_BASE_URL`
- `CODEX_BASE_URL` 使用 `applyOpenAICompatibleEnv` 后的最终地址，OpenAI-compatible 模型走本地 gateway。
- 支持 `NUWACLAW_CODEX_ACP_BIN` / `CODEX_ACP_BIN` 覆盖 codex-acp 二进制，便于本地验证 fork。

### gateway 启动

`crates/agent-electron-client/src/main/services/packages/gatewayServer.ts`

- gateway runtime config 包含 `apiKey`、`baseUrl`、`model`。
- 这些配置变化时重启 gateway。
- 启动 gateway 时注入 `OPENAI_BASE_URL`、`OPENAI_API_KEY`、`CODEX_API_KEY`、`CODEX_MODEL`、`OPENAI_MODEL`。

## gateway 兼容层实现

`crates/gateway-server/lib/plugins/chat2response.js`

- 启动 chat2response 时动态注入 `openai` provider，让它使用 `OPENAI_BASE_URL` 和 `OPENAI_API_KEY`。
- 请求 `/v1/responses` 时用 `CODEX_MODEL` / `OPENAI_MODEL` 覆盖 body 里的 `model`。
- 覆盖模型后不再把请求体重新伪造成可读流，而是创建 body-parser 兼容 request proxy：
  - `req.body` 返回已解析并改写的 body。
  - `req._body` 返回 `true`，让 Express body-parser 跳过二次读取。
  - 移除旧 `content-length`，并补 `x-provider: openai`，避免 `glm-5` 被 chat2response 自动分配到内置 `glm` provider。

`crates/agent-electron-client/resources/gateway/` 是 prepare 后的运行时资源目录，仓库提交以 `crates/gateway-server` 为源。全新 prepare 或打包时会从 gateway-server 源目录生成 runtime 资源。

## codex-acp fork 实现

仓库：`/Users/apple/workspace/codex-acp`

`src/lib.rs`

- `Config` 加载完成后无条件应用 NuwaClaw env override。
- `CODEX_API_KEY` 映射为 `OPENAI_API_KEY`，让 Codex auth 逻辑正常读取。
- `CODEX_MODEL` 无条件覆盖 `config.model`，并剥离 `openai-compatible/` 前缀。
- `CODEX_BASE_URL` 创建自定义 provider：
  - `model_provider_id = "nuwaclaw-openai-compatible"`
  - `base_url = CODEX_BASE_URL`
  - `env_key = OPENAI_API_KEY`
  - `wire_api = Responses`
  - `requires_openai_auth = false`
  - `supports_websockets = false`

禁用 WebSocket 是必要的，因为本地 gateway 只实现 HTTP Responses 兼容入口。

`Cargo.toml`

- 增加 `codex-model-provider-info` 依赖，用于构造 provider 信息。

## 验证

已执行：

```bash
cd /Users/apple/workspace/codex-acp
cargo test normalize_model_strips_openai_compatible_prefix
cargo build --release

cd /Users/apple/workspace/nuwaclaw/crates/agent-electron-client
npm run test:run -- src/main/services/engines/acp/acpClient.test.ts
npm run build:main:dev

cd /Users/apple/workspace/nuwaclaw
git diff --check
```

额外 smoke 验证：

- 本地 mock OpenAI-compatible `/chat/completions`。
- gateway `/chat2response/v1/responses` 返回 200。
- 实际转发到 mock 的模型为 `glm-5`。
- 响应中不再出现 `stream is not readable`。

开发启动命令：

```bash
make electron-dev
```

`make electron-dev` 会通过 `electron-prepare-codex-acp` 调用 `prepare:codex-acp`，默认从 `dongdada29/codex-acp` 的 `v0.4.5` release 下载已集成 NuwaClaw env override 的 `codex-acp` 二进制。`CODEX_ACP_BIN` / `NUWACLAW_CODEX_ACP_BIN` 仅保留为本地临时调试入口，正常开发和打包不依赖该覆盖变量。

## 已知非阻塞日志

`Model metadata for glm-5 not found. Defaulting to fallback metadata` 来自 Codex 模型元数据表未包含 `glm-5`。本次修复后该日志不再影响路由正确性，但可能影响 token 预算或能力标记。后续如果需要进一步优化，可以在 codex-acp 侧补国内模型 metadata 映射。
