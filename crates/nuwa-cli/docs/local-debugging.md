# 本地调试指南

> 面向 `crates/nuwa-cli` 包本身的开发与联调。
> 设计与行为说明见 [`README.zh-CN.md`](../README.zh-CN.md) / [`README.md`](../README.md)；
> `serve` 生命周期设计见 [`serve-lifecycle.md`](./serve-lifecycle.md)。

## 前置条件

- Node.js >= 22
- 已安装依赖：在 `crates/nuwa-cli` 目录执行 `pnpm install`
- 本机已安装并登录 `claude` 和/或 `codex`

## 常用脚本

脚本定义位于 [`package.json`](../package.json)：

```json
{
  "scripts": {
    "build": "tsc --noEmit && node scripts/build.mjs",
    "dev:build": "node scripts/build.mjs",
    "dev:cli": "node dist/cli.js",
    "dev:doctor": "node dist/cli.js doctor",
    "dev:chat": "node dist/cli.js chat",
    "dev:chat:codex": "node dist/cli.js chat --engine codex",
    "dev:sessions": "node dist/cli.js sessions",
    "dev:sessions:summary": "node dist/cli.js sessions summary",
    "dev:up": "node dist/cli.js up",
    "dev:serve": "node dist/cli.js serve --port 60016",
    "test": "vitest",
    "test:run": "vitest run"
  }
}
```

## 源码结构速记

CLI 入口已经拆成注册层与执行层，新增命令时优先按这个边界放置：

- `src/cli.ts`：极薄入口，只创建 program 并 `parseAsync`。
- `src/cli/createProgram.ts`：创建顶层 commander program，集中注册命令组。
- `src/cli/register*.ts`：按领域注册命令组，例如 agent、本地 context、云账号、serve/up、update。
- `src/cli/options.ts`：共享 commander 选项和 help 文案，例如 Nuwax 登录参数、serve/up 运行参数、模型覆盖参数。
- `src/commands/*.ts`：命令行为实现，只处理业务流程，不负责顶层命令树组织。
- `src/core/**`：可复用核心能力，例如 ACP、auth、engines、serve、sessions、ports。

约定：不要把新命令直接堆回 `src/cli.ts`；先判断属于哪个 `register*.ts`，需要复用的 option/help 放到 `src/cli/options.ts`。

## 推荐调试流程

### 1. 安装依赖

```bash
cd crates/nuwa-cli
pnpm install
```

### 2. 首次构建

```bash
pnpm run build
```

说明：

- `build` 会先执行 `tsc --noEmit` 做类型检查
- 然后调用 `scripts/build.mjs` 生成 `dist/cli.js`

如果你只是改了少量运行时代码，想跳过一次完整类型检查，可以用：

```bash
pnpm run dev:build
```

### 3. 环境自检

先确认本机运行条件没问题：

```bash
pnpm run dev:doctor
```

它会检查：

- Node 版本（**阻塞项**：未满足则退出码 `1`）
- `claude` / `codex` 是否可用（**至少一个**可用即可；两者都不可用则退出码 `1`）
- `uv`、macOS TCC 风险、Nuwax 云登录、本地会话历史（**可选项**：未满足时显示 `○` 而非 `✖`，`doctor` 仍退出 `0`）

说明：

- 可选项未配置（例如还没 `nuwa-cli login`）不算失败，适合脚本/CI 反复调用（例如 `pnpm run dev:doctor` 不应因未登录 Nuwax 而误报失败）。
- nuwa-cli 的登录态与 NuwaClaw Electron 客户端隔离；`doctor` 不检查也不读取客户端 DB，只提示手动 `login --domain --saved-key`。

## 逐项调试

### 调试基础 CLI 入口

```bash
pnpm run dev:cli --help
pnpm run dev:cli login --help
pnpm run dev:cli up --help
pnpm run dev:cli update --help
pnpm run dev:cli account --help
pnpm run dev:cli account switch --help
```

注意：当前 pnpm 会把命令后面的参数直接追加到脚本命令后面；不要额外插入 `--`，否则 `node dist/cli.js` 会收到一个多余的 `--` 并导致 commander 解析错位。

