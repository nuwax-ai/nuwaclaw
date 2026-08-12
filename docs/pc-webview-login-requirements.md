# PC 客户端 · nuwax webview 登录统一 · 功能需求描述（FRD）

> **用途**：功能回溯。记录本次改造每项功能的「为什么做、需求是什么、关键设计决策、落在哪些代码、由哪条验收覆盖」，供日后追溯需求来源与决策依据。
> **配对文档**：[`qa-checklist-pc-webview-login.md`](./qa-checklist-pc-webview-login.md)（验收清单·操作步骤）。
> **范围**：跨双端——nuwaclaw 壳（主体，§1 各 FR）+ nuwax webview（bridge 调用方，`feat/chatkit-adapter`，**实现详述见 §7**）。回溯时两端一并查阅。
> **日期**：2026-08-12 ｜ **仓库**：nuwaclaw（主体）+ nuwax（bridge 钩子，`feat/chatkit-adapter`） ｜ **状态**：Phase 1/2 已落地（未提交），Phase 3 后端阻塞。
> **关联 Plan**：`~/.claude/plans/pc-5-nuwaclaw-electron-rust-acp-moonlit-kettle.md`

---

## 0. 背景与目标

**产品形态**：桌面客户端「女娲 Nuwax」= nuwaclaw（Electron/Rust 壳）全屏嵌入 nuwax（React PC 站点）。

**改造前痛点**：
- nuwaclaw 自有一套登录（SetupWizard → reg → `configKey`/`savedKey`），nuwax webview 内又有自己的登录（`/Login` → ACCESS_TOKEN），**两套凭证并存、状态不同步**。
- 启动被 SetupWizard 门控拦住，首屏不是业务页面。
- 登录/登出与服务生命周期脱钩。

**改造目标（用户 2026-08-12 定向）**：
1. 登录全生命周期（**初始登录 / token 失效重登 / 主动登出**）统一到 nuwax webview `/Login`；废弃 nuwaclaw SetupWizard 登录与 `configKey/savedKey` reg 链路。
2. 唯一凭证 = nuwax 登录返回的 **token**，走 Authorization 头鉴权。
3. 登录成功 → 自动起服务；登出 / token 失效 → 停全部服务。
4. 首屏直出 webview，不被原生登录拦住。
5. 原生侧 UI 只承接「壳」职责（窗口/托盘/模式切换），账号与退出交回 nuwax。

**分阶段**：Phase 1（首屏）/ Phase 2（启停联动 + 账号同步 + 去退出）/ Phase 3（reg→token 统一，后端阻塞）。

---

## 1. 功能需求清单

> 每条：【需求】【动机】【触发→效果】【设计决策】【关联文件】【验收】

### A. 首屏与登录入口

#### FR-01 webview 首屏直出
- **需求**：客户端启动直接展示 nuwax webview（生产 `/Login` 或已登录业务页），不被任何原生登录/向导弹窗拦住。
- **动机**：首屏即业务，降低启动摩擦；登录交 nuwax 承接。
- **触发→效果**：冷启动 → 跳过 `setup_state.completed` 门控 → 直接渲染 `NuwaxHostWebview`。
- **设计决策**：保留加载态门控与依赖门控（`SetupDependencies` 自洽）；`handleSetupComplete`/`SetupWizard` import/quickInit 暂作 dormant 入口保留（完整删除放 Phase 3，避免一次改动过大）。quickInit 仍跑以维持 step1 serverHost 路由。
- **关联文件**：`renderer/App.tsx`（启动 effect 强制 `isSetupComplete=true`、删 SetupWizard 渲染门控）
- **验收**：qa-checklist 项 1

#### FR-02 登录入口统一到 nuwax /Login
- **需求**：所有登录路径收敛到 nuwax webview `/Login`；nuwaclaw 不再提供独立登录入口（SetupWizard 登录、ClientPage login form 视为退役中）。
- **动机**：消除两套登录凭证并存的混乱；单一入口便于维护与安全。
- **触发→效果**：未登录 → webview 显示 nuwax `/Login`；登录成功 → nuwax 跳业务页。
- **设计决策**：ClientPage 的原生 login form 暂保留渲染（Phase 3 连同 SetupWizard 一并移除），但其退出按钮已先去（FR-10）。
- **关联文件**：`renderer/components/pages/NuwaxHostWebview.tsx`、`renderer/App.tsx`
- **验收**：qa-checklist 项 1、9

