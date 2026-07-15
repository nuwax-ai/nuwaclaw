# 开发方案：`serve` 生命周期与权限模型

> 本文件留存 `nuwa-cli serve` 子系统在首版发布前 code-review 后的一轮修复的**设计决策**，供后续维护与回归参考。
> 行为契约（用户视角）见 [README.md](../README.md) 的 `serve` 段；发布记录见 [CHANGELOG.md](../CHANGELOG.md) 的 `### Fixed`。
> 代码主入口：`src/core/serve/sessionHub.ts`、`src/core/serve/server.ts`、`src/commands/serve.ts`、`src/core/acp/connection.ts`。

## 背景

`serve` 把 `chat` 的引擎能力以本地 HTTP API + SSE 的形式暴露出来（`/computer/chat`、`/computer/progress/:id`、`/computer/agent/status|stop`）。首版实现里，会话生命周期与权限模型存在一组互相关联的缺陷：关闭不彻底、停止不可中断、死亡会话变僵尸、权限模型默认过宽。这些问题彼此叠加（例如"关闭不清理"既影响引擎子进程，也影响 file-server，也影响 SSE 连接），因此作为一次整体方案处理。

## 问题清单（review 发现，已修）

| # | 问题 | 严重度 |
|---|---|---|
| 1 | `--approve` 任何非 `"deny"` 的值都静默映射为 `yolo`（全自动批准）；且 `yolo` 路径无路径越界守卫 | 安全 |
| 2 | `serve` 关闭只 `server.close()`，从不停止 `SessionHub` 中的引擎子进程 | 资源泄漏 |
| 3 | `server.close()` 未配合 `closeAllConnections()`，SSE / keepalive 连接导致关闭挂起 | 挂起 |
| 4 | 引擎在 `ready` 之后死亡：`.catch` 里的二次 `readyResolve` 是空操作，会话永不从注册表移除（僵尸） | 正确性 |
| 5 | `stopSession` 只 `queue.close()`，不发 `session/cancel`、不杀引擎，无法中断在跑的 prompt → `/computer/agent/stop` 长时间挂起 | 挂起 |
| 6 | `startFileServer` 以 `detached:true` + `unref()` 启动，`stopFileServer` 是死代码从未被调用 → 每次 `serve --tunnel` 泄漏一个 file-server | 资源泄漏 |

## 设计方案

### 1. 会话可中断：`AbortController` 透传（#5 的基础）

`withEngineConnection` 增加可选第 4 参 `signal?: AbortSignal`（向后兼容：`chat` 不传，`serve` 传）。

- `signal` 触发时对引擎子进程 `proc.kill()`（SIGTERM）。引擎死亡 → stdout 流关闭 → `ndJsonStream` 报错 → 阻塞中的 `ctx.request(session/prompt)` 被 reject → `op` reject → `withEngineConnection` 的 `catch` 命中 `signal?.aborted` 分支，抛出"引擎会话已被中止"。
- `finally` 里 `proc.kill()` 兜底，并 `removeEventListener` 清理。
- **为何用 kill 而非 `session/cancel`**：ACP 的 `session/cancel` 在两个引擎实现里支持度不一，且即便发了，引擎也未必及时中止正在执行的工具；直接终结进程是最确定的中断手段。代价是"强制"，故在文档中如实标注（stop 是 bounded 但 forceful）。
- `SessionHub.stopSession`：`abortController.abort()` 后用 `Promise.race` 加 **3 秒硬上限**等待 `session.done`，防止引擎忽略 SIGTERM 时把 stop（进而把 `serve` 关闭）拖死。

### 2. 会话终结统一收口：`terminateSession`（#4）

新增私有方法 `terminateSession(sessionId, error?)`，在会话运行的**所有退出路径**（resolve 失败 / 引擎死亡 / 被中止 / 队列排空正常退出）末尾调用：

- 广播终结 SSE 事件 `session_ended`（`subType` 为 `error` 或 `ended`）；
- 对所有挂载的 SSE `res` 调 `end()`，再清空集合；
- 从 `sessions` Map 删除。

幂等：`stopSession` 与 runner 末尾都会调，谁先谁后，另一方为空操作。这样解决了"僵尸会话"与"SSE 客户端永远等下去"两个症状。

### 3. 关闭时全量停止：`stopAll`（#2）

`SessionHub.stopAll()` 并发地对每个活动会话执行 `stopSession`。`server.stop()` 改为 `async`：先 `hub.stopAll()`（拆除所有引擎子进程），再关 HTTP。

### 4. HTTP 关闭不挂起：`closeAllConnections`（#3）

`server.stop()` 在 `server.close(cb)` 之前调 `server.closeAllConnections()`，主动断开所有连接（含 SSE 流、keepalive），保证 `close` 的回调能触发，关闭不再挂起。

### 5. file-server 关闭（#6）

`serve.ts` import 并在 shutdown 里调用既有的 `stopFileServer()`；用 `fileServerStarted` 标志确保只有真正启动过才停。

### 6. `--approve` 校验 + yolo 告警（#1）

