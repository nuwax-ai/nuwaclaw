# Loopback Gateway —— nuwax 经回环网关同源加载（阶段一）

> 状态：**已落地**（阶段一 `cbd42450`/`b5a63681`/`b67b5781` + 阶段二 dist 供给）。最后更新：2026-08-27（新增 §6 域名解析语义；§6 两项已知差距同日修复；新增调试覆盖前端域通道 `NUWAX_WEBVIEW_ORIGIN`；设置 UI 服务域名自「本地化加速」迁入「服务配置」区块）。
>
> 来源：nuwaclaw-desktop 薄壳原型已实证方案的回流。原型仓库 `workspace/nuwax-desktop`（loopback 网关 + 编译消费 + smoke 体系）验证了「nuwax 以回环 origin 加载」的全链路可行性，本方案将其吸收回正主。

## 1. 背景与问题

现状（direct 形态）：主窗口 NuwaxHostWebview 直接加载 `step1_config.serverHost`（如 `https://agent.nuwax.com`）。由此带来一类结构性问题，均已在 nuwaclaw-desktop 原型中实证可通过回环网关解决：

| 问题 | 根因 |
|------|------|
| 登录态 / Cookie 绑定云端域 | token 按页面 origin 落键（`nuwax.accessToken.<origin>`），域一换登录态即丢 |
| 页面内 iframe / 文件预览跨域 | nuwax 返回绝对后端 URL，页面 fetch 从自身 origin 跨到后端域被 CORS 拦截 |
| iframe 导航 / raw fetch 带不了 Authorization | 浏览器语义限制，页面侧无法自行补头 |
| SameSite=None / Domain Cookie 被丢 | 云端 Cookie 属性按公网域设定 |

**方案**：nuwax 一律从 `http://127.0.0.1:46800/` 加载，客户端主进程内置透明反代网关把全部流量（静态 / `/api` / WebSocket / SSE）转发到目标站点。页面 origin 恒为回环地址，上述问题从根上消失；鉴权头、客户端标识头由网关统一代注。

## 2. 架构与数据流

```
┌───────────────────────────── Electron (nuwaclaw) ─────────────────────────────┐
│                                                                                │
│  NuwaxHostWebview ──加载──▶ http://127.0.0.1:46800/                            │
│       │                        │                                               │
│       │ NuwaClawBridge         │  Loopback Gateway（main 进程，node:http）      │
│       │ (auth:getToken …)      │   ┌─────────────────────────────────────┐    │
│       ▼                        │   │ hop-by-hop 剥离                     │    │
│  nuwaxBridgeHandlers           │   │ host/origin/referer 改写指向目标     │    │
│   token 按 origin 落键          │   │ x-client-type: nuwaclaw（代注）      │    │
│   （跨 origin 回退链见 §4）      │   │ Authorization: Bearer（缺失时代注）  │    │
│                                │   │ Set-Cookie 规整（剥 Domain/Secure）  │    │
│                                │   │ WS upgrade 透传 + 断开级联           │    │
│                                │   │ SSE raw-pipe 直通                    │    │
│                                │   └──────────────┬──────────────────────┘    │
│                                └─────────────────┼───────────────────────────┘
└──────────────────────────────────────────────────┼─────────────────────────────┘
                                                   ▼
                              目标站点（调试覆盖 NUWAX_WEBVIEW_ORIGIN > dev=NUWAX_DEV_HOST localhost:3000 /
                                       prod=step1_config.serverHost）
```

阶段一为**全站透明反代**（无本地路由表）；阶段二新增 **dist 形态**（DSH Desktop 同款，nuwax-desktop 原型回流）：网关托管仓库根 `nuwax/` 子模块（`feat/pc-client-bridge`，dist 随分支入库免构建）的本地 dist——静态托管 + SPA 深链回退 + `/api` `/computer` `/devcomputer` 前缀反代 serverHost；并注册**后端绝对 URL 归一**（`webRequest.onBeforeRequest` 将 serverHost origin 重定向回网关 origin，免 CORS、顺带享注入）。「我的电脑」等 `/api/computer/*` 仍走云端隧道路由（与 direct 形态一致）。两形态按开关自动选择（见 §5）。

