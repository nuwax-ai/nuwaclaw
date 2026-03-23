# Code Review: reg 与自动重连逻辑

**审查范围**：App.tsx 自动重连、auth.ts syncConfigToServer、processHandlers.ts Lanproxy 启动  
**结论**：逻辑正确，注释与行为一致；有少量可改进点。

---

## 1. 已做对的部分

### 1.1 先 reg 成功再启动服务

- **savedKey 路径**：`syncConfigToServer()` 被 `await`，只有 `result` 为真时才调用 `startServicesSequentially()`，不会在 reg 失败时启动服务。
- **配置来源**：`syncConfigToServer` 内用本次 reg 的 `response.serverHost` / `response.serverPort` 调用 `saveServerConfig()`，lanproxy 启动时从 settings 读到的已是本次 reg 写入的最新值。

### 1.2 reg 返回可能变化的处理

- `syncConfigToServer` 在 reg 成功后将本次返回的 `serverHost`/`serverPort` 写回配置，并返回 response；调用方在 reg 成功后再启动，符合「用本次最新结果」的语义。
- 注释在 App.tsx 与 auth.ts 中已说明「reg 返回可能会变化，先写配置再启动」。

### 1.3 失败与提示

- reg 失败（`result` 为 null）时只打日志 + notification，不启动服务，行为与注释一致。
- 异常被 try/catch 捕获，避免未处理 Promise rejection。

### 1.4 代码质量

- 当前修改未引入新的 lint 报错。
- 类型与现有风格一致（仅个别 `as any` 为既有写法）。

---

## 2. 可改进点（非必须）

### 2.1 「向导刚完成」路径未再调 reg

- **现状**：`setupJustCompleted.current === true` 时直接 `startServicesSequentially(...)`，不调用 `syncConfigToServer`。
- **原因**：向导完成时通常刚执行过登录，`loginAndRegister` 已调过 reg 并执行 `saveServerConfig`，配置已是最新。
- **建议**：若希望与「重新打开客户端」完全统一（始终先 reg 再启动），可在该分支也先 `await syncConfigToServer({ suppressToast: true })`，成功后再 `startServicesSequentially`；否则保持现状即可，在注释中注明「向导刚完成时假定登录流程已执行 reg，直接使用当前配置启动」。

### 2.2 自动重连中的 catch 未对用户提示

- **现状**：`autoReconnect` 的 `catch` 仅 `console.error('[App] 自动重连失败:', error)`，用户无 toast。
- **建议**：若希望网络异常等未预期错误也有提示，可在 catch 里补一次 `notification.warning`（与 `result` 为 null 时的文案区分开，例如「自动重连异常，请稍后重试或手动启动服务」），避免重复可复用现有「自动重连失败」的 key 或 message。

### 2.3 类型收紧（低优先级）

- `startServicesSequentially` 内 `agentConfig`、`lpConfig` 使用 `as any`，后续可改为具体类型（如从 shared 或 api 类型中抽取），便于后续扩展 reg 返回字段时的类型安全。

---

## 3. 与 processHandlers 的衔接

- Lanproxy 启动仍从主进程 `readSetting('lanproxy_config')` / `lanproxy.server_host` / `lanproxy.server_port` 读配置；这些值由渲染进程侧 `saveServerConfig` 经 IPC 写入，顺序为「reg 成功 → syncConfigToServer 写配置 → 再启动服务」，因此主进程读到的已是本次 reg 写入的最新配置，无需改 processHandlers。

---

## 4. 已修复：账号切换后 lanproxy 使用旧 clientKey（2026-03-12）

### 问题

**场景一：不退出直接切换账号**

`handleLogin` 在 `handleStartService('lanproxy')` 时传入新账号的 `clientKey`，但主进程 `startLanproxyProcess` 检测到 `ctx.lanproxy.running === true`（旧进程仍在），直接返回 `success: true` 而不重启 → 旧 key 继续使用 → 服务端认为是旧账号 → 新账号会话显示「客户端离线」。

**场景二：退出登录后用新账号登录**

`handleLogout` 会停止所有服务（agent/fileServer/lanproxy/mcpProxy/computerServer）并清除 auth 信息。用户用新账号登录时 `handleLogin` 执行 `loginAndRegister` → 写入新 configKey/savedKey → 启动服务。由于 logout 已停掉所有服务，lanproxy 的 `ctx.lanproxy.running === false`，新进程用新 `clientKey` 正常启动。此场景在修复前已能正常工作。

