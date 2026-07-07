# nuwaclaw

[English](README.md) | 简体中文

无界面（headless）的多引擎 Agent 命令行工具。`nuwaclaw` 直接挂接到你本机**已经安装并登录**的 `claude` 与 `codex` CLI——无需单独登录、不打包 Claude/Codex 运行时、不使用隔离的配置目录。它读取的就是你终端里 `claude`/`codex` 本身在用的 `~/.claude` / `~/.codex` 状态。

```bash
npm install -g nuwaclaw
nuwaclaw doctor
nuwaclaw chat -p "列出当前目录下的文件"
```

## 开发者快速开始

如果你是在 `crates/nuwaclaw-cli` 目录里做本地开发，推荐先跑：

```bash
pnpm install
pnpm run build
pnpm run dev:doctor
pnpm run dev:chat -- -p "hello"
```

更完整的本地调试脚本和分步说明见 [`docs/local-debugging.md`](docs/local-debugging.md)。

## 为什么用它

大多数 Agent 封装要么自带一整套模型运行时（体积大，而且看不到你已有的登录态），要么让你重新配置一遍 API key。`nuwaclaw` 两者都不做：

- **继承你的环境。** `HOME`、`~/.claude`、`~/.codex`、MCP server、skills、模型偏好——全部保持原样。引擎看到的，和你自己的 `claude`/`codex` CLI 看到的完全一致。
- **几乎不预装东西。** npm 包只有几百 KB。引擎适配器和 codex 二进制只在**第一次真正用到时**才下载到 `~/.nuwaclaw`。
- **走 ACP 协议。** 两个引擎都通过 [Agent Client Protocol](https://agentclientprotocol.com) 驱动——和 Zed 等编辑器用的是同一套协议，而不是抓取 CLI 文本输出的那种封装。

## 命令

### `nuwaclaw doctor`

检查 Node 版本、`claude`/`codex` 是否安装并登录、`uv`、gui-agent MCP 安装状态、当前目录的 macOS TCC 风险、Nuwax 云端登录态，并统计本地会话历史数量。

### `nuwaclaw chat`

```bash
nuwaclaw chat                                  # 交互式 REPL，claude 引擎
nuwaclaw chat --engine codex -p "解释这段 diff"
nuwaclaw chat --resume                         # 选择一个历史会话继续
nuwaclaw chat --resume <sessionId>             # 续接指定会话
nuwaclaw chat --yolo                           # 自动批准工具调用
nuwaclaw chat --mode acceptEdits               # 设置引擎会话模式
nuwaclaw chat --gui-mcp                        # 让引擎能截图 / 点击 / 输入
```

参数：

| 参数 | 含义 |
|---|---|
| `--engine <claude\|codex>` | 挂接哪个引擎（默认 `claude`） |
| `--cwd <dir>` | 会话工作目录 |
| `-p, --print <prompt>` | 单次模式：发送一条 prompt 后退出（非交互） |
| `--yolo` | 自动批准引擎询问的每一个工具调用 |
| `--mode <modeId>` | 设置引擎会话模式（`acceptEdits`、`bypassPermissions`、`read-only`、`full-access` 等，因引擎而异） |
| `--resume [sessionId]` | 从本地 `claude`/`codex` 历史续接会话；不带 id 时弹出交互选择 |
| `--ref-session <engine>:<sessionId>` | 把**另一个**引擎的历史会话作为背景上下文指向给模型（不是真正的续接——见下文）。与 `--resume` 互斥 |
| `--gui-mcp` / `--gui-mcp-path <dir>` | 通过 `agent-gui-server` MCP 给引擎加上桌面自动化能力（截图、点击、输入） |
| `--api-key` / `--base-url` / `--model` | 覆盖模型连接——仅当你不想用引擎自身已配置的 provider 时才需要 |

默认情况下 nuwaclaw **不注入**任何凭证、**不覆盖**任何模型/skill/MCP 配置——引擎就用你已有的配置运行。

### `nuwaclaw sessions`

列出本地 `claude`/`codex` 会话历史（直接读取 `~/.claude/projects` 与 `~/.codex/sessions`），方便你找到要续接的 session id。

`nuwaclaw sessions summary --engine <claude|codex> --session-id <id> [--limit N]` 输出某个会话完整 transcript 的紧凑、跨引擎通用的 JSON 摘要（`{engine, sessionId, cwd, title, messages, hasMore}`）。它是给**Agent 自己的 shell 工具**调用的，不是给人看的——见下文 `chat --ref-session`。

#### 用 `chat --ref-session` 做跨引擎上下文

ACP 的 `session/load` 是引擎原生的——`claude-code-acp-ts` 的会话无法被 `nuwax-codex-acp` 续接，反之亦然，因为各自只理解自己的落盘 transcript 格式与工具调用约定。目前**没有真正的跨引擎续接**，`nuwaclaw` 也不假装有。

取而代之，`chat --ref-session <engine>:<sessionId>` 会在**新**会话的**首轮** prompt 前加一行提醒，把模型指向 `nuwaclaw sessions summary`，让它**按需**拉取另一个引擎的历史——通过模型自带的 Bash 工具即可，无需新增 MCP server 或协议：

```bash
nuwaclaw chat --engine codex --ref-session claude:c6e84245-a81c-4563-b0c8-2f0e2cf4682a \
  -p "那个会话里我们对 API 形态做了什么决定？"
```

这和 [tutti](https://tutti.sh) 在 claude-code/codex/cursor 等之间桥接上下文的方式一致：给一句简短的路由提示，而不是把整段 transcript 急切地塞进 prompt，模型只读它真正需要的那部分。

`--ref-session` 不能和 `--resume` 同时使用——这个提醒只在新建会话的首轮有意义，续接会话本身已经有真实历史可以继续，两者同传时 `nuwaclaw` 会直接报错，而不是替你猜该按哪个来。

这是同一台机器上两个引擎之间**本地、只读**的上下文共享，和下文的 Nuwax 云端登录无关、也不依赖它。目前**没有**本地+云端统一的会话列表——`sessions`/`sessions summary` 目前只能看到本地 `~/.claude`/`~/.codex` 的历史。

### `nuwaclaw login` / `logout` / `status` / `config`

无需 UI 的 Nuwax 账号登录，以便启用云端/远程功能：

```bash
nuwaclaw login --domain https://agent.nuwax.com --saved-key <key>   # 已有 key
nuwaclaw login --domain https://agent.nuwax.com -u <username>       # 首次登录（随后提示输入密码）
nuwaclaw status --remote     # 向服务器重新校验已保存的 key 是否仍有效
nuwaclaw logout              # 清除会话，但保留 saved key
nuwaclaw config get
nuwaclaw config set domain <host>
```

凭证存放在 `~/.nuwaclaw/cli/credentials.json`（权限 `0600`）。密码永不落盘。

### `nuwaclaw serve`

启动仅监听本机的 HTTP API（默认 `127.0.0.1`），供脚本或远程/IM 集成使用：

```bash
nuwaclaw serve --port 60016
# -> POST /computer/chat            { prompt, session_id?, cwd? } -> { session_id }
# -> GET  /computer/progress/:id    会话更新的 SSE 流
# -> GET  /computer/agent/status
# -> POST /computer/agent/stop      { session_id }
# -> GET  /health                   （无需鉴权）
```

除 `/health` 外，每个路由都需要 `X-Nuwax-Internal-Secret` 请求头——服务器启动时会打印一个随机生成的新 secret；它永不落盘。

`--approve` 控制工具调用授权：`auto`（默认）自动批准每一个工具调用（`yolo`），`deny` 则全部拒绝（适合让引擎无副作用地运行）。任何其他值都会被**拒绝**，而不是被静默当作 `auto`。在 `auto`/`yolo` 模式下，服务器启动时会打印一条警告：**所有**工具调用（含破坏性写文件、执行命令、网络访问）都会被自动放行，且**不做路径限制**；如不能接受，请用 `--approve deny`。

生命周期：

- `POST /computer/agent/stop` 会**中断**会话——它中止引擎连接（向引擎子进程发 SIGTERM）并最多等待约 3 秒退出，而不是一直阻塞到正在执行的工具调用自行结束。
- 引擎死亡的会话会被驱逐，并向 `/computer/progress` 客户端发送终结事件 `session_ended`（SSE `subType` 为 `error` 或 `ended`），让订阅者得知会话已结束，而不是永远等下去。
- 收到 `SIGINT`/`SIGTERM` 时，服务器会停止所有活动会话（拆除它们的引擎子进程）、停止 `--tunnel` 的 `nuwax-file-server`，然后再关闭 HTTP 监听——引擎子进程和 file server 不再被遗留成孤儿。

`--tunnel` 目前是**实验性**能力。它需要先 `nuwaclaw login`，并会额外启动一个本地 `nuwax-file-server` 实例；通过真正的云端隧道（lanproxy）暴露它**尚未接入**——见[已知限制](#已知限制)。

## 已知限制

- **Windows / Linux ARM 上的 codex**：目前仅在 macOS arm64 上测试过。
- **Windows 首次安装**：`claude` 引擎、`--gui-mcp`、`serve --tunnel` 通过 `spawnSync("npm", …)`（不带 `shell:true`）安装各自的 npm 包；在 Windows 上 Node 拒绝以这种方式启动 `npm.cmd`，因此这些功能首次使用会失败。macOS/Linux 不受影响。
- **退出时的进程树清理**：只有直接的引擎子进程会收到 `SIGTERM`；孙进程（`claude-code-acp-ts` 适配器再拉起的 `claude` 二进制，以及 `--gui-mcp` 下的 `agent-gui-server`）不会被信号通知，可能成为孤儿。`serve` 关闭仍会停止自身的 HTTP 会话，但零散的孙进程可能残留。
- **`yolo` 没有路径限制**：`--approve auto` 不论目标路径一律自动批准工具调用，目前没有可写根目录守卫（Electron 客户端的严格权限闸门尚未移植过来）。
- **自定义/第三方 ACP 引擎**（pi-acp、hermes、kilo、openclaw 等）暂不支持——仅支持 `claude` 和 `codex`。
- **`serve --tunnel`** 会启动本地 file server，但尚未建立云端隧道（lanproxy 目前没有独立分发渠道可拉取）。
- **云端会话同步/列表**：`sessions`/`status` 目前仅本地可用，跨设备会话历史的后端接口尚未确定。

## 工作原理

- ACP 连接：使用 `@agentclientprotocol/sdk` 的 `client().connectWith(...)` 构建器，通过 stdio NDJSON 拉起引擎。
- `claude` 引擎：拉起 [`claude-code-acp-ts`](https://www.npmjs.com/package/claude-code-acp-ts) 适配器（首次使用时安装，并跳过它约 200MB 的可选平台二进制——因为 `CLAUDE_CODE_EXECUTABLE` 始终指向**你自己的** `claude`，适配器自带的 bundled-binary 回退路径永远不会走到）。
- `codex` 引擎：首次使用时从 GitHub Releases 下载 `nuwax-codex-acp` 二进制（codex-acp 的 Rust fork），缓存到 `~/.nuwaclaw/engines/`。
- 不会往你 shell 的全局 `node_modules` 里装任何东西，nuwaclaw 自己的数据都在 `~/.nuwaclaw/cli/` 下——即使你同时装了 NuwaClaw Electron 桌面端，两者也不会互相触碰或冲突。

## 运行要求

- Node.js >= 22
- `claude` 和/或 `codex` CLI，已安装并登录

## 开发文档

本地调试命令与分步操作说明见 [`docs/local-debugging.md`](docs/local-debugging.md)。

设计文档（动机、方案选型、暂缓项）位于 [`docs/`](docs/)，可从 [`docs/serve-lifecycle.md`](docs/serve-lifecycle.md) 开始了解 `serve` 生命周期与权限模型的设计。