## 3. 代理语义明细

| 能力 | 行为 | 说明 |
|------|------|------|
| 请求头改写 | `host` → 目标 host；`origin` → 目标 origin；`referer` 保路径只换 origin | 防回环地址漏给后端校验 |
| x-client-type | 云端方向统一注入 `nuwaclaw` | FR-03 登录链路（后端仅凭该头返回 token）。网关请求不经 Electron session，与 main.ts 的 webRequest 钩子（遇 localhost origin 本就跳过）天然不重复 |
| Bearer 代注 | 请求缺 `Authorization` 时补 `Bearer <token>`，已有不覆盖 | token 源 = `nuwax.accessToken.<serverHost-origin>` |
| Set-Cookie 规整 | 剥 `Domain` / `Secure`；`SameSite=None → Lax` | 回环 http origin 下这些属性反致 Cookie 被丢弃 |
| WebSocket | upgrade 101 透传，双向 pipe；**断开级联挂 `end` + `close` + `error` 三事件** | Node ≥ 20 实证：客户端优雅断开（FIN）只触发 `end` 不触发 `close`，仅挂 `close` 会漏级联、累积半开连接 |
| SSE | raw-pipe，不设 timeout、不缓冲 | `text/event-stream` 分块到即转发 |
| 错误 | 上游不可达回 502 JSON；WS 拒绝升级回写真实状态码 | 可观测 |

## 4. 登录态跨 origin 迁移（免重登）

token 按 webview 来源 origin 落键（`nuwax.accessToken.<origin>`，settings 库）。direct ↔ gateway 切换后 origin 变化，首查必空——`auth:getToken` 增加回退链：

```
sender origin 键（空）→ serverHost origin 键 → 网关 origin 键
                                        └─ 命中任一 → 回写 sender origin 键 → 返回
```

- 双向切换（切过去、切回来）都不需要重新登录；
- 迁移命中有日志：`[NuwaxBridge] auth:getToken origin 迁移回退命中 {from, to}`；
- `auth:persistToken` / `auth:clear` 语义不变（本就按 sender origin 写）。

## 5. 配置面与开关

| 配置 | 位置 | 缺省 | 说明 |
|------|------|------|------|
| `serverHost` | `step1_config`（设置 UI =「服务配置」区块"服务域名"，2026-08-27 自「本地化加速」区块迁入） | 空 → `agent.nuwax.com` | **前后端一体的服务域名**（§6）。UI 支持带 `http(s)://`，保存归一（未含协议补 `https://`）；变更随保存 restartAll |
| `nuwaxLoadMode` | `step1_config`（Step1Config 类型；设置 UI =「系统」区块"本地化加速"开关，即点即存） | `'direct'` | `'gateway'` 且 dist 就绪 → **dist 形态**；不配置 = 现状直连，零行为变化 |
| `gatewayPort` | `step1_config` | `46800` | 见 §7 端口校验 |
| `NUWAX_LOOPBACK=1` | env | — | 透明反代形态（目标本地 dev server 时自动跳过、webview 直连） |
| `NUWAX_LOOPBACK_DIST=1` | env | — | 强制 dist 形态（dev 验收） |
| `NUWAX_LOOPBACK_TARGET` | env | 透明反代 dev=`localhost:3000`；dist 形态=`serverHost` | 反代目标 / 后端 origin 覆盖 |
| `NUWAX_WEBVIEW_ORIGIN` | env（`.env.development` 维护，调试专用） | 未设置 | **调试覆盖前端域名**：webview 强制加载该前端源（优先级最高）；后端域仍按 serverHost 解析，缺省 = 前后端同域。主进程启动写 `nuwax.webviewOverride` 运行时键，renderer 读取 |
| `nuwax.loopback` | settings 运行时键 | `{enabled:false, origin:null}` | 启动后写 `{enabled:true, origin, mode:'dist'/'proxy', backend}`（`backend` 供 refresh 检测域名变更）；NuwaxHostWebview 解析 URL 时读取 |
| `nuwax.webviewOverride` | settings 运行时键 | `{origin:null}` | 启动时由 `NUWAX_WEBVIEW_ORIGIN` 同步（未设清键）；renderer 解析 URL 时读取，`origin` 非空则优先加载 |