### B. 凭证与鉴权

#### FR-03 token 凭证机制（后端头门控返回 token）
- **需求**：桌面客户端登录后获得 nuwax token，用于后续 Authorization 头鉴权。
- **动机**：以 token 取代 nuwaclaw 原 `configKey/savedKey`，统一凭证体系。
- **触发→效果**：后端登录接口**仅当请求带 `x-client-type: nuwaclaw` 头时**（生产 PC 路径），登录成功才在响应返回 token；token → nuwax 存 `localStorage.ACCESS_TOKEN` → 请求拦截器加 Authorization。
- **设计决策**：`x-client-type` 头由 main 进程 `session.defaultSession.webRequest.onBeforeSendHeaders` 统一注入，renderer/nuwax 无感。生产 nuwax 前后端同域（`BASE_URL=''` 相对路径）→ 无 CORS/preflight。
- **关联文件**：`main/main.ts`（头注入）
- **验收**：qa-checklist 项 2

#### FR-04 本地联调 CORS（origin 跳过 x-client-type 注入）
- **需求**：dev 联调时，nuwax dev server(localhost:3000) 跨域 fetch testagent 后端能正常登录、不触发 preflight 失败。
- **动机**：dev 拓扑下 `BASE_URL` 为绝对 `https://testagent.xspaceagi.com`，webview(localhost:3000) 跨域；若注入 `x-client-type` 自定义头会触发 CORS preflight（后端 CORS 未放行该头）→ 请求发不出。
- **触发→效果**：当请求**来源 origin** 为 `localhost`/`127.0.0.1` 时**跳过** `x-client-type` 注入；其余 origin 正常注入。
- **设计决策**：**判断维度是请求来源 origin（`details.requestHeaders.Origin`），不是 electron 客户端 `isDev`**——因为打包客户端也能加载 localhost dev server 联调，二者是不同维度（曾误用 `!isDev` 被纠正）。后端对 localhost origin 本就凭 origin 返回 token（为前端本地调试设计），故跳过头注入不影响 dev 取 token。dev 另有 `onHeadersReceived` 去重重复 `Access-Control-Allow-Origin`。
- **关联文件**：`main/main.ts`
- **验收**：qa-checklist 项 2

#### FR-05 dev webview 指向 localhost:3000
- **需求**：dev 模式 webview 加载本地 nuwax dev server，便于实时调试前端改动。
- **动机**：联调效率。
- **触发→效果**：`import.meta.env.DEV` 时加载常量 `NUWAX_DEV_HOST=http://localhost:3000`；生产加载 `step1_config.serverHost || DEFAULT_SERVER_HOST(https://agent.nuwax.com)`。打印实际加载地址日志便于排查。
- **设计决策**：指向通过常量控制（改指向改 `NUWAX_DEV_HOST`）。`normalizeServerHost` 保留 http:// 前缀，`buildHomeUrl` 去尾斜杠 → 最终 `http://localhost:3000`。
- **关联文件**：`renderer/components/pages/NuwaxHostWebview.tsx`
- **验收**：qa-checklist 项 1

#### FR-06 重启免登
- **需求**：登录后重启客户端，直接进业务页，不再要求登录。
- **动机**：体验；token 持久化。
- **触发→效果**：nuwax webview 用 defaultSession（未设 partition），其 localStorage 跨重启持久化 → token 在即天然免登。bridge sqlite 是额外双保险：启动 getInitialState 从 bridge 取回写 localStorage。
- **设计决策**：双保险（defaultSession localStorage 持久化 + bridge `nuwax.accessToken.<origin>` 备份）。新窗口（支付）继承 defaultSession 自动带 localStorage。
- **关联文件**：`renderer/components/pages/NuwaxHostWebview.tsx`、`main/ipc/nuwaxBridgeHandlers.ts`、`preload/webviewPerfBridge.ts`
- **验收**：qa-checklist 项 6