- 显式校验 `--approve` 只接受 `auto` / `deny`，其他值（拼写错误如 `deni`、`strict`）直接报错退出，不再静默退化为 `yolo`。
- yolo 模式启动时打印醒目安全提示：所有工具调用（含破坏性写/命令/网络）都会被自动放行、且无路径限制。
- **路径越界守卫未移植**（见"暂未覆盖"），仅以告警形式如实暴露风险。

## 涉及文件

| 文件 | 改动 |
|---|---|
| `src/core/acp/connection.ts` | `withEngineConnection` 加 `signal` 参数；abort 时 kill；`finally` 清理监听 |
| `src/core/serve/sessionHub.ts` | `ManagedSession` 加 `abortController`；新增 `terminateSession` / `stopAll`；`stopSession` 中断+限时；所有退出路径收口 |
| `src/core/serve/server.ts` | `stop()` 改 async：`hub.stopAll()` → `closeAllConnections()` → `close()`；listening 写 serve 锁、stop 清锁 |
| `src/commands/serve.ts` | `--approve` 校验；yolo 告警；shutdown 调 `stopFileServer` |
| `tests/fixtures/mock-acp-agent.mjs` | 新增 `trigger-hang` 模式（永不回应 session/prompt） |
| `tests/connection.test.ts` | 新增 abort 中断用例 |
| `src/core/serve/serveLock.ts` | 新增：serve 锁读写 + `/health` 探活 + `getServeStatus`（PID 已死则自动清残留锁） |
| `src/util/paths.ts` | 新增 `cliServeLockPath()`（含 `NUWACLI_SERVE_LOCK_PATH` 测试覆盖） |
| `src/commands/login.ts` | `status` 增加 serve 运行态报告（端口/PID/地址） |
| `tests/serveLock.test.ts` | 锁读写 / 探活 / 僵尸清理 / startServeHttp 写锁-清锁集成 |

## 回归对照

| 契约 | 验证方式 |
|---|---|
| abort 能中断挂起的 prompt 并拆除引擎 | `tests/connection.test.ts`："interrupts a hung prompt when the abort signal fires" |
| resolve 失败 → 502 且不留僵尸 | `tests/server.test.ts`："surfaces engine resolution failure as a 502 and doesn't leave a zombie session" |
| 全套不破坏既有行为 | `vitest run`：113/113 通过；`tsc --noEmit`：通过 |
| 手工回归 `serve` 关闭 | 启 `serve` → 发 chat → Ctrl-C：应无 `claude-code-acp-ts` / `nuwax-codex-acp` / `nuwax-file-server` 残留进程 |
| 手工回归 `/agent/stop` 中断 | 会话执行长工具时 POST stop，应在数秒内返回，引擎进程随之退出 |
| `status` 反映 serve 运行态 | `tests/serveLock.test.ts`：写锁/读锁/探活/僵尸清理；手工：起 `serve` → `status` 见"运行中 端口 X"，停后 `status` 见"未运行"且锁文件已清 |

## 暂未覆盖（后续项）

以下在本次方案中**有意未做**，记录于此便于后续跟进：

1. **yolo 路径越界守卫**：未移植 Electron 客户端的 strict-permission gate。需要 workspace 根跟踪 + 按工具类型解析目标路径，工作量较大，建议单独立项。当前仅启动告警。
2. **进程树清理（孙进程孤儿）**：`proc.kill()` 仅 SIGTERM 直接子进程；`claude-code-acp-ts` 再拉起的 `claude` 等孙进程不受信号。建议改为 `detached:true` spawn + 进程组 kill。注意：本方案的 abort/stopAll 也走同一个 `proc.kill`，因此 serve 路径同样未覆盖孙进程。
3. **SIGTERM → SIGKILL 升级**：当前只发 SIGTERM；若引擎忽略信号，靠 `stopSession` 的 3s 上限兜底（强制返回，但底层 runner promise 会延迟回收）。

## 可观测性：serve 锁与 `status`

`serve` 在 `listening` 时写一份**不含 secret**的轻量锁 `~/.nuwa-cli/serve.lock`（`{pid, port, host, startedAt}`），`stop()` 清除。`nuwa-cli status` 读取该锁并探活 `GET /health`（无需 secret），输出运行态：

- **运行中**：端口 / PID / 启动时间 / 地址；并提示 `X-Nuwax-Internal-Secret` 仅启动时打印、未落盘（要调用 `/computer/chat` 仍需从启动日志取 secret）。
- **异常**：锁存在、PID 活着但 `/health` 无响应（可能仍在启动或不健康）。
- **未运行**：无锁；若锁存在但 PID 已死，自动清理残留锁并提示。

设计要点：**secret 永不落盘**的承诺不变——锁里只有 pid/port/host/startedAt，是可观测性数据，不是凭证。

## 决策记录

- **为什么把生命周期细节放进 `docs/` 而非 README**：README 面向使用者，只保留行为契约；设计动机、方案选型、暂缓项属于开发方案，留存在本目录便于维护与回归，避免 README 膨胀。
- **为什么 `stopSession` 用 kill 而非 `session/cancel`**：见上文"会话可中断"。