### 未发布 npm 时模拟安装运行

开发期最直接的方式是跑构建产物：

```bash
cd crates/nuwa-cli
pnpm install
pnpm run build
pnpm run dev:cli doctor
pnpm run dev:up --domain https://agent.nuwax.com --saved-key <key> --engine claude
```

如果要模拟“用户已经安装了 `nuwa-cli` 命令”的体验，可以用本地 link：

```bash
cd crates/nuwa-cli
pnpm install
pnpm run build
npm link
nuwa-cli --help
nuwa-cli doctor
```

调试结束后取消全局 link：

```bash
npm unlink -g nuwa-cli
```

如果要更接近 npm 发布后的安装形态，可以先打本地 tarball，再在临时目录安装：

```bash
cd crates/nuwa-cli
pnpm install
pnpm run build
mkdir -p /tmp/nuwa-cli-pack
pnpm pack --pack-destination /tmp/nuwa-cli-pack

tmpdir="$(mktemp -d)"
cd "$tmpdir"
npm init -y
npm install /tmp/nuwa-cli-pack/nuwa-cli-0.1.0.tgz
npx nuwa-cli --help
npx nuwa-cli doctor
```

这种方式会验证 `package.json` 的 `bin`、`files`、依赖解析和 `dist/cli.js` 产物是否像真实 npm 安装一样工作。未发布 npm 时不能通过 `npx @nuwax-ai/nuwa-cli@latest up` 拉取远端包，但可以用本地 tarball 的 `npx nuwa-cli up` 或 `npm link` 后的 `nuwa-cli up` 调试同一条命令。

### 调试 `update`

`update` 默认会执行全局包升级。开发期建议先用 `--dry-run` 验证命令拼接：

```bash
pnpm run dev:cli update --dry-run
pnpm run dev:cli update 0.2.0 --dry-run
pnpm run dev:cli update --package-manager pnpm --dry-run
```

只查询远端目标版本：

```bash
pnpm run dev:cli update --check
```

如果要验证安装态，可以先 `npm link` 或安装本地 tarball，再执行：

```bash
nuwa-cli update --dry-run
nuwa-cli update --check
```

`update` 不读写 `~/.nuwa-cli/credentials.json`，不会影响 savedKey、账号列表或正在运行的服务。真正执行 `nuwa-cli update` 后，需要重新打开 shell 或确认 `which nuwa-cli` 指向刚升级的全局包路径。

### 调试 `up`

`up` 会串联：检测可用引擎、登录/注册、启动 `serve --tunnel`。

savedKey 方式：

```bash
pnpm run dev:up --domain https://agent.nuwax.com --saved-key <key> --engine claude
```

账号密码方式：

```bash
pnpm run dev:up --domain https://agent.nuwax.com -u <username> --engine claude
```

非交互密码方式：

```bash
NUWACLI_PASSWORD='<password>' pnpm run dev:up \
  --domain https://agent.nuwax.com \
  -u <username> \
  --engine claude
```

如果同一 `domain + username` 已经在 `~/.nuwa-cli/credentials.json` 里保存过，`up -u` 会复用该账号 savedKey，避免后端新建电脑。不传 `--domain` / `-u` / `--saved-key` 时，`up` 会使用当前默认账号。

本地 tarball 方式：

```bash
cd crates/nuwa-cli
pnpm run build
mkdir -p /tmp/nuwa-cli-pack
pnpm pack --pack-destination /tmp/nuwa-cli-pack

tmpdir="$(mktemp -d)"
cd "$tmpdir"
npm init -y
npm install /tmp/nuwa-cli-pack/nuwa-cli-0.1.0.tgz
npx nuwa-cli up --domain https://agent.nuwax.com --saved-key <key> --engine claude
```

### 调试 `chat`

Claude 单次调用：

```bash
pnpm run dev:chat -p "hello"
```

Claude 交互模式：

```bash
pnpm run dev:chat
```

Codex 单次调用：

```bash
pnpm run dev:chat:codex -p "summarize this repository"
```

### 调试本地会话列表