### 修复

在 `processHandlers.ts` 的 `startLanproxyProcess` 中，将「已运行则跳过」改为「已运行则异步停止（等待进程退出）再用本次传入的 config 重启」：

```typescript
if (ctx.lanproxy.running) {
  // 切换账号后 clientKey 会变化，必须用新配置重启，不能跳过。
  // 否则旧进程继续使用旧 clientKey 导致「本地显示已联通、会话显示离线」。
  log.info('[Lanproxy] 已在运行，先停止再用新配置重启');
  await ctx.lanproxy.stopAsync();
}
```

`stopAsync()` 发送 SIGTERM 并等待进程 `exit` 事件（5s 超时后 SIGKILL），确保端口/资源释放后再启动新进程。

**修改点**：
- `src/main/processManager.ts`：新增 `stopAsync()` 方法（含 stdio 监听器清理，防止 Windows 句柄泄漏）
- `src/main/ipc/processHandlers.ts`：`startLanproxyProcess` 内的 running 守卫改用 `await stopAsync()`

| 场景 | 修复前 | 修复后 |
|------|--------|--------|
| 不退出直接切换 | ❌ lanproxy 用旧 key，新账号离线 | ✅ 先停旧进程再用新 config 启动 |
| 退出后用新账号登录 | ✅ logout 已停服务，正常启动 | ✅ 未运行，直接启动 |
| 任何路径调用 lanproxy:start | ❌ 已运行时跳过 | ✅ 始终应用本次传入的配置 |

---

## 5. 总结

| 项目           | 状态 |
|----------------|------|
| reg 成功后才启动服务 | 正确 |
| 使用本次 reg 返回的配置 | 正确（通过 saveServerConfig 写再读） |
| 注释与行为一致   | 是 |
| 失败分支与提示   | 正确，catch 可考虑补用户提示 |
| 向导完成路径     | 合理，若需统一可先 reg 再启动 |
| 账号切换时先停旧服务 | 已修复（2026-03-12） |
| 手动启动单个服务时先 reg | 已补充（2026-03-12） |

**结论**：当前实现满足「等待 reg 成功返回后才启动服务」且「使用 reg 可能变化后的最新配置」；账号切换场景已通过先停后启修复；手动启动单个服务场景已补充先 reg 再启动。

---

## 6. 手动启动单个服务时补充 reg 调用（2026-03-12）

### 问题

**场景**：用户在 ClientPage 点击某个服务的「启动」按钮（非「启动全部」、非登录流程）。

此前 `handleStartService(svc.key)` 直接启动目标服务，**不调用 reg**。这意味着：

- 如果后端 `serverHost`/`serverPort` 发生过变化（如服务端重新分配端口），lanproxy 启动时读到的是旧值。
- 与「登录」和「启动全部」行为不一致——它们都在启动服务前/后调用 `syncConfigToServer()`。

### 修复

新增 `handleStartServiceManual` 包装函数，UI 按钮 onClick 改为调用此函数：

```typescript
const handleStartServiceManual = async (key: string) => {
  // 先 reg，确保 lanproxy 等服务启动时使用最新的后端返回数据
  try {
    await syncConfigToServer({ suppressToast: true });
  } catch (e) {
    console.error('[ClientPage] 手动启动服务前 reg 同步失败:', e);
  }
  await handleStartService(key);
  onAuthChange?.();
};
```

### 时序对比

| 场景 | reg 时机 | 启动时机 |
|------|----------|----------|
| 登录流程 (`handleLogin`) | `loginAndRegister()` + 启动非代理服务后 `syncConfigToServer()` | reg 后启动 lanproxy |
| 启动全部 (`handleStartAll`) | 启动非代理服务后 `syncConfigToServer()` | reg 后启动 lanproxy |
| **手动启动单个** (`handleStartServiceManual`) | **先 `syncConfigToServer()`** | **reg 后启动目标服务** |

三个场景均保证 **reg 在服务启动之前完成**，lanproxy 读到的 `serverIp`/`serverPort` 为 reg 返回的最新值。

### 修改点

- `src/renderer/components/pages/ClientPage.tsx`：新增 `handleStartServiceManual`，单个服务「启动」按钮 onClick 改用此函数
