# Loopback Gateway —— nuwax 经回环网关同源加载（阶段一）

> 状态：**已落地**（阶段一 `cbd42450`/`b5a63681`/`b67b5781` + 阶段二 dist 供给）。最后更新：2026-08-24。
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
                              目标站点（dev=NUWAX_DEV_HOST localhost:3000 /
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
| `nuwaxLoadMode` | `step1_config`（Step1Config 类型） | `'direct'` | `'gateway'` 且 dist 就绪 → **dist 形态**；不配置 = 现状直连，零行为变化 |
| `gatewayPort` | `step1_config` | `46800` | 见 §6 端口校验 |
| `NUWAX_LOOPBACK=1` | env | — | 透明反代形态（目标本地 dev server 时自动跳过、webview 直连） |
| `NUWAX_LOOPBACK_DIST=1` | env | — | 强制 dist 形态（dev 验收） |
| `NUWAX_LOOPBACK_TARGET` | env | 透明反代 dev=`localhost:3000`；dist 形态=`serverHost` | 反代目标 / 后端 origin 覆盖 |
| `nuwax.loopback` | settings 运行时键 | `{enabled:false, origin:null}` | 启动后写 `{enabled:true, origin, mode:'dist'/'proxy'}`；NuwaxHostWebview 解析 URL 时读取 |

**形态优先级**：dist（本地 nuwax 托管）＞ 透明反代（远程目标）＞ 本地目标直连跳过。

**dist 目录解析**：dev = 仓库根 `nuwax/dist`（子模块）；打包 = `process.resourcesPath/nuwax-dist`（electron-builder extraResources 已配）。子模块未初始化时 `ensureLoopbackGateway` 报错回落（non-fatal）。

**dev 启动链路**：`make electron-dev` → `npm run dev` → `dotenv -e .env.development -- electron .`。`.env.development` 已含 `NUWAX_LOOPBACK=1`，但**仅当目标是远程环境时网关介入**：dev 缺省目标 `localhost:3000`（nuwax dev server）本身是本地源，`ensureLoopbackGateway` 判定后自动跳过网关、webview 直连（保留原始 dev 体验，HMR 不经代理层）；要经网关加载远程环境时给 `NUWAX_LOOPBACK_TARGET=https://agent.nuwax.com`（dotenv 不覆盖已存在的 shell env）。

## 6. 端口纪律与校验

- 固定端口 **46800**；与 nuwax-desktop 原型的 **46801** 错开——双客户端可同机共存（原型还占用 60021/60025/60029 服务族，与本客户端 60005-60009 亦无冲突）。
- `gatewayPort` 配置校验（`ensureLoopbackGateway`）：越界（<1024 / >65535）、**与服务端口族冲突**（`getConfiguredPorts()`：agent 60006 / fileServer 60005 / ttyd 60009 / guiMcp 60008 / mcp 18099 / lanproxy 60002）、或撞 46801 —— 一律回落 46800 并告警。*实证背景：实验残留的 `gatewayPort=60009` 曾使网关反把 ttyd 挤掉。*
- 固定端口被外部占用（EADDRINUSE）：回退随机端口并告警——该会话登录态不与既往续接（token 仍按实际 origin 正确落键，属可接受降级）。

## 7. 代码落点

| 文件 | 角色 |
|------|------|
| `src/main/services/loopbackGateway/gateway.ts` | 反代核心 + dist 静态托管（纯 node:http/https/fs，可离线测试） |
| `src/main/services/loopbackGateway/index.ts` | 编排：形态判定（dist/透明） / 目录与后端解析 / 端口校验 / 绝对 URL 归一注册 / `nuwax.loopback` 运行时键 / 幂等 start-stop-status |
| `src/main/services/loopbackGateway/gateway.test.ts` | vitest 9 断言（§8） |
| `src/main/bootstrap/startup.ts` | `runStartupTasks` 内 best-effort 启动（失败仅告警不阻断） |
| `src/main/main.ts` | `before-quit` 收尾停网关 |
| `src/main/ipc/nuwaxBridgeHandlers.ts` | `auth:getToken` 跨 origin 回退链；导出 `NUWAX_TOKEN_KEY_PREFIX` |
| `src/renderer/components/pages/NuwaxHostWebview.tsx` | URL 解析读 `nuwax.loopback`，enabled 时经网关 origin 加载 |
| `src/renderer/services/core/setup.ts` | `Step1Config` 增加 `nuwaxLoadMode` / `gatewayPort`（设置 UI 留待阶段二） |

## 8. 测试与验收

**单测（`gateway.test.ts`，9/9）**——断言口径移植自原型离线验证，port 0 起真实 http/WS 上游，mock electron-log：

1. 全站透传（方法/路径/请求体）　2. host/origin/referer 改写　3. Bearer 代注（缺失补、不覆盖）　4. x-client-type（缺省注入 / 空串关闭）　5. Set-Cookie 规整　6. SSE 流式直通　7. WS 101 透传 + 断开级联　8. 上游拒绝升级回写状态码　9. 固定端口占用回退随机

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

## 9. 已知边界与后续阶段

- **绝对 URL 归一**：dist 形态已实现（`webRequest.onBeforeRequest` 将 serverHost origin 重定向回网关 origin）。第三方域（OSS 直链等）不在归一名单——img 标签不受 CORS 管，按需参照 nuwax-desktop 的 proxyOrigins 扩展。
- **阶段二（dist 供给已落地）**：剩余项——默认形态切 gateway（存量登录态靠 §4 回退链无感迁移）；设置中心增加形态开关 UI。
- **阶段三**：renderer 瘦身（登录页/ClientPage 退役，仅保留 TrafficLightToolbar + webview 宿主），形态对齐 nuwaclaw-desktop 薄壳。
- nuwax-desktop 原型的 `gateway.ts` WS 级联只挂了 `close`（本方案已修为三事件）——**建议回补原型同款修复**。

## 10. 故障排查

| 现象 | 判据 / 处置 |
|------|-------------|
| 启动告警「固定端口 46800 被占用，回退随机端口」 | 他进程占用（含误起的第二实例）→ 释放后重启；随机端口会话登录态不续接 |
| 告警「gatewayPort=… 非法/与服务端口冲突，回落 46800」 | step1_config.gatewayPort 配错（如填了 ttyd 口）→ 改合法值或删键 |
| 页面 502 `{"error":"bad gateway"}` | 目标不可达：dev 检查 nuwax dev server（localhost:3000）是否在跑；prod 检查 serverHost |
| webview 仍直连（url 非 127.0.0.1） | `nuwax.loopback` 运行时键 enabled=false → 确认 NUWAX_LOOPBACK / nuwaxLoadMode；该键在每次启动时按开关重写 |
| WS 一端断开另一端不关 | 不应出现（三事件级联）；复现时查是否运行旧构建 |