**形态优先级（dev 自动判定）**：nuwax dev server（localhost:3000，原开发的调试直连便利）**在线** → webview 直连；**不在线且 dist 就绪** → dist 形态（子模块本地 nuwax，`make electron-dev` 随时可见完整客户端；TCP 探测 600ms）；远程目标 → 透明反代。`NUWAX_LOOPBACK_DIST=1` 强制 dist（跳过探测）。

**dist 目录解析**：dev = 仓库根 `nuwax/dist`（子模块）；打包 = `process.resourcesPath/nuwax-dist`（electron-builder extraResources 已配）。子模块未初始化时 `ensureLoopbackGateway` 报错回落（non-fatal）。

**dev 启动链路**：`make electron-dev` → `npm run dev` → `dotenv -e .env.development -- electron .`。`.env.development` 已含 `NUWAX_LOOPBACK=1`，但**仅当目标是远程环境时网关介入**：dev 缺省目标 `localhost:3000`（nuwax dev server）本身是本地源，`ensureLoopbackGateway` 判定后自动跳过网关、webview 直连（保留原始 dev 体验，HMR 不经代理层）；要经网关加载远程环境时给 `NUWAX_LOOPBACK_TARGET=https://agent.nuwax.com`（dotenv 不覆盖已存在的 shell env）。

## 6. 域名解析语义（webview 加载域 vs 后端业务域）

> **语义基准（2026-08-27 确立）**：`step1_config.serverHost` 的语义是**前后端一体**——不管是否调试场景，它既是前端的源站域、也是后端接口域；**为空回落官方线上域 `DEFAULT_SERVER_HOST = https://agent.nuwax.com`**（`src/shared/constants.ts`）。所有后端域消费点（网关反代目标 / Bearer 源 / reg / lanproxy 健康探针）**一律**按此解析，无场景例外。
>
> 各场景改变的只是 **webview 的实际加载地址**（对前端源的覆盖方式），不改变 serverHost 的语义：

| 场景 | webview 实际加载地址 | 后端业务域（API / reg / lanproxy 探针） |
|------|----------------------|------------------------------------------|
| direct（生产） | `step1_config.serverHost`（直连前端源站） | **同一域名**（前后端一体，无分离） |
| **loopback（生产，本地化加速）** | 网关回环 origin（`http://127.0.0.1:46800`，代理回 serverHost） | **用户设置域名即后端接口域名；为空 → `https://agent.nuwax.com`**（`resolveBackendOrigin`：`serverHost \|\| DEFAULT_SERVER_HOST`；`NUWAX_LOOPBACK_TARGET` 可 env 覆盖） |
| 调试（vite dev，未打包） | 内置 `NUWAX_DEV_HOST = http://localhost:3000`（对前端源的**临时覆盖**，不依赖 serverHost） | **仍是 serverHost（为空 → agent.nuwax.com）**——加载地址的偏离不改变后端域解析 |
| 调试覆盖（env `NUWAX_WEBVIEW_ORIGIN`，任意形态可用） | **强制加载该前端源**（优先级最高：override > loopback/dev > direct） | **仍是 serverHost**——本通道只覆盖前端，是"前后端域名分离"唯一受支持的调试入口 |

要点：

