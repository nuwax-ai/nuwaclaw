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

- Node 版本
- `claude` / `codex` 是否可执行
- 登录态
- 本地会话历史
- 与 `serve` 相关的依赖状态

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

### 调试 `serve --tunnel`

先确保已经登录：

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
