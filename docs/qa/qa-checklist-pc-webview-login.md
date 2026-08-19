# PC 客户端 · nuwax webview 登录统一 · 验收清单

> **改造范围**：nuwaclaw 桌面客户端将 nuwax PC 站点嵌入为主窗口，登录全生命周期（初始登录 / token 失效重登 / 主动登出）统一到 nuwax webview `/Login`，废弃 nuwaclaw 自有 SetupWizard 与 configKey/savedKey reg 链路；并打通服务启停联动、本地联调 CORS、mac 红绿灯 UI 避让。
>
> **日期**：2026-08-12 ｜ **仓库**：nuwaclaw（改动主体）+ nuwax（bridge 钩子，feat/chatkit-adapter 分支） ｜ **状态**：验收中（未提交）
>
> **配对文档**：[`pc-webview-login-requirements.md`](../requirements/pc-webview-login-requirements.md)（功能需求描述·回溯）。
> **关联 Plan**：`~/.claude/plans/pc-5-nuwaclaw-electron-rust-acp-moonlit-kettle.md`

---

## 一、本次落地改动一览

| # | 模块 | 改动要点 | 关键文件（nuwaclaw） |
|---|------|----------|----------------------|
| 1 | Phase 1 首屏 | 启动直出 nuwax webview，跳过 SetupWizard 门控（强制 `isSetupComplete=true`） | `src/renderer/App.tsx` |
| 2 | Phase 2 启停联动 | 登录成功→best-effort 起服务；登出 / 401 失效→停全部服务 | `src/main/ipc/nuwaxBridgeHandlers.ts`、`src/main/ipc/processHandlers.ts` |
| 3 | dev 联调 CORS | 请求来源 origin 为 localhost/127.0.0.1 时**跳过** `x-client-type` 注入（避免 preflight） | `src/main/main.ts` |
| 4 | webview 指向 + 日志 | dev 加载本地 nuwax dev server（localhost:3000），打印实际加载地址 | `src/renderer/components/pages/NuwaxHostWebview.tsx` |
| 5 | UI 避让 | config 模式顶栏左侧让出 80px 避让 mac 原生红绿灯 | `src/renderer/App.tsx` |
| 6 | 顶栏账号同步 | 顶栏登录态**以 webview token 为最优先**（纯 `nuwax:authChanged` 事件驱动，configKey 残留不再覆盖；getToken 未登录也推 false 纠正）；未登录显「未登录」（非引导性「去登录」，顶栏仅作状态指示） | `nuwaxBridgeHandlers.ts`、`preload/index.ts`、`App.tsx`、`shared/locales/*` |
| 7 | 去原生退出 | 移除 ClientPage 退出按钮 + handleLogout（退出统一由 nuwax webview 用户菜单承担） | `ClientPage.tsx` |
| 8 | ClientPage 登录态以 webview 为准 | ClientPage 登录状态显示跟随 nuwax token（App 传 `isWebviewLoggedIn`）；未登录不再露原生 domain/账号/密码登录表单，改引导去 webview；业务门禁 `handleStartAll`(reg 依赖)仍用 configKey | `ClientPage.tsx`、`App.tsx`、`shared/locales/*` |

> nuwax 侧本阶段不改逻辑，仅 bridge 钩子（`auth:persistToken` / `auth:clear` 调用方）已在 `feat/chatkit-adapter` 分支落地。

---

## 二、验收环境

| 项 | 命令 / 位置 |
|----|-------------|
| nuwax 本地 dev | `cross-env UMI_ENV=development max dev`（localhost:3000） |
| nuwaclaw 本地 dev | `make electron-dev`（= `crates/agent-electron-client` 下 `npm run dev`，vite :60173 + electron） |
| nuwaclaw 运行日志 | `~/.nuwaclaw/logs/latest.log`（软链到 `main.YYYY-MM-DD.log`） |
| electron-dev 启动日志 | `/Users/apple/workspace/nuwaclaw/logs/electron-dev.log` |
| webview devtools | webview 内右键→检查，或 `Cmd+Option+I` |

---

## 三、验收项（操作 / 预期 / 日志 / 结果）

> 结果标记：✅ 已实证通过 ｜ ⏳ 待操作 ｜ ⚠️ 有瑕疵

### 项 1 — webview 首屏直出（Phase 1） ✅
- **操作**：启动客户端。
- **预期 UI**：开窗即见 nuwax webview（dev 为 localhost:3000 的登录/页面），**不再出现 SetupWizard**。
- **预期日志**：`[NuwaxHostWebview] resolved webview url { dev:true, url:'http://localhost:3000' }`
- **结果**：✅ 18:47:15 实测 `url: 'http://localhost:3000'`（dev override 生效，忽略 step1 的 testagent）。