1. `step1_config.serverHost` 是**前后端一体的单一域名来源**（设置 UI 落在「服务配置」区块的"服务域名"，支持带 `http(s)://`、缺省补 `https://`，变更随保存重启服务；「本地化加速」区块只留形态开关），派生两类消费：①前端源站（direct 直连 / loopback 网关的代理目标）；②后端业务域——loopback 反代目标与 Bearer token 源（`loopbackGateway/index.ts` 的 `resolveBackendOrigin` / `serverHostTokenProvider`）、lanproxy 健康探针（`lanproxyHealth.ts` 的 `getBusinessDomain`：step1 > `lanproxy.server_host` 兜底 > `DEFAULT_SERVER_HOST`）。
2. **不要为"只改前端"去设置 serverHost**：调试场景的前端域覆盖走 env `NUWAX_WEBVIEW_ORIGIN`（`.env.development` 维护，主进程启动时写 `nuwax.webviewOverride` 运行时键供 renderer 读取；未设置清键回落默认）。vite dev 形态加载本地 webview 由 dev 分支内置完成（localhost:3000），同样无需动 serverHost。今天的 Lanproxy 启动失败正是违反此不变量的用法——把 serverHost 设为 localhost:3000 试图只影响前端，后端域消费点（健康探针）被一并带偏。

**已知差距（2026-08-27 Lanproxy 启动失败排查结论）——同日已修复**：

- ~~`waitForLanproxyTunnel` 对"200 + 非 JSON"无显式报错~~ → **已修**：200+非 JSON（SPA HTML fallback）快失败并记录含 URL/content-type 的 warn 日志；`probeLanproxyAfterStart` 失败报错携带 `domain=` / `configKey=`——探针被带偏时日志一眼定位。如未来需支持"前后端域名显式分离"的部署形态，应引入独立的后端域设置键，而非复用 serverHost。
- ~~`refreshLoopbackGateway` 变更检测键不含后端域（仅域名变化时 renderer 不重载）~~ → **已修**：`nuwax.loopback` 运行时键补 `backend` 字段，域名变更（网关 origin/形态不变）也能触发 `nuwax:loopback-changed` → webview 重载；无变化仍静默（不闪白）。
- 同一症状另有**两个独立成因**，排查时须分开：未登录（日志 `No savedKey → reg failed, using local config`，沿旧 configKey）；旧 configKey 云端已离线（后端返回 `{"code":"0001","message":"客户端已离线"}`）。三者最终都以同一条超时消息落地。

**向后兼容（新客户端上线——仅域名语义相关，2026-08-27 梳理）**。登录态不在兼容范围：**新方案以页面（webview）内的登录与状态为最优先**——换域/形态切换后大概率需要重新登录，属预期行为；§4 的跨 origin 回退链是 best-effort 优化，不构成兼容承诺。

| 兼容面 | 存量形态 | 新客户端行为 | 结论 |
|--------|----------|--------------|------|
| `step1_config` 旧形状（无 `nuwaxLoadMode` / `gatewayPort`） | 升级用户普遍如此 | 缺省 `direct`，与旧版行为逐比特一致 | 零变化；gateway 形态需显式开启 |
| `serverHost` 为空 | 未走完设置向导 / 旧安装 | direct 与 loopback 均回落 `DEFAULT_SERVER_HOST`（agent.nuwax.com），与旧版 direct 解析同式 | 一致 |
| 旧键 `lanproxy.server_host` | 历史/半完成配置（可能是 reg 回写的隧道主机） | 保留为 `getBusinessDomain()` 兜底（step1 > 此键 > DEFAULT） | 不破坏；语义仍是"业务域"，非隧道地址 |
| 私有化旧后端 | 无 `/api/sandbox/config/health` | 已有 404/501/405 快失败；200+HTML 歧义**已修**（快失败 + 日志含 URL/content-type，报错携带 domain/configKey） | 降级安全且可诊断；如未来引入"显式后端域"独立键，旧设置无该键须回落 step1（前向兼容） |

## 7. 端口纪律与校验

