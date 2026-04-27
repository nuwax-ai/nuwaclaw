# ACP 多引擎扩展 — 深度调研报告

> 调研日期：2026-04-27
> 目的：评估 5 个候选 agent engine 的 ACP 集成可行性和实施方案

---

## 总览

| 引擎 | ACP 命令 | 运行时 | 安装方式 | ACP 来源 | 集成难度 |
|------|---------|--------|---------|---------|---------|
| **codex-cli** | `codex-acp` | Rust binary | `make build` (源码) | 社区 bridge | 低 |
| **pi-agent** | `pi-acp` | Node.js (JS) | `npm install -g pi-acp` | 社区 adapter | 低 |
| **hermes-agent** | `hermes acp` | Python | `pip install -e '.[acp]'` | 原生支持 | 低 |
| **kilo-cli** | `kilo acp` | Go native (opencode) | `npm install -g @kilocode/cli` | 原生支持 | 低 |
| **openclaw** | `openclaw acp` | Node.js | 随 OpenClaw 内置 | 原生支持 | 低 |

**结论：5 个引擎全部已有 ACP 支持。NuwaClaw 客户端仅需扩展类型系统和路径解析，无需编写任何 wrapper。**

---

## 1. codex-cli (OpenAI Codex CLI)

### 基本信息