### 项 2 — dev 联调 CORS（origin 跳过 x-client-type） ✅
- **操作**：webview devtools → Network → 触发登录请求。
- **预期**：登录请求到 `testagent.xspaceagi.com` **成功返回 token**，**无 CORS preflight 失败**；Request Headers **不含** `x-client-type`。
- **预期日志**：`x-client-type header injection enabled (skipped for localhost/127.0.0.1 dev origin)`
- **结果**：✅ 18:47:12 实测注入按 origin 跳过；登录请求成功（见项 3/6 的 token 流转）。

### 项 3 — 登录 → 起服务（Phase 2，best-effort） ✅
- **前提**：先停全部服务（托盘 Stop All，或项 4 登出停），确认 `isAnyCoreServiceRunning()=false`。
- **操作**：在 nuwax `/Login` 完成登录。
- **预期日志**：
  ```
  [NuwaxBridge] auth:persistToken saved { scope: 'http://localhost:3000' }
  [NuwaxBridge] login → starting services (best-effort)
  ```
- **预期 UI**：托盘/服务状态显示 fileServer、lanproxy、agentRunner 起来。
- **结果**：✅ 通过（2026-08-12 用户实测：nuwax `/Login` 登录成功 → `auth:persistToken` → 服务起来）。

### 项 4 — 主动登出 → 停服务（Phase 2） ✅
- **操作**：登录态下，nuwax 右上角用户头像 → 退出登录。
- **预期 UI**：webview 回 `/Login`；托盘/服务状态显示**全部服务停止**。
- **预期日志**：`[NuwaxBridge] auth:clear { scope:'http://localhost:3000' }` + 各服务 stopped。
- **结果**：✅ 18:50:36 完整实证——`auth:clear` → `stopAllServicesNow()` → 9 个服务全 `success:true`：
  ```
  All services stopped: { agent✓ fileServer✓ lanproxy✓ ttyd✓ mcpProxy✓ windowsMcp✓ guiAgentServer✓ engines✓ computerServer✓ }
  [ComputerServer] Stopped + clearing TCP listeners on port 60006
  ```

### 项 5 — token 失效(401) → 停服务（Phase 2） ⏳
- **操作**：登录后，devtools Console 执行 `localStorage.setItem('ACCESS_TOKEN','invalid_xxx')` 改坏 token，再触发任意鉴权请求（发消息/刷新）使其 401。
- **预期 UI**：nuwax 自动回 `/Login`（`USER_NO_LOGIN` 分支）；服务全部停止。
- **预期日志**：同项 4 的 `auth:clear` + 停服务。
- **结果**：⏳ 待操作（项 4 已证明 clear→停服务链路，本项验 nuwax 侧 401→clear 触发）。

### 项 6 — 重启免登 ✅（初步）
- **操作**：登录成功后完全退出客户端，再 `make electron-dev` 重启。
- **预期 UI**：直接进 nuwax 业务页（不再要求登录）——靠 defaultSession localStorage 持久化 + bridge sqlite 备份。
- **预期日志**：`[NuwaxBridge] auth:getToken { scope, hasToken:true }`（启动 getInitialState 取回 token）。
- **结果**：✅ 初步——18:47:23 `auth:getToken hasToken:true`（bridge 备份可读）。完整重启免登待显式「退出→重启」操作确认。

### 项 7 — mac 红绿灯避让（UI 修复） ✅
- **操作**：登录后点左下齿轮 → 切到 **config 模式**，观察顶栏左侧。
- **预期 UI**：`首页 | 配置` Segmented（及未登录时 logo）**右移 80px，不再被 mac 三个红绿灯遮挡**；Win/Linux 下左侧无空缺（`paddingLeft:0`）。
- **结果**：✅ 通过（2026-08-12 用户实测：config 模式顶栏左侧右移 80px 避让 mac 红绿灯）。

### 项 8 — 顶栏账号状态以 webview 为最优先 ⏳
> **原则**：原生顶栏登录态完全跟随 nuwax webview token，**不因 nuwaclaw configKey 残留而显示「伪已登录」**。webview 未登录 → 顶栏必显「未登录」。
- **改动**：① main `auth:getToken` 在 token 不在时**也推 `loggedIn:false`**（nuwax 启动 getInitialState 无条件调 getToken，是感知 webview 未登录的最可靠时机，补 persistToken 只在登录成功触发的缺口）；② `refreshAuthState` 移除 `setIsAuthLoggedIn(isLoggedIn(configKey))`，顶栏 `isAuthLoggedIn` 纯由 `nuwax:authChanged` 事件驱动。
- **操作 ①（正常登录）**：nuwax webview 登录 → 切 config 模式看顶栏右侧 → 显用户名或**本机电脑名**（`os.hostname()`，2026-08-13 起替代原抽象「已登录」文案，作为设备标识；username 仍优先）；nuwax 登出 → 切 config 看顶栏 → 显「未登录」。
- **操作 ②（configKey 残留纠正，本次修复核心）**：保留 nuwaclaw configKey（如曾原生登录过）+ nuwax 未登录（清 localStorage 或全新会话）→ 启动后切 config 模式看顶栏 → **应显「去登录」**（修复前会错误显「已登录」）。
- **预期日志**：
  - 登录：`auth:persistToken` + `getToken → sync header loggedIn:true`
  - 登出/失效：`auth:clear` + `getToken → sync header loggedIn:false`
  - 启动即未登录（核心）：`getToken → sync header loggedIn:false (webview not logged in)`
