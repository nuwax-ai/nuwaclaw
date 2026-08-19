# codex-acp OpenAI-Compatible Routing

Last updated: 2026-05-18

## Current Contract

NuwaClaw 的 `codex-cli` 引擎通过自维护的 `nuwax-codex-acp` 运行。OpenAI-compatible 协议转换能力已收口到 `nuwax-codex-acp` 内部，Electron 客户端不再启动或打包独立的 gateway/chat2response 进程。

```text
NuwaClaw Electron -> nuwax-codex-acp -> upstream OpenAI-compatible endpoint
```

NuwaClaw 只负责把运行时模型配置注入 ACP 进程环境，不写入 `config.toml`，不落盘保存密钥。

| 变量 | 生产者 | 消费者 | 含义 |
| --- | --- | --- | --- |
| `CODEX_MODEL` | NuwaClaw | nuwax-codex-acp | provider 原始模型名，例如 `glm-5` |
| `CODEX_BASE_URL` | NuwaClaw | nuwax-codex-acp | 上游 OpenAI-compatible base URL |
| `CODEX_API_KEY` | NuwaClaw | nuwax-codex-acp | 上游模型 provider key |
| `OPENAI_BASE_URL` | NuwaClaw | nuwaxcode / nuwax-codex-acp auth compat | 上游 OpenAI-compatible base URL |
| `OPENAI_API_KEY` | NuwaClaw | nuwaxcode / nuwax-codex-acp auth compat | 上游模型 provider key |

## Model Resolution

模型解析优先级：

```text
agent_server.env model override
  -> model_provider.model
  -> model_provider.default_model
```

支持的 env model override 包括 `OPENCODE_MODEL`、`ANTHROPIC_MODEL`、`CODEX_MODEL`。如果模型带 `openai-compatible/` 前缀，NuwaClaw 保留 raw model 用于识别 OpenAI-compatible，但传给 provider 的模型会剥离前缀：

```text
openai-compatible/glm-5 -> glm-5
```

## Electron Responsibilities

`crates/agent-electron-client/src/main/services/engines/acp/openAICompatRouting.ts`

- `resolveOpenAICompatModel` 负责解析 `openai-compatible/` 前缀。
- `applyOpenAICompatibleEnv` 只注入标准 `OPENAI_API_KEY` / `OPENAI_BASE_URL`。
- 不再包含 gateway/chat2response proxy 选择、URL 改写或上游地址暂存逻辑。

`crates/agent-electron-client/src/main/services/engines/acp/acpClient.ts`

- `codex` / `codex-cli` 注入 `CODEX_API_KEY`、`CODEX_MODEL`、`CODEX_BASE_URL`。
- OpenAI-compatible 配置同时注入 `OPENAI_API_KEY`、`OPENAI_BASE_URL`，用于 nuwaxcode/opencode 兼容路径和 codex ACP auth。
- `CODEX_BASE_URL` 指向真实上游 base URL，不再指向本地转换服务。

`crates/agent-electron-client/src/main/services/engines/unifiedAgent.ts`

- 不再自动启动本地 gateway。
- `codex-cli` 的协议兼容由 `nuwax-codex-acp` 负责。

## Removed Surface

Electron 客户端不再维护以下内容：

- `crates/gateway-server`
- 根目录 `chat2response` gitlink
- `prepare:gateway`
- `resources/gateway` extraResources
- gateway/chat2response IPC、preload API、renderer 服务项
- gateway/chat2response dependency checks

## Verification

```bash
cd crates/agent-electron-client
npm run test:run -- src/main/services/engines/acp/acpClient.test.ts src/main/services/engines/acp/acpEngine.test.ts
npm run test:scripts
npm run build:main:dev
npm run build:renderer
```