- 固定端口 **46800**；与 nuwax-desktop 原型的 **46801** 错开——双客户端可同机共存（原型还占用 60021/60025/60029 服务族，与本客户端 60005-60009 亦无冲突）。
- `gatewayPort` 配置校验（`ensureLoopbackGateway`）：越界（<1024 / >65535）、**与服务端口族冲突**（`getConfiguredPorts()`：agent 60006 / fileServer 60005 / ttyd 60009 / guiMcp 60008 / mcp 18099 / lanproxy 60002）、或撞 46801 —— 一律回落 46800 并告警。*实证背景：实验残留的 `gatewayPort=60009` 曾使网关反把 ttyd 挤掉。*
- 固定端口被外部占用（EADDRINUSE）：回退随机端口并告警——该会话登录态不与既往续接（token 仍按实际 origin 正确落键，属可接受降级）。

## 8. 代码落点

| 文件 | 角色 |
|------|------|
| `src/main/services/loopbackGateway/gateway.ts` | 反代核心 + dist 静态托管（纯 node:http/https/fs，可离线测试） |
| `src/main/services/loopbackGateway/index.ts` | 编排：形态判定（dist/透明） / 目录与后端解析 / 端口校验 / 绝对 URL 归一注册 / `nuwax.loopback` 运行时键（含 `backend`，域名变更可检测） / `syncWebviewOverrideFromEnv`（`NUWAX_WEBVIEW_ORIGIN` → `nuwax.webviewOverride` 键） / 幂等 start-stop-status |
| `src/main/services/loopbackGateway/gateway.test.ts` | vitest 11 断言（§9） |
| `src/main/services/loopbackGateway/index.test.ts` | vitest 编排 5 断言：运行时键含 backend / 域名变更通知 renderer / 无变化静默 / webview override 写入与清除（§9） |
| `src/main/bootstrap/startup.ts` | `runStartupTasks` 内 best-effort 启动（失败仅告警不阻断）；启动时先同步 webview override 键再 ensure 网关 |
| `src/main/main.ts` | `before-quit` 收尾停网关 |
| `src/main/ipc/nuwaxBridgeHandlers.ts` | `auth:getToken` 跨 origin 回退链；导出 `NUWAX_TOKEN_KEY_PREFIX` |
| `src/renderer/components/pages/NuwaxHostWebview.tsx` | URL 解析读 `nuwax.loopback` 与 `nuwax.webviewOverride`（override 优先级最高：覆盖 > loopback > dev > direct），enabled 时经网关 origin 加载 |
| `src/renderer/components/pages/SettingsPage.tsx` | 设置 UI：「服务配置」区块"服务域名"（serverHost，带协议输入 + 保存归一 + 变更 restartAll）；「系统」区块"本地化加速"开关（即点即存：写 `nuwaxLoadMode` + restartAll，2026-08-27 自独立面板迁入，不再触碰 serverHost） |
| `src/renderer/services/core/setup.ts` | `Step1Config` 增加 `nuwaxLoadMode` / `gatewayPort`（设置 UI 已落地，见上行的 SettingsPage 分工） |

## 9. 测试与验收

**单测（`gateway.test.ts`，11/11）**——断言口径移植自原型离线验证，port 0 起真实 http/WS 上游，mock electron-log：

1. 全站透传（方法/路径/请求体）　2. host/origin/referer 改写　3. Bearer 代注（缺失补、不覆盖）　4. x-client-type（缺省注入 / 空串关闭）　5. Set-Cookie 规整　6. SSE 流式直通　7. WS 101 透传 + 断开级联　8. 上游拒绝升级回写状态码　9. 固定端口占用回退随机　10-11. WS 早退级联（客户端 101 前断开，upstream 立即中止）等后续补例

**编排单测（`index.test.ts`，5/5，2026-08-27 新增）**——electron/db/gateway 全 mock，`vi.resetModules` 隔离模块级网关状态：