### C. 服务与状态联动

#### FR-07 登录成功 → 起服务（best-effort）
- **需求**：nuwax 登录成功后自动启动本地核心服务。
- **动机**：登录即可用，无需用户手动起服务。
- **触发→效果**：nuwax `/Login` 成功 → bridge `auth:persistToken` → main 写 token 后，若 `!isAnyCoreServiceRunning()` 则**异步** `restartAllServicesNow()`（best-effort、不阻塞登录返回；已在跑则幂等跳过）。
- **设计决策**：**异步 fire-and-forget**（保持登录即时跳转）；**幂等守卫**（避免 token 刷新等重复 restart 打断在跑会话）。冷启动起服务仍走既有 autoReconnect(savedKey)（Phase 3 迁 token 驱动）。lanproxy 完整自起待 Phase 3（reg 认 token 后）。
- **关联文件**：`main/ipc/nuwaxBridgeHandlers.ts`（persistToken handler）、`main/ipc/processHandlers.ts`（`restartAllServicesNow`/`isAnyCoreServiceRunning`）
- **验收**：qa-checklist 项 3

#### FR-08 登出 / token 失效 → 停全部服务
- **需求**：nuwax 主动登出 或 token 401 失效时，停止全部本地服务。
- **动机**：安全（失效后不留运行中的本地服务暴露）；用户定「登出和失效都停」。
- **触发→效果**：nuwax 登出（`User/index.tsx`）或 401（`common.ts` USER_NO_LOGIN）→ bridge `auth:clear` → main `await stopAllServicesNow()`（有界、确保停）→ webview 回 `/Login`。
- **设计决策**：**await 确保**（重定向回 /Login 前服务确停）；`stopAllServicesNow` 含 sm.stopAll + computerServer + 端口清理 + 托盘同步，各进程有超时、整体有界、失败仅 warn。**沿用 `auth:clear` 一个 bridge 方法承接两个调用方**，nuwax 侧零改动。
- **关联文件**：`main/ipc/nuwaxBridgeHandlers.ts`（clear handler）、`main/ipc/processHandlers.ts`（`stopAllServicesNow`）；nuwax `services/common.ts`、`layouts/DynamicMenusLayout/User/index.tsx`
- **验收**：qa-checklist 项 4、5

#### FR-09 顶栏账号状态同步（跟随 nuwax token）
- **需求**：nuwaclaw 顶栏账号状态（用户名/登录态）与 nuwax webview 登录态保持一致——登录显用户名（或「已登录」），未登录显「去登录」。
- **动机**：改造前顶栏靠 `configKey` 驱动（`refreshAuthState`→`isLoggedIn`），nuwax 登出清 token 不清 configKey → 顶栏仍显用户名，与 nuwax 不同步，用户误解为「没退出」。`isAuthLoggedIn` 还连锁驱动 headerLeft 的 logo/Segmented 切换，不同步会多处错乱。
- **触发→效果**：main 在 bridge `auth:persistToken`(登录) / `auth:clear`(登出·失效) / `auth:getToken`(重启免登) 时向 renderer 推 `nuwax:authChanged {loggedIn}` 事件；App.tsx 监听 → 更新 `isAuthLoggedIn`/`username` → 顶栏切换「已登录」/「去登录」（「去登录」点击切回 browser 看 nuwax /Login）。
- **设计决策**：
  - **main→renderer 事件**复用既有 `namespace:action` 约定（如 `agent:event`），经 preload 通用 `on/off` + `validChannels` 白名单。
  - **重启免登同步点**：免登时 nuwax 不走 `/Login`、不调 persistToken，故在 `auth:getToken`（nuwax 启动 getInitialState 必调）里，发现 token 存在即顺势推 `loggedIn:true`，补 persistToken 缺口（零 nuwax 改动；推送幂等）。
  - **顶栏登录时显示「已登录」占位**而非真实用户名——因 persistToken 只传 token 不带用户名；要真实用户名需 nuwax 额外上报（后续可加）。
  - Phase 3 configKey 退役前，`nuwax:authChanged` 事件优先级高于 `refreshAuthState`(基于 configKey)。
