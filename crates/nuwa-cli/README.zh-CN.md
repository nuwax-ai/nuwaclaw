# nuwa-cli

[English](README.md) | 简体中文

无界面（headless）的多引擎 Agent 命令行工具。`nuwa-cli` 直接挂接到你本机**已经安装并登录**的 `claude` 与 `codex` CLI——无需单独登录、不打包 Claude/Codex 运行时、不使用隔离的配置目录。它读取的就是你终端里 `claude`/`codex` 本身在用的 `~/.claude` / `~/.codex` 状态。

```bash
npm install -g @nuwax-ai/nuwa-cli
nuwa-cli doctor
nuwa-cli chat -p "列出当前目录下的文件"
```

## 开发者快速开始

如果你是在 `crates/nuwa-cli` 目录里做本地开发，推荐先跑：

```bash
pnpm install
pnpm run build
pnpm run dev:cli --version
pnpm run dev:doctor
pnpm run dev:chat -p "hello"
```

更完整的本地调试脚本和分步说明见 [`docs/local-debugging.md`](docs/local-debugging.md)。

## 为什么用它

大多数 Agent 封装要么自带一整套模型运行时（体积大，而且看不到你已有的登录态），要么让你重新配置一遍 API key。`nuwa-cli` 两者都不做：

- **继承你的环境。** `HOME`、`~/.claude`、`~/.codex`、MCP server、skills、模型偏好——全部保持原样。引擎看到的，和你自己的 `claude`/`codex` CLI 看到的完全一致。
- **使用正常包依赖。** ACP 适配器（`claude-code-acp-ts`、`nuwax-codex-acp`）和 `nuwax-file-server` 会随 `nuwa-cli` 通过 npm/pnpm 安装；运行时只解析这些已安装包的入口。lanproxy 是随 CLI 包发布的预置资源。
- **走 ACP 协议。** 两个引擎都通过 [Agent Client Protocol](https://agentclientprotocol.com) 驱动——和 Zed 等编辑器用的是同一套协议，而不是抓取 CLI 文本输出的那种封装。

## 命令

### `nuwa-cli doctor`

检查 Node 版本、`claude`/`codex` 是否安装并登录、`uv`、当前目录的 macOS TCC 风险、Nuwax 云端登录态，并统计本地会话历史数量。

退出码只反映真正阻塞核心功能的检测项：Node 版本，以及 claude/codex **至少有一个**可用。其余项（`uv`、TCC 风险、Nuwax 登录）都是可选功能，未满足时显示 `○` 而非 `✖`——`doctor` 仍然退出 `0`，可以放心用在脚本/CI 里，不会因为没开启的可选功能而误报失败。

### `nuwa-cli chat`

```bash
nuwa-cli chat                                  # 交互式 REPL，claude 引擎
nuwa-cli chat --engine codex -p "解释这段 diff"
nuwa-cli chat --resume                         # 选择一个历史会话继续
nuwa-cli chat --resume <sessionId>             # 续接指定会话
nuwa-cli chat --yolo                           # 自动批准工具调用
nuwa-cli chat --mode acceptEdits               # 设置引擎会话模式
nuwa-cli chat --handoff claude:<sessionId> -p "接着做"
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
| `--handoff <engine>:<sessionId>` | 从另一个本地会话生成结构化交接包，并在新的 ACP 会话首轮注入。与 `--resume` / `--ref-session` 互斥 |
| `--api-key` / `--base-url` / `--model` | 覆盖模型连接——仅当你不想用引擎自身已配置的 provider 时才需要 |

默认情况下 nuwa-cli **不注入**任何凭证、**不覆盖**任何模型/skill/MCP 配置——引擎就用你已有的配置运行。

### `nuwa-cli sessions`

列出本地 `claude`/`codex` 会话历史（直接读取 `~/.claude/projects` 与 `~/.codex/sessions`），方便你找到要续接的 session id。

`nuwa-cli sessions summary --engine <claude|codex> --session-id <id> [--limit N]` 输出某个会话完整 transcript 的紧凑、跨引擎通用的 JSON 摘要（`{engine, sessionId, cwd, title, messages, hasMore}`）。这是底层兼容命令；新的跨 Agent 上下文入口见 `nuwa-cli context`。

### `nuwa-cli context`

ACP 之上的跨 Agent 上下文引用层。它不替代 ACP 会话生命周期，也不做跨引擎原生续接；只把本地会话历史解析成目标 Agent 可以按需读取的 JSON：

```bash
nuwa-cli context list --json
nuwa-cli context read --ref claude:<sessionId> --limit 40 --json
nuwa-cli context digest --ref claude:<sessionId> --json
nuwa-cli context handoff --ref claude:<sessionId> --json
```

- `read`：规范化消息流，接近 `sessions summary`。
- `digest`：规则型压缩摘要，包含最近目标、工具调用、文件路径、决策、待办和风险。
- `handoff`：适合另一个 Agent 接手工作的结构化交接包。

#### 用 `chat --ref-session` 做跨引擎上下文

ACP 的 `session/load` 是引擎原生的——`claude-code-acp-ts` 的会话无法被 `nuwax-codex-acp` 续接，反之亦然，因为各自只理解自己的落盘 transcript 格式与工具调用约定。目前**没有真正的跨引擎续接**，`nuwa-cli` 也不假装有。

取而代之，`chat --ref-session <engine>:<sessionId>` 会在**新**会话的**首轮** prompt 前加一行提醒，把模型指向 `nuwa-cli context digest/read`，让它**按需**拉取另一个引擎的历史——通过模型自带的 Bash 工具即可，无需新增 MCP server 或协议：

```bash
nuwa-cli chat --engine codex --ref-session claude:c6e84245-a81c-4563-b0c8-2f0e2cf4682a \
  -p "那个会话里我们对 API 形态做了什么决定？"
```

这和 [tutti](https://tutti.sh) 在 claude-code/codex/cursor 等之间桥接上下文的方式一致：给一句简短的路由提示，而不是把整段 transcript 急切地塞进 prompt，模型只读它真正需要的那部分。

`--handoff <engine>:<sessionId>` 则会先生成一个结构化交接包（目标、决策、待办、文件、风险、最近消息），并在新 ACP 会话的首轮注入。它适合“换一个 Agent 接手继续做”，但仍然不是原生续接。

`--ref-session` / `--handoff` 不能和 `--resume` 同时使用，彼此之间也互斥——它们分别代表原生续接、只读引用和交接启动，混用会让首轮语义不清。

这是同一台机器上两个引擎之间**本地、只读**的上下文共享，和下文的 Nuwax 云端登录无关、也不依赖它。目前**没有**本地+云端统一的会话列表——`sessions`/`sessions summary` 目前只能看到本地 `~/.claude`/`~/.codex` 的历史。

### `nuwa-cli login` / `logout` / `status` / `config`

无需 UI 的 Nuwax 账号登录，以便启用云端/远程功能：

```bash
nuwa-cli login --help
nuwa-cli login --domain https://agent.nuwax.com --saved-key <key>   # 已有 key
nuwa-cli login --domain https://agent.nuwax.com -u <username>       # 首次登录（随后提示输入密码）
nuwa-cli status --remote     # 向服务器重新校验已保存的 key 是否仍有效
nuwa-cli logout              # 清除会话，但保留 saved key
nuwa-cli config get
nuwa-cli config set domain <host>
```

凭证存放在 `~/.nuwa-cli/credentials.json`（权限 `0600`）。密码永不落盘。CLI 不使用 SQLite；为了和 NuwaClaw Electron 客户端的行为一致，`credentials.json` 会用轻量 JSON 映射按 `domain + username` 记住各账号 savedKey。再次用同一 domain/账号登录时会复用该 savedKey，避免后端新建一台电脑；不传 domain/账号时默认命中当前账号。

`nuwa-cli status` 还会报告本地 `serve` 是否在运行、端口多少——读取的是 `serve` 启动时写的锁文件。`X-Nuwax-Internal-Secret` 本身**仍然永不落盘**，所以要实际调用 `/computer/chat` 还得从 serve 进程的启动输出里取 secret。

nuwa-cli 的登录态会与 NuwaClaw Electron 客户端完全隔离。`nuwa-cli login` 不会读取 Electron 客户端 SQLite，也不会复用它的 savedKey；请通过 `--saved-key` 或 `-u` 创建 CLI 自己的凭证和 device id。

### `nuwa-cli account`

管理 `~/.nuwa-cli/credentials.json` 中已保存的多个账号：

```bash
nuwa-cli account --help
nuwa-cli account list
nuwa-cli account switch --help
nuwa-cli account switch <account-key>
```

`account list` 会输出可切换账号的 key（形如 `testagent.xspaceagi.com_18011447397`）并用 `*` 标记当前默认账号。`account switch` 会用该账号保存的 savedKey 重新注册并设为当前默认账号。

切换账号会影响 `serve`、file-server、lanproxy、后端注册状态，因此**不做热切换**。如果 `serve` 正在运行，`account switch` 会拒绝执行；请先在运行 `up/serve` 的终端按 `Ctrl-C` 停止所有服务，再切换账号并重新启动。

### `nuwa-cli up`

一键检测可用引擎、登录/注册并启动 `serve --tunnel`：

```bash
nuwa-cli up --help
nuwa-cli up --domain https://agent.nuwax.com --saved-key <key>
nuwa-cli up --domain https://agent.nuwax.com -u <username>
NUWACLI_PASSWORD='<password>' nuwa-cli up --domain https://agent.nuwax.com -u <username>
```

未传 `--engine` 时会检测本机可用的 `claude` / `codex`：只有一个可用就使用它；多个可用时随机选择一个；都不可用则提示先完成 `claude login` 或 `codex login`。`NUWACLI_PASSWORD` 只用于本次账号密码注册，不会写入 credentials，也会从 engine/lanproxy/file-server 子进程环境里清理掉。

npm 发布后，干净环境可用零安装入口：

```bash
npx -y @nuwax-ai/nuwa-cli@latest up --domain https://agent.nuwax.com --saved-key <key>
```

本地未发布 npm 时的调试方式见 [`docs/local-debugging.md`](docs/local-debugging.md)，完整设计说明见 [`docs/one-click-up.md`](docs/one-click-up.md)。

常驻运行方式：

```bash
nuwa-cli up --engine claude --daemon           # 脱离当前终端后台运行
nuwa-cli service install --engine claude --now # 安装当前用户自启动服务并立即启动
nuwa-cli service status
nuwa-cli service stop
nuwa-cli service uninstall
```

`--daemon` 是轻量后台模式：终端关闭后仍运行，但重启/注销后不会自动恢复。`nuwa-cli service` 会安装系统托管的当前用户服务：macOS 用 LaunchAgent，Linux 用 systemd user service，Windows 用计划任务。启动项只保存 engine/port/cwd/lanproxy 等运行参数，**不会**保存密码、savedKey/configKey 或模型 API key；登录态仍只从 `~/.nuwa-cli/credentials.json` 读取。

### `nuwa-cli service`

管理后台常驻与开机/登录自启动：

```bash
nuwa-cli service install --help
nuwa-cli service install --engine claude --now
nuwa-cli service start
nuwa-cli service stop
nuwa-cli service status
nuwa-cli service uninstall
```

安装前需要已有 CLI 默认账号：先成功运行一次 `nuwa-cli login` 或 `nuwa-cli up`。macOS 和 Windows 会在当前用户登录时启动；Linux 使用 `systemd --user`，默认也是用户登录后启动，如需未登录也随系统启动，需要在系统上启用 linger（例如允许时运行 `loginctl enable-linger $USER`）。

### `nuwa-cli update`

升级 npm/pnpm 安装的 CLI 包：

```bash
nuwa-cli update --help
nuwa-cli update                 # 升级到 latest
nuwa-cli update 0.2.0           # 升级到指定版本
nuwa-cli update --check         # 只查询目标版本
nuwa-cli update --package-manager pnpm
```

`update` 只执行包升级，不修改 `~/.nuwa-cli/credentials.json`、savedKey、账号列表或服务锁。若是 `npx` / `pnpm dlx` 临时运行，建议直接使用 `npx -y @nuwax-ai/nuwa-cli@latest ...` 或 `pnpm dlx @nuwax-ai/nuwa-cli@latest ...`。

### `nuwa-cli serve`

启动仅监听本机的 HTTP API（默认 `127.0.0.1`），供脚本或远程/IM 集成使用：

```bash
nuwa-cli serve --port 60016
# -> POST /computer/chat            { prompt, session_id?, project_id?, agent_work_dir?, cwd? } -> { session_id }
# -> GET  /computer/progress/:id    会话更新的 SSE 流
# -> GET/POST /computer/agent/status
# -> POST /computer/agent/stop      { session_id }
# -> POST /computer/agent/session/cancel
# -> POST /computer/notify-resolved （headless 模式下接受并忽略）
# -> GET  /health                   （无需鉴权）
```

`serve` 默认优先使用 CLI 专属端口 `agentPort=60016`；如果该端口已被占用，会自动向后寻找可用端口并在启动日志里提示实际端口。`--tunnel` 下的 `nuwax-file-server` 同样优先使用 `fileServerPort=60015`，占用时自动后移，并把最终端口上报到 `sandboxConfigValue`。

未传 `--cwd` 时，默认根目录是 `~/.nuwa-cli/workspaces`，云端请求里的 `project_id` 会创建/使用 `~/.nuwa-cli/workspaces/<project_id>`；`agent_work_dir` / `session_id` 仅在缺少 `project_id` 时作为兼容 fallback。`user_id` 只作为请求元数据，不参与本地路径。传了 `--cwd <dir>` 时，`<dir>` 就是当前项目目录本身，不会再追加 `project_id`。`nuwax-file-server` 使用同一活动目录/根目录。

普通本地 `serve` 下，除 `/health` 和只读 SSE `/computer/progress/:session_id` 外，每个路由都需要认证；推荐使用 `X-Nuwax-Internal-Secret`，不能设置自定义 header 的客户端也可用 `Authorization: Bearer <secret>` 或 `?apiKey=<secret>`。`--tunnel` 模式下，`/computer/*` 与 `/devcomputer/*` 对齐 Electron 客户端约定：lanproxy 连接用 savedKey/configKey 作为 clientKey 鉴权，转发到本地的 HTTP 请求不会再逐个携带 savedKey。服务器仍会打印一个仅用于本地调试的随机 secret；它永不落盘。

`--approve` 控制工具调用授权：`auto`（默认）自动批准每一个工具调用（`yolo`），`deny` 则全部拒绝（适合让引擎无副作用地运行）。任何其他值都会被**拒绝**，而不是被静默当作 `auto`。在 `auto`/`yolo` 模式下，服务器启动时会打印一条警告：**所有**工具调用（含破坏性写文件、执行命令、网络访问）都会被自动放行，且**不做路径限制**；如不能接受，请用 `--approve deny`。

生命周期：

- `POST /computer/agent/stop` 会**中断**会话——它中止引擎连接（向引擎子进程发 SIGTERM）并最多等待约 3 秒退出，而不是一直阻塞到正在执行的工具调用自行结束。
- 引擎死亡的会话会被驱逐，并向 `/computer/progress` 客户端发送终结事件 `session_ended`（SSE `subType` 为 `error` 或 `ended`），让订阅者得知会话已结束，而不是永远等下去。
- 收到 `SIGINT`/`SIGTERM` 时，服务器会停止所有活动会话（拆除它们的引擎子进程）、停止 `--tunnel` 的 `nuwax-file-server` 与 lanproxy 子进程，然后再关闭 HTTP 监听——引擎子进程和辅助服务不再被遗留成孤儿。

`--tunnel` 需要先 `nuwa-cli login`。它会向后端重新注册 CLI，启动本地 `nuwax-file-server`，再启动随 CLI 包发布的 lanproxy 二进制：

```bash
nuwa-cli serve --tunnel --lanproxy-host agent.nuwax.com --lanproxy-port 443
```

如果注册响应已包含 `serverHost`/`serverPort`，可以省略显式 host/port。`--lanproxy-path` 仅用于覆盖内置二进制或本地联调。CLI 运行日志对齐客户端形态：结构化 JSONL 写入 `~/.nuwa-cli/logs/main.YYYY-MM-DD.log`，`latest.log` 指向当天活跃日志，`up-debug.log` 保留为兼容别名。`--daemon` 仍会把原始 stdout/stderr 追加到 `serve.log`，用于查看启动输出。

## 已知限制

- **Windows / Linux ARM 上的 codex**：目前仅在 macOS arm64 上测试过。
- **退出时的进程树清理**：只有直接的引擎子进程会收到 `SIGTERM`；孙进程（例如 `claude-code-acp-ts` 适配器再拉起的 `claude` 二进制）不会被信号通知，可能成为孤儿。`serve` 关闭仍会停止自身的 HTTP 会话，但零散的孙进程可能残留。
- **`yolo` 没有路径限制**：`--approve auto` 不论目标路径一律自动批准工具调用，目前没有可写根目录守卫（Electron 客户端的严格权限闸门尚未移植过来）。
- **开机启动是当前用户级别**：`service install` 使用 LaunchAgent / systemd user service / 计划任务，不是需要管理员权限的系统级 daemon。Linux 若要用户未登录也启动，需要在 CLI 外部配置 systemd linger。
- **自定义/第三方 ACP 引擎**（pi-acp、hermes、kilo、openclaw 等）暂不支持——仅支持 `claude` 和 `codex`。
- **云端会话同步/列表**：`sessions`/`status` 目前仅本地可用，跨设备会话历史的后端接口尚未确定。

## 工作原理

- ACP 连接：使用 `@agentclientprotocol/sdk` 的 `client().connectWith(...)` 构建器，通过 stdio NDJSON 拉起引擎。
- `claude` 引擎：拉起包依赖 [`claude-code-acp-ts`](https://www.npmjs.com/package/claude-code-acp-ts)，并通过 `CLAUDE_CODE_EXECUTABLE` 指向**你自己的** `claude` 二进制。
- `codex` 引擎：拉起包依赖 [`nuwax-codex-acp`](https://www.npmjs.com/package/nuwax-codex-acp)；该包通过 npm optionalDependencies 拉取匹配平台的二进制。
- `serve --tunnel`：启动包依赖 [`nuwax-file-server`](https://www.npmjs.com/package/nuwax-file-server)，再用注册得到的 savedKey 拉起随 CLI 包发布的 `nuwax-lanproxy` 二进制。file-server 的 PID/lock 临时目录会按端口放到 `~/.nuwa-cli/tmp/file-server-<port>`，避免误停 Electron 客户端或另一个 CLI tunnel 实例。
- `service install`：写入当前用户级系统服务，在登录/启动时运行 `nuwa-cli up`；运行时复用 CLI 自己的 credentials，不把密钥嵌入系统服务配置。
- 不会往你 shell 的全局 `node_modules` 里装任何东西，nuwa-cli 自己的 credentials、device id、cache、logs、serve lock 都存放在 `~/.nuwa-cli/` 下。若同时安装了 NuwaClaw Electron 桌面端，两者可在同一台机器共存但不共享 savedKey 或本地状态；`serve` 默认优先使用 CLI 专属端口 60016/60015，冲突时自动寻找后续可用端口，与 Electron 的 60005–60009 范围分开。

## 运行要求

- Node.js >= 22
- `claude` 和/或 `codex` CLI，已安装并登录

## 开发文档

本地调试命令与分步操作说明见 [`docs/local-debugging.md`](docs/local-debugging.md)。

设计文档（动机、方案选型、暂缓项）位于 [`docs/`](docs/)，可从 [`docs/serve-lifecycle.md`](docs/serve-lifecycle.md) 开始了解 `serve` 生命周期与权限模型的设计。