查看全部本地历史：

```bash
pnpm run dev:sessions
```

只看 Claude：

```bash
pnpm run dev:sessions --engine claude
```

只看 Codex：

```bash
pnpm run dev:sessions --engine codex
```

### 调试 `sessions summary`

```bash
pnpm run dev:sessions:summary --engine claude --session-id <sessionId>
```

只看最近 5 条消息：

```bash
pnpm run dev:sessions:summary --engine claude --session-id <sessionId> --limit 5
```

### 调试跨引擎引用

这个能力不是“真续接”，而是在**新会话首轮**注入一个提醒，让模型按需去调用 `sessions summary`：

```bash
pnpm run dev:chat:codex --ref-session claude:<sessionId> -p "那个会话里最后决定了什么？"
```

注意：

- `--ref-session` 与 `--resume` 互斥
- `--ref-session` 只对新建会话的首轮有效

### 调试 `serve`

启动本地服务：

```bash
pnpm run dev:serve
```

健康检查：

```bash
curl http://127.0.0.1:60016/health
```

`serve` 会优先使用 `60016`，如果已占用会自动向后找可用端口；实际端口以启动日志或 `status` 为准。查看 serve 是否在运行及端口（读取 serve 启动时写的锁文件并探活 `/health`，无需 secret）：

```bash
pnpm run dev:cli status
```

如果调试 `/computer/chat`，需要从启动日志里拿到 `X-Nuwax-Internal-Secret`。

示例：

```bash
curl -X POST http://127.0.0.1:60016/computer/chat \
  -H "Content-Type: application/json" \
  -H "X-Nuwax-Internal-Secret: <secret>" \
  -d '{"prompt":"hello from curl"}'
```

### 调试 `login`

手动指定 savedKey（适合 CI 或无 Electron 客户端的环境）：

```bash
pnpm run dev:cli login --domain https://agent.nuwax.com --saved-key <key>
```

首次登录（交互输入密码）：

```bash
pnpm run dev:cli login --domain https://agent.nuwax.com -u <username>
```

nuwa-cli 不读取 NuwaClaw Electron 客户端登录数据。CLI 不使用 SQLite，凭证只写入 `~/.nuwa-cli/credentials.json`；同一 `domain + username` 已保存时会复用 savedKey。无当前默认账号、无 CLI 自有 savedKey 且未传 `--saved-key` / `-u` 时，`login` 会直接失败并提示手动提供登录参数。

调试多账号：

```bash
pnpm run dev:cli account list
pnpm run dev:cli account switch <account-key>
```

`account switch` 会重新注册目标账号并设置为当前默认账号。切换会影响 `serve`、file-server、lanproxy 和后端注册状态，不支持热切换；如果 `serve` 正在运行，先在运行 `up/serve` 的终端按 `Ctrl-C`，再执行切换并重新启动服务。

查看当前登录态：

```bash
pnpm run dev:cli status
```

### 调试 `serve --tunnel`

先确保已经登录（见上方 `login` 小节）：

```bash
pnpm run dev:cli login --domain https://agent.nuwax.com --saved-key <key>
```

再启动：

```bash
pnpm run dev:cli serve --port 60016 --tunnel \
  --lanproxy-path resources/lanproxy \
  --lanproxy-host agent.nuwax.com \
  --lanproxy-port 443
```

注意：`nuwax-file-server` 随 CLI 的 npm/pnpm 依赖安装；lanproxy 是 CLI 自己的预置资源，源码目录在 `crates/nuwa-cli/resources/lanproxy`，构建时会复制到 `dist/resources/lanproxy`。`--lanproxy-path`、`config set lanproxy-path` 或 `NUWACLI_LANPROXY_PATH` 只用于覆盖内置资源或调试指定二进制。若注册接口返回 `serverHost`/`serverPort`，可省略 `--lanproxy-host` / `--lanproxy-port`。