- **全名**: OpenAI Codex CLI
- **仓库**: [openai/codex](https://github.com/openai/codex) | ACP bridge: [cola-io/codex-acp](https://github.com/cola-io/codex-acp)
- **语言**: Rust (2024 edition, MSRV 1.91+)
- **ACP 来源**: 社区项目 `codex-acp`，非官方

### 安装

```bash
# 源码构建
git clone https://github.com/cola-io/codex-acp
cd codex-acp
make release  # → target/release/codex-acp
```

依赖：Rust 工具链、网络访问（Git 依赖 openai/codex workspace）。

### ACP 启动

```bash
# 作为 stdio ACP agent 运行
./target/release/codex-acp

# 环境变量
RUST_LOG=info                          # 日志级别 (默认 info)
CODEX_LOG_FILE=./logs/codex-acp.log    # 日志文件
CODEX_LOG_DIR=./logs                   # 按日轮转日志
CODEX_LOG_STDERR=0                     # 禁用 stderr 日志
```

无命令行参数，直接通过 stdio 通信。

### 支持的 ACP 方法

| 方法 | 说明 |
|------|------|
| `initialize` | 握手，声明能力和 `custom_provider` 认证 |
| `authenticate` | 认证（OpenAI 内置 / 自定义 provider） |
| `session/new` | 创建会话，自动注册 `acp_fs` MCP server |
| `session/load` | 恢复已有会话 |
| `session/prompt` | 发送提示词，流式返回 |
| `session/cancel` | 取消当前 turn |
| `session/setMode` | 切换模式：`read-only` / `auto` / `full-access` |
| `session/setModel` | 切换模型（仅自定义 provider） |

### 会话模式

- `read-only` — 禁用写工具
- `auto` — 默认
- `full-access` — 全权限

### 内置 MCP

自动启动 `acp_fs` MCP server（基于 rmcp），提供 `read_text_file`、`write_text_file`、`edit_text_file`、`multi_edit_text_file`。

### 斜杠命令

`/init`、`/status`、`/compact`、`/review`

### NuwaClaw 集成要点

- `binPath`: 构建产物路径或 `~/.nuwaclaw/node_modules/.bin/codex-acp`
- `binArgs`: `[]`
- `isNative`: `true` (Rust 原生二进制)
- 认证：通过 `codex login` 或环境变量 `OPENAI_API_KEY`
- chat2response: 可选，当用户配置国内模型时设置 `OPENAI_BASE_URL` 指向代理

---

## 2. pi-agent (Pi Coding Agent)

### 基本信息

- **全名**: Pi Coding Agent
- **仓库**: [svkozak/pi-acp](https://github.com/svkozak/pi-acp) | agent: `@mariozechner/pi-coding-agent`
- **语言**: TypeScript (Node.js)
- **ACP 来源**: 社区 adapter `pi-acp`

### 安装

```bash
# 前置依赖：pi coding agent
npm install -g @mariozechner/pi-coding-agent

# ACP adapter
npm install -g pi-acp
```

要求：Node.js 22+，`pi` 在 PATH 中。

### ACP 启动

```bash
# 全局安装后直接运行
pi-acp

# 或通过 npx（免安装）
npx -y pi-acp

# 终端认证
pi-acp --terminal-login
```

### 原理

`pi-acp` 通过 stdio 与 ACP 客户端通信，内部 spawn `pi --mode rpc` 子进程，双向转发 ACP JSON-RPC ↔ pi RPC。

### 支持的 ACP 功能

| 功能 | 状态 |
|------|------|
| `agent_message_chunk` 流式 | 支持 |
| `tool_call` / `tool_call_update` | 支持（含文件路径解析） |
| `session/load` 会话持久化 | 支持 |
| `promptCapabilities.embeddedContext` | 可选（环境变量 `PI_ACP_ENABLE_EMBEDDED_CONTEXT=true`） |
| `fs/*` 文件系统委托 | **不支持** |
| `terminal/*` 终端委托 | **不支持** |
| Thought stream 独立推理流 | **不支持**（全作为 `agent_message_chunk`） |
| MCP server 参数 | 接收但不转发给 pi |

### 会话存储

- pi: `~/.pi/agent/sessions/...`
- pi-acp mapping: `~/.pi/pi-acp/session-map.json`

### 斜杠命令

`/compact`、`/autocompact`、`/export`、`/session`、`/name`、`/queue`、`/changelog`、`/steering`、`/follow-up`、`/model`、`/thinking`

### 限制

- 不支持 fs/terminal 委托（pi 自行处理本地 I/O）
- 无独立思考流
- MCP 不转发

### NuwaClaw 集成要点

- `binPath`: `~/.nuwaclaw/node_modules/.bin/pi-acp`
- `binArgs`: `[]`
- `isNative`: `false` (Node.js JS 入口，需通过 node spawn)
- 认证：通过 `pi-acp --terminal-login` 或 pi 配置

---

## 3. hermes-agent (Nous Research)

### 基本信息

- **全名**: Hermes Agent
- **组织**: Nous Research
- **文档**: https://hermes-agent.nousresearch.com/docs/user-guide/features/acp
- **语言**: Python
- **ACP 来源**: 原生支持

### 安装

```bash
# 安装 Hermes（含 ACP 扩展）
pip install -e '.[acp]'

# 该扩展引入 agent-client-protocol 依赖
# 注册三个入口：hermes acp / hermes-acp / python -m acp_adapter
```

### ACP 启动

```bash
# 三种等价命令
hermes acp
hermes-acp
python -m acp_adapter
```

日志输出到 stderr，stdout 保留给 ACP JSON-RPC 通信。

### 暴露的 ACP 工具集

| 类别 | 工具 |
|------|------|
| 文件 | `read_file`, `write_file`, `patch`, `search_files` |
| 终端 | `terminal`, `process` |
| Web | Web/浏览器工具 |
| 记忆 | memory, todo, session search |
| 技能 | skills |
| 执行 | `execute_code`, `delegate_task` |
| 视觉 | vision |

### 会话管理

- 支持 list/load/resume/fork
- 作用域限当前 ACP 服务器进程
- cwd 绑定到 Hermes task ID

### 审批

危险终端命令转为编辑器审批提示，选项：allow once / allow always / deny。

### 配置

| 文件 | 用途 |
|------|------|
| `~/.hermes/.env` | 环境变量 / API keys |
| `~/.hermes/config.yaml` | 主配置 |
| `~/.hermes/skills/` | 自定义技能 |
| `~/.hermes/state.db` | 持久化状态 |

ACP 继承 CLI 的 provider 和凭证配置，通过 `hermes model` 或直接编辑 `.env` 设置。

### Registry

`acp_registry/agent.json` 声明启动命令为 `hermes acp`。

### NuwaClaw 集成要点

- `binPath`: `hermes`（需在 PATH 中，通过 `which hermes` 查找）
- `binArgs`: `["acp"]`
- `isNative`: `true` (Python 入口，但直接 spawn)
- 认证：通过 `~/.hermes/.env` 或 `hermes model` 配置

---

## 4. kilo-cli (Kilo Code)

### 基本信息

- **全名**: Kilo Code CLI
- **仓库**: [Kilo-Org/kilocode](https://github.com/Kilo-Org/kilocode)
- **语言**: Go native（基于 opencode fork）
- **版本**: v7.2.14 (2026-04)
- **ACP 来源**: 原生支持（opencode fork，与 nuwaxcode 同源）

### 安装

```bash
# npm 全局安装
npm install -g @kilocode/cli

# Homebrew
brew install Kilo-Org/tap/kilo

# 免安装运行
npx -y @kilocode/cli acp
```

### ACP 启动

```bash
# ACP 模式
kilo acp

# npx 方式
npx -y @kilocode/cli acp
```

### 特性

- 500+ 模型支持（OpenAI, Anthropic, Google, Qwen, MiniMax, Ollama 等）
- Agent 模式：Architect, Coder, Debugger, Orchestrator, Ask, Custom
- MCP 支持
- Memory Bank（Markdown 持久化上下文）
- Autonomous 模式（`--auto`，CI/CD 免审批）

### 与 nuwaxcode 的关系

kilo-cli 是 opencode 的 fork，nuwaxcode 也基于 opencode。两者的 ACP 机制一致（`<binary> acp`），环境变量和配置模型相似。

### NuwaClaw 集成要点

- `binPath`: `~/.nuwaclaw/node_modules/.bin/kilo` 或全局 `kilo`
- `binArgs`: `["acp"]`
- `isNative`: `true` (Go 原生二进制)
- 环境变量：与 nuwaxcode 类似的 `OPENCODE_MODEL` 等

---

## 5. openclaw

### 基本信息

- **全名**: OpenClaw
- **仓库**: [openclaw/openclaw](https://github.com/openclaw/openclaw)
- **语言**: Node.js
- **ACP 来源**: 原生支持（`openclaw acp` 子命令）

### 安装

OpenClaw ACP 随 OpenClaw 内置，无需额外安装。

```bash
# 安装 OpenClaw 本身即包含 acp 子命令
npm install -g openclaw
```

### ACP 启动

```bash
# 本地 Gateway（最简）
openclaw acp

# 远程 Gateway
openclaw acp --url wss://gateway-host:18789 --token <token>

# 远程 + Token 文件
openclaw acp --url wss://gateway-host:18789 --token-file ~/.openclaw/gateway.token

# 绑定已有会话
openclaw acp --session agent:main:main

# 带标签 + 重置
openclaw acp --session agent:main:main --session-label "support inbox" --reset-session
```

### 全部参数

| 参数 | 说明 |
|------|------|
| `--url` | 远程 Gateway WebSocket 地址 |
| `--token` | 认证令牌（不推荐，会出现在进程列表） |
| `--token-file` | 从文件读令牌（推荐） |
| `--session` | 会话 Key（如 `agent:main:main`） |
| `--session-label` | 人类可读标签 |
| `--reset-session` | 重置会话（清空历史，保留 Key） |

### 环境变量

| 变量 | 说明 |
|------|------|
| `OPENCLAW_GATEWAY_TOKEN` | Gateway 认证令牌 |
| `OPENCLAW_SHELL=acp` | ACP 会话标记（可在 shell profile 中据此设置规则） |

### 调试命令

```bash
# 交互式 ACP 客户端（无需 IDE，直接测试）
openclaw acp client

# 指定 server 命令
openclaw acp client --server "node" --server-args openclaw.mjs acp --url ws://127.0.0.1:19001
```

### 永久配置远程 Gateway

```bash
openclaw config set gateway.remote.url wss://gateway-host:18789
openclaw config set gateway.remote.token <token>
# 之后只需 openclaw acp
```

### Zed 配置示例

```json
{
  "agent_servers": {
    "OpenClaw ACP": {
      "type": "custom",
      "command": "openclaw",
      "args": ["acp", "--url", "wss://gateway-host:18789", "--token", "<token>"],
      "env": {}
    }
  }
}
```

### NuwaClaw 集成要点

- `binPath`: 全局 `openclaw` 或 `~/.nuwaclaw/node_modules/.bin/openclaw`
- `binArgs`: `["acp"]`（可追加 `--url`、`--token` 等）
- `isNative`: `true` (Node.js CLI，直接 spawn)
- 配置：需 `openclaw config set` 或传参指定 Gateway 连接
- 特殊：作为 Gateway 代理，与其它直接 LLM 调用的引擎不同

---

## 对比：ACP 能力矩阵

| 能力 | codex-cli | pi-agent | hermes-agent | kilo-cli | openclaw |
|------|-----------|----------|-------------|---------|----------|
| `initialize` | ✓ | ✓ | ✓ | ✓ | ✓ |
| `session/new` | ✓ | ✓ | ✓ | ✓ | ✓ |
| `session/load` | ✓ | ✓ | ✓ | ✓ | ✓ |
| `session/prompt` | ✓ | ✓ | ✓ | ✓ | ✓ |
| `session/cancel` | ✓ | ✓ | ✓ | ✓ | ✓ |
| `session/setMode` | ✓ | — | — | ✓ | — |
| `session/setModel` | ✓ | — | — | ✓ | — |
| `fs/*` 委托 | ✓ (MCP) | ✗ | ✓ | ✓ | — |
| `terminal/*` 委托 | — | ✗ | ✓ | ✓ | — |
| MCP 支持 | ✓ (acp_fs) | 接收不转发 | — | ✓ | ✓ |
| 流式 `agent_message_chunk` | ✓ | ✓ | ✓ | ✓ | ✓ |
| 流式 `agent_thought_chunk` | ✓ | ✗ | ✓ | ✓ | ✓ |
| `tool_call` / `tool_call_update` | ✓ | ✓ | ✓ | ✓ | ✓ |
| 认证 (`authenticate`) | ✓ | ✓ (Terminal) | — (继承 CLI) | — | ✓ (Gate token) |
| 审批请求 | — | — | ✓ | ✓ | ✓ |

---

## 实施清单

在 NuwaClaw Electron 客户端中的集成工作量：

| 任务 | 文件 | 说明 |
|------|------|------|
| 类型扩展 | `types.ts`, `electron.d.ts`, `engineManager.ts` | 添加 5 个引擎到 `AgentEngineType` |
| 路径解析 | `acpClient.ts` → `resolveAcpBinary()` | 每引擎添加 switch case |
| 引擎管理 | `engineManager.ts` | 检测/安装/版本 |
| 命令映射 | `agentHelpers.ts` | `mapAgentCommand()` |
| UI | `AgentSettings.tsx` | 引擎选择下拉 5 个新选项 |
| i18n | `locales/*.json`, `constants.ts` | 翻译 key |
| 依赖注册 | `dependencies.ts` | 可选依赖（`required: false`） |

**无需新建任何 ACP wrapper 包。**