- **结果**：✅ 通过（2026-08-12 实测：main `getToken` 推 `loggedIn:false`，顶栏跟随 webview；configKey 残留不再致伪已登录）。

### 项 9 — 原生退出入口已移除 ✅
- **操作**：config 模式 → 客户端(client)标签页，查看原「退出登录」按钮位置。
- **预期 UI**：**不再有退出登录按钮**（仅保留二维码等）；退出统一由 nuwax webview 用户菜单承担。
- **结果**：✅ 通过（2026-08-12 用户实测：客户端标签页已无退出登录按钮）。

### 项 10 — ClientPage 登录态以 webview 为准（原生登录表单废弃） ⏳
> **原则**：config 模式「客户端」标签页的登录状态显示，与顶栏一样以 nuwax webview 为最优先，**不因 configKey 残留显「伪已登录」**。且登录已统一 webview，原生 domain/账号/密码登录表单废弃。
- **改动**：`App.tsx` 向 `<ClientPage>` 传 `isWebviewLoggedIn={isAuthLoggedIn}` + `onGotoLogin`；ClientPage `renderLoginSection` 判据由 `authState.isLoggedIn`(configKey) 改为 `isWebviewLoggedIn`；未登录分支由原生登录表单改为「请在 nuwax 登录」引导 + 前往按钮。业务门禁 `handleStartAll`(启服务需 reg/configKey) 仍用 `authState.isLoggedIn`，不动。
- **操作 ①（configKey 残留纠正，本次修复核心）**：configKey 在 + nuwax 未登录 → config 模式客户端标签页 → **应显「未登录 · 请在 nuwax 主窗口完成登录 · 前往登录」**（修复前显「✓ 已登录 + 用户名 + 域名」）。
- **操作 ②（正常）**：nuwax 登录 → 客户端标签页显已登录区块（用户名/域名/开始会话/二维码）；nuwax 登出 → 切回引导。
- **预期 UI**：未登录不再有 domain/账号/密码输入框（原生登录表单已移除）。
- **结果**：✅ 通过（2026-08-12 用户实测：configKey 残留 + webview 未登录 → 客户端标签页显「未登录」引导，与 webview 同步）。

---

## 四、日志查看命令

```bash
# 实时跟最新日志，过滤本次验收关键行
tail -f ~/.nuwaclaw/logs/latest.log | \
  grep -E "resolved webview url|x-client-type|auth:persistToken|auth:clear|nuwax:authChanged|login →|services already|stop failed|All services stopped"

# electron-dev 自身启动日志
tail -f /Users/apple/workspace/nuwaclaw/logs/electron-dev.log
```

---

## 五、已知瑕疵（非阻塞，可后续清理）

1. **`[NuwaxHostWebview]` 日志前缀重复**：`logger.info(message, source, details)` 第二参 `source` 已自动加 `[NuwaxHostWebview]` 前缀，而 message 字符串里又写了一遍 → 日志显示 `[NuwaxHostWebview] [NuwaxHostWebview] resolved webview url`。功能无影响。修法：去掉 message 里的 `[NuwaxHostWebview]` 前缀。
2. **dev 托盘图标占位**：`[Tray] macOS dev: tray icon files not found, using placeholder`。dev 环境正常，生产打包后图标就位。非本次改动引入。

---

## 六、未落地项（Phase 3，后端阻塞）

> reg 接口接受 nuwax token 鉴权后再做，不阻塞本次验收：
> - reg → token 统一（替 configKey/savedKey）；`isLoggedIn` 判据改读 `nuwax.accessToken.<origin>`
> - 冷启动起服务迁到 token 驱动（替换 savedKey autoReconnect）
> - 清理 SetupWizard / setup_state / quickInit / savedKey·configKey 全套 dormant 入口；ClientPage 原生登录表单 + handleLogin/loginAndRegister dormant 入口
> - serverHost 配置迁到 SettingsPage

详见关联 Plan 的 Phase 3 章节。