工作空间：未传 `--cwd` 时，`serve/up` 使用 `~/.nuwa-cli/workspaces` 作为默认根目录；云端请求里的 `project_id` 会映射到 `~/.nuwa-cli/workspaces/<project_id>`，`agent_work_dir` / `session_id` 仅在缺少 `project_id` 时作为兼容 fallback。`user_id` 只作为请求元数据，不参与本地路径。传了 `--cwd <dir>` 时，`<dir>` 就是当前项目目录本身，不会再追加 `project_id`。file-server 使用同一活动目录/根目录。

端口隔离：HTTP API 默认优先 `60016`，file-server 默认优先 `60015`；两者若被占用都会自动后移。file-server 的 PID/lock 临时目录按端口固定在 `~/.nuwa-cli/tmp/file-server-<port>`，不会复用系统默认的 `nuwax-file-server` 全局 PID 目录。

后台运行：

```bash
pnpm run dev:cli up --engine claude --daemon
tail -f ~/.nuwa-cli/logs/latest.log
```

`--daemon` 会让 serve 脱离当前终端，原始 stdout/stderr 追加到 `~/.nuwa-cli/logs/serve.log`；它不会设置开机自启动。调试当前用户级开机/登录启动：

```bash
pnpm run dev:cli service install --engine claude --now
pnpm run dev:cli service status
pnpm run dev:cli service stop
pnpm run dev:cli service uninstall
```

`service install` 会把当前 `dist/cli.js` 写入系统启动项，因此本地开发时重新构建后仍指向同一个 dist 路径。macOS 写入 `~/Library/LaunchAgents/com.nuwax.nuwa-cli.plist`，Linux 写入 `~/.config/systemd/user/com.nuwax.nuwa-cli.service`，Windows 写入当前用户计划任务 `NuwaCLI`。启动项不会写入 `NUWACLI_PASSWORD`、savedKey/configKey 或模型 API key；登录态仍从 `~/.nuwa-cli/credentials.json` 读取。Linux 默认用户登录后启动，如需未登录也启动，需要系统启用 linger。

日志规则对齐客户端：CLI 结构化运行日志写入 `~/.nuwa-cli/logs/main.YYYY-MM-DD.log`，`latest.log` 指向当日活跃日志；`up-debug.log` 保留为兼容别名。`--daemon` 的原始 stdout/stderr 仍会追加到 `serve.log`，主要用于查看启动命令输出。

## 测试建议

### 跑全部测试

```bash
pnpm run test:run
```

### 只跑某个测试文件

```bash
pnpm run test:run -- tests/transcript.test.ts
```

### 跑会话相关回归

```bash
pnpm run test:run -- tests/transcript.test.ts tests/sessionsSummary.test.ts tests/resolveRefSessionReminder.test.ts
```

### 跑 `doctor` / `login` / account 回归

```bash
pnpm run test:run -- tests/doctor.test.ts tests/doctorChecks.test.ts tests/login.test.ts tests/account.test.ts tests/credentials.test.ts tests/update.test.ts
```

### 监听模式

```bash
pnpm test
```

## 常见问题

### 为什么脚本都指向 `dist/cli.js`，而不是直接跑 `src/cli.ts`？

当前包使用 `scripts/build.mjs` 产物作为实际运行入口，最接近发布态；调试 `dist/cli.js` 能减少“源码直跑”和打包产物行为不一致的问题。

### 为什么有 `build` 和 `dev:build` 两个脚本？

- `build`：适合提交前或验证完整类型安全
- `dev:build`：适合本地快速重打包

### 为什么这里的 `pnpm run ...` 示例没有加第二个 `--`？

当前仓库使用的 pnpm 会把脚本名后面的参数直接追加到脚本命令后面；额外加 `--` 反而会让 `node dist/cli.js` 收到一个多余的 `--`，导致 commander 解析错位。因此本文示例统一写成 `pnpm run dev:cli login --help`、`pnpm run dev:up --domain ...`。

### `dev:doctor` 退出码为 0，但输出里有 `○` 未配置项，正常吗？

正常。`○` 表示可选项（`uv`、Nuwax 登录等）尚未配置，不影响 `chat` 等核心功能；只有 `✖`（阻塞项，如 Node 版本不符或 claude/codex 都不可用）才会让 `doctor` 退出 `1`。