- **关联文件**：`main/ipc/nuwaxBridgeHandlers.ts`（三处推送）、`preload/index.ts`（validChannels 放行）、`renderer/App.tsx`（监听 + headerRight 改造）、`shared/locales/*`（`Claw.App.loggedIn`/`goLogin`）
- **验收**：qa-checklist 项 8

#### FR-10 去除原生退出入口
- **需求**：移除 nuwaclaw 原生侧的「退出登录」入口。
- **动机**：退出统一由 nuwax webview 用户菜单承担（登录收敛的对偶）；原生退出清的是 configKey，与 nuwax token 两套，易致状态错乱。
- **触发→效果**：ClientPage 的退出按钮 + `handleLogout` 删除。
- **设计决策**：删按钮 + 函数 + unused import（`LogoutOutlined`/`logout`）；`Modal` 别处仍用故保留。登出触发的停服务已由 FR-08（`auth:clear`→`stopAllServicesNow`）在 main 侧统一承接，原 handleLogout 内的停服务逻辑不再需要。SetupWizard 的退出按钮（dormant）Phase 3 连同移除。
- **关联文件**：`renderer/components/pages/ClientPage.tsx`
- **验收**：qa-checklist 项 9

### D. UI

#### FR-11 mac 红绿灯避让
- **需求**：config 模式顶栏左侧内容（Segmented 首页/配置、未登录 logo）不被 macOS 原生红绿灯遮挡。
- **动机**：沉浸式无边框（`titleBarStyle:"hidden"` + `trafficLightPosition:{x:16,y:16}`）下，顶栏内容与红绿灯重叠不可点。
- **触发→效果**：mac 下 `headerLeft` 左侧留 80px；Win/Linux 顶栏左侧无系统控件，`paddingLeft:0`。
- **设计决策**：复用 `NuwaxHostWebview` 拖拽条 `left: isMac ? 80 : 0` 同一套避让常量，全壳统一。headerRight 靠 `margin-left:auto` 居右，本就避让 Windows 右侧控件。多端兼容（mac 让、Win/Linux 不让）。
- **关联文件**：`renderer/App.tsx`、`main/main.ts`（trafficLightPosition）、`renderer/components/pages/NuwaxHostWebview.tsx`
- **验收**：qa-checklist 项 7

---

## 2. 关键设计决策汇总（回溯要点）

| # | 决策 | 理由 |
|---|------|------|
| D1 | 凭证用 nuwax token（Authorization 头），非 httpOnly cookie | 后端实际落地是头门控返回 token；nuwax 既有流程 |
| D2 | x-client-type 注入按**来源 origin** 跳过，非 electron isDev | isDev 是客户端维度，与「webview 加载的是否 nuwax dev server」是两回事；打包端也能加载 localhost 联调 |
| D3 | 登录→起服务用 best-effort + 幂等守卫，不阻塞登录返回 | 体验；避免重复 restart 打断在跑会话 |
| D4 | 登出/失效→停服务用 await | 确保重定向回 /Login 前服务确停 |
| D5 | 沿用 `auth:clear` 一个 bridge 方法承接登出+401 | nuwax 侧零改动 |
| D6 | 顶栏同步用 main→renderer 事件，非轮询 | 复用既有事件基建；实时 |
| D7 | 重启免登同步挂在 `auth:getToken` | nuwax 启动必调、零 nuwax 改动补 persistToken 缺口 |
| D8 | 顶栏登录显「已登录」占位，非真实用户名 | persistToken 不带用户名；取真实名需 nuwax 上报（后续） |
| D9 | Phase 1/2 不删 SetupWizard/quickInit 全套，留 dormant | 避免一次改动过大；reg→token 后端阻塞，Phase 3 统一清理 |

---

## 3. 契约（回溯接口）