1. ensure 写运行时键含 `backend`　2. 仅域名变化 → 网关以新后端重启 + 通知 renderer（旧行为静默跳过）　3. 无变化不通知（不闪白）　4/5. `NUWAX_WEBVIEW_ORIGIN` 写入（协议归一）/ 缺省清键（前后端一体默认）

**lanproxy 探针（`lanproxyHealth.test.ts`，2026-08-27 补 2 例）**：200+非 JSON（SPA fallback）快失败不重试；`probeLanproxyAfterStart` 报错携带 `domain=`/`configKey=`。

**回归对照法**：改动前后 `git stash` 对照跑全量 `npm run test:run`——1234 项、32 项失败数完全一致（存量问题），零回归。

**手动验收（dev）**：

```bash
make electron-dev        # .env.development 已带 NUWAX_LOOPBACK=1
# 或指生产目标：NUWAX_LOOPBACK_TARGET=https://agent.nuwax.com npm run dev
```

通过判据（日志 `~/.nuwaclaw/logs/latest.log` 或 `logs/electron-dev.log`）：

- `[LoopbackGateway] listening http://127.0.0.1:46800 → <目标>`
- `[NuwaxHostWebview] resolved webview url { url: 'http://127.0.0.1:46800' }`
- `curl -sI http://127.0.0.1:46800/` → 200；nuwax /Login 登录成功（x-client-type 经网关生效）
- 重启客户端免重登（必要时见 `[NuwaxBridge] auth:getToken origin 迁移回退命中`）
- 终端（云端隧道路由）行为与 direct 一致

## 10. 已知边界与后续阶段

- **绝对 URL 归一**：dist 形态已实现（`webRequest.onBeforeRequest` 将 serverHost origin 重定向回网关 origin）。第三方域（OSS 直链等）不在归一名单——img 标签不受 CORS 管，按需参照 nuwax-desktop 的 proxyOrigins 扩展。
- **阶段二（dist 供给已落地）**：剩余项——默认形态切 gateway（存量登录态靠 §4 回退链无感迁移）；设置中心增加形态开关 UI。
- **阶段三**：renderer 瘦身（登录页/ClientPage 退役，仅保留 TrafficLightToolbar + webview 宿主），形态对齐 nuwaclaw-desktop 薄壳。
- nuwax-desktop 原型的 `gateway.ts` WS 级联只挂了 `close`（本方案已修为三事件）——**建议回补原型同款修复**。

## 11. 故障排查

| 现象 | 判据 / 处置 |
|------|-------------|
| 启动告警「固定端口 46800 被占用，回退随机端口」 | 他进程占用（含误起的第二实例）→ 释放后重启；随机端口会话登录态不续接 |
| 告警「gatewayPort=… 非法/与服务端口冲突，回落 46800」 | step1_config.gatewayPort 配错（如填了 ttyd 口）→ 改合法值或删键 |
| 页面 502 `{"error":"bad gateway"}` | 目标不可达：dev 检查 nuwax dev server（localhost:3000）是否在跑；prod 检查 serverHost |
| webview 仍直连（url 非 127.0.0.1） | `nuwax.loopback` 运行时键 enabled=false → 确认 NUWAX_LOOPBACK / nuwaxLoadMode；该键在每次启动时按开关重写 |
| webview 加载了意外地址（非 serverHost/网关 origin） | 日志 `resolved webview url { override: ... }` → 检查 env `NUWAX_WEBVIEW_ORIGIN`（`.env.development`）是否残留；删除后重启自动清键回落默认 |
| Lanproxy 启动失败 "tunnel health check timed out or endpoint unavailable" | 三因分开查（详见 §6 已知差距）：① serverHost 被设为本地域把探针带偏（违反前后端一体不变量；报错现已携带 domain= 一眼定位）② 未登录 `No savedKey → reg failed`；③ 旧 configKey 云端已离线（`code:0001 客户端已离线`）→ 重新登录拿新 reg |
| WS 一端断开另一端不关 | 不应出现（三事件级联）；复现时查是否运行旧构建 |
