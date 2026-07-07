# 本地调试指南

> 面向 `crates/nuwaclaw-cli` 包本身的开发与联调。
> 设计与行为说明见 [`README.zh-CN.md`](../README.zh-CN.md) / [`README.md`](../README.md)；
> `serve` 生命周期设计见 [`serve-lifecycle.md`](./serve-lifecycle.md)。

## 前置条件

- Node.js >= 22
- 已安装依赖：在 `crates/nuwaclaw-cli` 目录执行 `pnpm install`
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
    "dev:serve": "node dist/cli.js serve --port 60016",
    "test": "vitest",
    "test:run": "vitest run"
  }
}
```

## 推荐调试流程

### 1. 安装依赖

```bash
cd crates/nuwaclaw-cli
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
- `uv`、gui-agent MCP、macOS TCC 风险、Nuwax 云登录、本地会话历史（**可选项**：未满足时显示 `○` 而非 `✖`，`doctor` 仍退出 `0`）

说明：

- 可选项未配置（例如还没 `nuwaclaw login`、没装 gui-agent）不算失败，适合脚本/CI 反复调用（例如 `pnpm run dev:doctor` 不应因未登录 Nuwax 而误报失败）。
- 若本机已安装 NuwaClaw Electron 客户端且存在 `~/.nuwaclaw/nuwaclaw.db`，Nuwax 登录项的修复提示会建议直接运行 `nuwaclaw login` 复用客户端已保存的登录（`doctor` 本身只检查 db 文件是否存在，不会读取 sqlite）。

## 逐项调试

### 调试基础 CLI 入口

```bash
pnpm run dev:cli -- --help
```

注意：通过包管理器转发参数时，`--` 不能省略。

### 调试 `chat`

Claude 单次调用：

```bash
pnpm run dev:chat -- -p "hello"
```

Claude 交互模式：

```bash
pnpm run dev:chat
```

Codex 单次调用：

```bash
pnpm run dev:chat:codex -- -p "summarize this repository"
```

带 `gui-mcp` 的调试：

```bash
pnpm run dev:chat -- --gui-mcp -p "take a screenshot"
```

### 调试本地会话列表

查看全部本地历史：

```bash
pnpm run dev:sessions
```

只看 Claude：

```bash
pnpm run dev:sessions -- --engine claude
```

只看 Codex：

```bash
pnpm run dev:sessions -- --engine codex
```

### 调试 `sessions summary`

```bash
pnpm run dev:sessions:summary -- --engine claude --session-id <sessionId>
```

只看最近 5 条消息：

```bash
pnpm run dev:sessions:summary -- --engine claude --session-id <sessionId> --limit 5
```

### 调试跨引擎引用

这个能力不是“真续接”，而是在**新会话首轮**注入一个提醒，让模型按需去调用 `sessions summary`：

```bash
pnpm run dev:chat:codex -- --ref-session claude:<sessionId> -p "那个会话里最后决定了什么？"
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
pnpm run dev:cli -- login --domain https://agent.nuwax.com --saved-key <key>
```

首次登录（交互输入密码）：

```bash
pnpm run dev:cli -- login --domain https://agent.nuwax.com -u <username>
```

若本机已用 NuwaClaw Electron 客户端登录过，且 nuwaclaw-cli 自己尚未登录，可直接运行：

```bash
pnpm run dev:cli -- login
```

会检测 `~/.nuwaclaw/nuwaclaw.db` 中保存的登录（只读），单个匹配时确认复用，多个匹配时弹出选择器。只导入凭证值，注册时仍使用 nuwaclaw-cli 自己的 device id，与 Electron 客户端会话独立。`--domain` 可缩小检测范围：

```bash
pnpm run dev:cli -- login --domain https://agent.nuwax.com
```

查看当前登录态：

```bash
pnpm run dev:cli -- status
```

### 调试 `serve --tunnel`

先确保已经登录（见上方 `login` 小节；有 Electron 客户端时可直接 `pnpm run dev:cli -- login`）：

```bash
pnpm run dev:cli -- login --domain https://agent.nuwax.com --saved-key <key>
```

再启动：

```bash
pnpm run dev:cli -- serve --port 60016 --tunnel
```

注意：当前只会启动本地 `nuwax-file-server`，不会真正建立云端 lanproxy 隧道。

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

### 跑 `doctor` / `login` / Electron 导入回归

```bash
pnpm run test:run -- tests/doctor.test.ts tests/doctorChecks.test.ts tests/login.test.ts tests/electronImport.test.ts
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

### 为什么 `pnpm run ... -- ...` 后面一定要加第二个 `--`？

因为前一个 `--` 是告诉 `pnpm`：后面的参数不要自己消费，而是转发给脚本里的 `node dist/cli.js ...`。

### `dev:doctor` 退出码为 0，但输出里有 `○` 未配置项，正常吗？

正常。`○` 表示可选项（`uv`、gui-agent、Nuwax 登录等）尚未配置，不影响 `chat` 等核心功能；只有 `✖`（阻塞项，如 Node 版本不符或 claude/codex 都不可用）才会让 `doctor` 退出 `1`。