### Bridge（nuwax webview → nuwaclaw main，单向 invoke）
| 方法 | 入参 | 返回 | 副作用 |
|------|------|------|--------|
| `auth:getToken` | — | `string\|null` | 有 token 时推 `nuwax:authChanged {loggedIn:true}`（FR-09 同步点） |
| `auth:persistToken` | `token:string` | `boolean` | 写 settings；`!running` 时 best-effort 起服务（FR-07）；推 `loggedIn:true`（FR-09） |
| `auth:clear` | — | `boolean` | 清 settings；`await` 停全部服务（FR-08）；推 `loggedIn:false`（FR-09） |
| `native:saveImage` | `{url,filename?}` | `{success,...}` | 系统保存框 + net.fetch 写盘 |

- 前端：`preload/webviewPerfBridge.ts`（注入到所有 http/https webview guest）
- 后端：`main/ipc/nuwaxBridgeHandlers.ts`
- 注册：`main/ipc/index.ts` → `registerAllHandlers`

### main→renderer 事件
| channel | payload | 触发 |
|---------|---------|------|
| `nuwax:authChanged` | `{loggedIn:boolean}` | persistToken / clear / getToken(有token) |

- preload `validChannels` 白名单已放行；App.tsx 监听更新顶栏。

### 存储键
| 键 | 位置 | 内容 |
|----|------|------|
| `nuwax.accessToken.<origin>` | nuwaclaw settings(sqlite) | nuwax token，按 webview 来源 origin 分域，与 sandbox ticket 隔离 |
| `ACCESS_TOKEN` | nuwax webview localStorage(defaultSession) | nuwax 运行时鉴权用；跨重启持久化 |

---

## 4. 凭证流向

```
nuwax webview /Login
  │（请求带 x-client-type:nuwaclaw 头 ← main 注入；localhost origin 跳过）
  ▼
后端登录接口 → 返回 nuwax token
  │
  ├─► nuwax 存 localStorage.ACCESS_TOKEN + Authorization 头鉴权
  ├─► bridge auth:persistToken → nuwaclaw settings nuwax.accessToken.<origin>（备份）
  │       └─► (!running) restartAllServicesNow（best-effort 起服务）
  │       └─► 推 nuwax:authChanged {loggedIn:true} → 顶栏「已登录」
  ▼
登出 / 401
  └─► bridge auth:clear → 清 token + await stopAllServicesNow + 推 {loggedIn:false} → 顶栏「去登录」
```

---

## 5. 未落地（Phase 3，后端阻塞：reg 须接受 nuwax token 鉴权）

- reg→token 统一：`loginAndRegister`/`reRegisterClient`/`syncConfigToServer` 改用 nuwax token；`isLoggedIn`/`getCurrentAuth` 判据从 configKey 改读 `nuwax.accessToken.<origin>`。
- 移除 configKey/savedKey 写入与直读点（`LanproxySettings.tsx`、`DevToolsPanel.tsx`、`App.tsx` autoReconnect）。
- `auth:persistToken` 改 token 驱动 reg → 保证 lanproxy 配置 → restart（lanproxy 完整可用）。
- 冷启动起服务迁 token 驱动（替换 savedKey autoReconnect）。
- 清理 SetupWizard + setup_state + quickInit + savedKey/configKey 全套 dormant；serverHost 配置迁 SettingsPage。
- （可选）nuwax 上报真实用户名 → 顶栏显真实名（替 FR-09 占位）。

---

## 6. 回溯映射表（功能 ↔ 代码 ↔ 验收）

| 功能 | nuwaclaw 文件 | nuwax 文件（feat/chatkit-adapter） | 验收项 |
|------|---------------|-----------------------------------|--------|
| FR-01 首屏直出 | `renderer/App.tsx` | — | 项 1 |
| FR-02 登录入口统一 | `NuwaxHostWebview.tsx`、`App.tsx` | `pages/Login/index.tsx` | 项 1、9 |
| FR-03 token 头门控 | `main/main.ts` | — | 项 2 |
| FR-04 CORS origin 跳过 | `main/main.ts` | — | 项 2 |
| FR-05 dev 指向 localhost | `NuwaxHostWebview.tsx` | — | 项 1 |
| FR-06 重启免登 | `NuwaxHostWebview.tsx`、`nuwaxBridgeHandlers.ts`、`webviewPerfBridge.ts` | `app.tsx`、`types/global.d.ts` | 项 6 |
| FR-07 登录→起服务 | `nuwaxBridgeHandlers.ts`、`processHandlers.ts` | `pages/Login/index.tsx`(persistToken) | 项 3 |
| FR-08 登出/失效→停服务 | `nuwaxBridgeHandlers.ts`、`processHandlers.ts` | `layouts/DynamicMenusLayout/User/index.tsx`、`services/common.ts` | 项 4、5 |
| FR-09 顶栏账号同步 | `nuwaxBridgeHandlers.ts`、`preload/index.ts`、`App.tsx`、`shared/locales/*` | —（nuwax 被动接收，无改动） | 项 8 |
| FR-10 去原生退出 | `ClientPage.tsx` | — | 项 9 |
| FR-11 mac 红绿灯避让 | `App.tsx`、`main/main.ts`、`NuwaxHostWebview.tsx` | — | 项 7 |

---

## 7. nuwax 侧实现详述（feat/chatkit-adapter 分支）

> nuwax PC 站点作为 webview 内容，经 `window.NuwaClawBridge`（nuwaclaw preload `webviewPerfBridge.ts` 注入到所有 http/https webview guest）与壳交互。以下为本改造 nuwax 侧的需求与改动点——整体需求不可分割的另一半，回溯时须与 §1 壳侧 FR 对照阅读。

#### NUWAX-FR-01 登录成功上报 token
- **需求**：nuwax `/Login` 登录成功后，将 token 上报 nuwaclaw（持久化备份 + 触发起服务 + 顶栏切「已登录」）。
- **触发→效果**：登录成功拿到 token → `window.NuwaClawBridge.auth.persistToken(token)`。
- **关联**：`src/pages/Login/index.tsx:144` → 对应壳侧 **FR-07 / FR-09**。

#### NUWAX-FR-02 主动登出联动
- **需求**：nuwax 用户菜单登出时，清本地态并通知 nuwaclaw 清 token + 停服务，回 `/Login`。
- **触发→效果**：登出 → `localStorage.clear()` + `NuwaClawBridge.auth.clear()` + 重定向 `/Login`。
- **关联**：`src/layouts/DynamicMenusLayout/User/index.tsx:52` → 对应壳侧 **FR-08**。

#### NUWAX-FR-03 token 失效(401)联动
- **需求**：请求遇 `USER_NO_LOGIN`（token 失效/过期）时，清态、通知壳停服务、回 `/Login`。
- **触发→效果**：`USER_NO_LOGIN` → `localStorage.clear()` + `NuwaClawBridge.auth.clear()` + `redirectToLogin(-1)`。
- **关联**：`src/services/common.ts:159` → 对应壳侧 **FR-08**。

#### NUWAX-FR-04 重启免登取回 token
- **需求**：nuwax 启动时从壳取回备份 token 写 localStorage，实现重启免登（双保险：defaultSession 持久化 + 壳 sqlite 备份）。
- **触发→效果**：`getInitialState` → `NuwaClawBridge.auth.getToken()` → 写 `localStorage.ACCESS_TOKEN`。
- **关联**：`src/app.tsx:42` → 对应壳侧 **FR-06**。

#### NUWAX-FR-05 bridge 类型契约声明
- **需求**：声明 `window.NuwaClawBridge` 全局类型（auth / native / perf），供 nuwax 类型安全调用；须与壳 `preload/webviewPerfBridge.ts` 实际暴露的 API 逐字对齐。
- **关联**：`src/types/global.d.ts:26`。

#### NUWAX-FR-06 图片右键另存（native 桥，非登录范围·备查）
- **需求**：图片支持右键另存本地（经壳系统保存框 + `net.fetch` 走 defaultSession 携带登录态）。
- **关联**：`src/components/MarkdownRenderer/OptimizedImage.tsx:46`（`native.saveImage`）→ 对应壳 `native:saveImage` handler。

> `src/utils/nuwaClawBridge/perfTracker.ts`（`NuwaClawBridge.perf`）为性能追踪桥，非本次登录改造范围，列此备查。
