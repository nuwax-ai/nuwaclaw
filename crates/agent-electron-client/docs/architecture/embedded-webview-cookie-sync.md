---
version: 1.3
last-updated: 2026-04-09
status: stable
---

# 内嵌 Webview 会话浏览器 + Cookie 登录态同步

> 本文档描述将会话页面从系统浏览器迁移至客户端内嵌 webview 的方案，以及通过 reg 接口返回的 `token` 自动同步 httpOnly cookie 实现免登录打通的设计。

---

## 背景与动机

| 改动前 | 改动后 |
|--------|--------|
| 点击「开始会话」调用 `shell.openExternal` 在系统浏览器打开 | 在 ClientPage 内嵌 `<webview>` 渲染会话页面 |
| 用户需要在外部浏览器重新登录 | 通过 cookie 同步自动携带登录态，免二次登录 |
| 体验割裂，无法与客户端 UI 联动 | 统一在客户端窗口内操作，支持返回/刷新工具栏 |

---

## 架构总览

```
┌──────────────────────────────────────────────────────────────┐
│                     Electron Main Process                     │
│                                                               │
│  appHandlers.ts                                               │
│  ┌──────────────────────────────────────┐                    │
│  │  session:setCookie IPC handler        │                    │
│  │  → electronSession.defaultSession     │                    │
│  │    .cookies.set({ httpOnly, secure }) │                    │
│  └──────────────────────────────────────┘                    │
│                                                               │
│  main.ts                                                      │
│  ┌──────────────────────────────────────┐                    │
│  │  webPreferences: { webviewTag: true } │                    │
│  └──────────────────────────────────────┘                    │
└──────────────────────────────┬───────────────────────────────┘
                               │ IPC
                               ▼
┌──────────────────────────────────────────────────────────────┐
│                    Electron Renderer Process                   │
│                                                               │
│  ClientPage.tsx                                               │
│  ┌──────────────────────────────────────────────────────┐    │
│  │ handleStartSession()                                  │    │
│  │  1. 读取 auth.token (settings)                        │    │
│  │  2. 调用 session.setCookie → main 进程设置 cookie      │    │
│  │  3. setWebviewVisible(true)                           │    │
│  │                                                       │    │
│  │ <webview src={redirectUrl}>                           │    │
│  │  └── 使用 defaultSession，自动携带 ticket cookie       │    │
│  └──────────────────────────────────────────────────────┘    │
└──────────────────────────────────────────────────────────────┘
```

---

## 数据流

### Token 获取与持久化

```
服务端 /api/sandbox/config/reg
    │
    └── 返回 { configKey, serverHost, serverPort, token, ... }
        │
        ├── loginAndRegister()   ── if (response.token) → 写入 AUTH_TOKEN + domain_token + 立即同步 cookie
        ├── reRegisterClient()   ── if (response.token) → 同上（自动重注册场景）
        └── syncConfigToServer() ── if (response.token) → 同上（手动配置同步场景）
```

三个入口的 token 处理逻辑一致：

```
reg 返回 token
  ↓
① AUTH_TOKEN = token                    ← one-shot，给后续 webview 打开时用
② domain_token:{domain} = token         ← 域名级缓存，兜底
③ syncSessionCookie(domain, token)      ← 立即写 webview cookie
  ├─ 成功 → AUTH_TOKEN = null           ← 已消费，清空
  └─ 失败 → 保留 AUTH_TOKEN             ← 等下次 webview 打开再同步
```

token 存入 SQLite（通过 `settingsSet`），与其他认证字段（username、configKey）同级管理。密码不持久化。

### Cookie 同步时序

```
syncCookieAndBuildUrl() — 打开 webview 前调用
    │
    ├── 1. getCurrentAuth() → 获取 domain、configId
    │
    ├── 2. settingsGet('auth.token') → 读取 one-shot token
    │   ├── 有值 → tokenSource = "one_shot"
    │   └── 无值 → settingsGet('domain_token:{domain}') → 读取域名缓存 token
    │       └── 有值 → tokenSource = "domain_cache"
    │
    ├── 3. token 不存在？
    │   └── 是 → 跳过同步（不清空现有 cookie），直接返回 buildUrl()
    │
    ├── 4. parseJwtExpDate(token) → 检查 JWT exp 是否过期（30s 宽限容忍时钟偏移）
    │   └── 已过期（exp + 30s ≤ now）？
    │       └── 是 → 只清除对应来源缓存（one-shot 清 AUTH_TOKEN，domain_cache 清 domain key）
    │                跳过 cookie 覆写，直接返回 buildUrl()
    │
    ├── 5. token 有效 → syncSessionCookie(domain, token)
    │       ├── electronAPI.session.setCookie({
    │       │     url: domain,         // e.g. "https://agent.nuwax.com"
    │       │     name: 'ticket',
    │       │     value: token,
    │       │     // 不设 domain → host-only cookie
    │       │     // 不设 secure → 主进程根据 URL scheme 自动判断
    │       │     httpOnly: true,
    │       │   })
    │       │   │
    │       │   ├── [Main Process] removeSameNameCookies()  ← 清除所有旧 ticket cookie
    │       │   └── [Main Process] electronSession.defaultSession.cookies.set(...)
    │       │       ├── secure: URL 以 https:// 开头 → true，否则 false
    │       │       ├── secure=true 时设 sameSite: 'no_restriction'
    │       │       └── expirationDate: 从 JWT exp 解析，兜底 7 天
    │       │
    │       ├── 成功 → settingsSet('auth.token', null) ← 消费 one-shot token
    │       └── 失败 → 保留 token，抛出异常（下次重试）
    │
    └── 6. return buildUrl(domain, configId)
            │
            └── <webview src={redirectUrl}> 发起请求
                ├── 请求自动携带 ticket cookie (host-only, httpOnly)
                └── 服务端校验通过 → 免登录加载页面
```

### 清除时机

| 场景 | 动作 |
|------|------|
| 退出登录 (`clearAuthInfo`) | `settingsSet('auth.token', null)` |
| 退出登录 (`handleLogout`) | `setWebviewVisible(false)` — 关闭 webview |
| reg 返回新 token | 覆盖旧值（login 和 sync 两个入口均会更新） |
| cookie 同步成功 | `settingsSet('auth.token', null)` — 消费 one-shot token |
| 缓存 token 已过期 | 只清除对应来源（one-shot → `AUTH_TOKEN`，domain cache → domain key） |
| webview 内重新登录 (`persistTicketCookie`) | 清除 `AUTH_TOKEN` + domain key，刷盘 cookie |

### Webview 重新登录处理

```
webview 内 token 过期 → 服务端跳转 /login
    ↓
用户在 webview 内重新登录 → 服务端 Set-Cookie: ticket=新token
    ↓
EmbeddedWebview 检测到从 /login 跳转到非 login 页面
    ↓
调用 persistTicketCookie(domain)
    ├── flushStore() — 确保新 cookie 写入磁盘
    └── 清除 AUTH_TOKEN + domain_token:{domain} — 防止旧缓存覆盖新 ticket
```

**防御性兜底**：即使 `persistTicketCookie` 未被调用（如 race condition），`syncCookieAndBuildUrl` 在下次打开 webview 时仍会检查 JWT exp，过期的缓存 token 不会覆盖现有 cookie。

---

## 修改文件清单

| 文件 | 层 | 修改内容 |
|------|----|---------|
| `src/renderer/services/core/api.ts` | 类型 | `ClientRegisterResponse` 增加 `token?: string` |
| `src/shared/constants.ts` | 常量 | `AUTH_KEYS` 增加 `AUTH_TOKEN: 'auth.token'` |
| `src/renderer/services/core/auth.ts` | 服务 | `loginAndRegister` / `syncConfigToServer` 持久化 token；`clearAuthInfo` 清除 token |
| `src/main/main.ts` | 主进程 | `webPreferences` 增加 `webviewTag: true` |
| `src/main/ipc/appHandlers.ts` | IPC | 新增 `session:setCookie` handler |
| `src/preload/index.ts` | Preload | 暴露 `session.setCookie` |
| `src/shared/types/electron.d.ts` | 类型 | `ElectronAPI.session` 替换为 `setCookie`；移除废弃的 `Session`/`Message` 接口和 `message` 块 |
| `src/shared/types/webview.d.ts` | 类型 | **新建** — `<webview>` JSX IntrinsicElements 声明 |
| `src/renderer/components/EmbeddedWebview.tsx` | 组件 | **新建** — 可复用的内嵌 webview 组件（工具栏 + 错误处理 + webview） |
| `src/renderer/styles/components/EmbeddedWebview.module.css` | 样式 | **新建** — webview 容器 / 工具栏 / URL 栏样式 |
| `src/renderer/components/pages/ClientPage.tsx` | 组件 | 替换 `openExternal` 为 `<EmbeddedWebview>` + cookie 同步 |
| `src/renderer/styles/components/ClientPage.module.css` | 样式 | `.page` 增加 flex 布局以支持 webview 撑满 |

---

## 关键设计决策

### 1. 使用 `<webview>` 而非 `BrowserView` 或 `<iframe>`

| 方案 | 优点 | 缺点 |
|------|------|------|
| `<webview>` | React JSX 内直接使用，生命周期由组件控制，共享 `defaultSession` | Electron 官方标记为"less secure"（但加载的是自有域名） |
| `BrowserView` | 进程隔离更彻底 | 需在 main 进程管理定位/尺寸，与 React 渲染模型脱节 |
| `<iframe>` | 最简单 | 受 CSP 限制，无法设置 httpOnly cookie，跨域问题 |

**结论**：`<webview>` 最适合本场景 — 加载自有域名、需要 cookie 同步、需要与 React 组件联动。

### 2. 使用 `defaultSession` 而非 `partition`

webview 默认使用 `defaultSession`，与 `session:setCookie` handler 操作同一 session。无需额外 partition 配置，cookie 自然可见。

### 3. Cookie 属性选择

```typescript
{
  httpOnly: true,               // 防止 webview 内 JS 读取 token
  // secure: 主进程根据 URL scheme 自动判断（HTTPS→true, HTTP→false）
  // sameSite: 主进程自动判断（secure 时设 no_restriction，否则不设）
  // domain: 不设置             → host-only cookie，与 webview 内 Set-Cookie 行为一致
}
```

- `httpOnly: true` — 安全性：即使 webview 加载的页面被注入 XSS，也无法通过 `document.cookie` 读取 token
- `secure` — 由主进程根据 URL scheme 自动设置。HTTPS 域名必须为 true（Chromium 要求 `SameSite=None` 需配合 `Secure`）。HTTP 域名自动为 false
- `sameSite` — 主进程自动判断：`secure: true` 时设 `'no_restriction'`，HTTP 场景不设
- **不设 `domain`** — host-only cookie，确保与 webview 内登录的 `Set-Cookie` 能互相覆盖，避免 `count=2` 冲突（v1.1 修复）

### 4. Cookie 双向覆盖

Electron 侧和 webview 内的 ticket cookie 使用相同属性（host-only + httpOnly + secure），可以互相覆盖：

| 方向 | 行为 |
|------|------|
| **Electron → Webview** | `removeSameNameCookies()` 清除所有旧 cookie → 写 host-only cookie → webview 导航时携带 |
| **Webview → Electron** | webview 登录 `Set-Cookie: ticket=xxx`（host-only）→ 覆盖 Electron 写的同名 cookie |
| **Electron 再写** | `removeSameNameCookies()` 再次清除所有（含 webview 设的）→ 写新值 |

**修复前问题**：Electron 显式设 `domain: "agent.nuwax.com"` → Chromium 存为 `.agent.nuwax.com`（domain cookie），而 webview 登录的 `Set-Cookie` 无 Domain 属性 → Chromium 存为 `agent.nuwax.com`（host-only cookie）。两个 cookie 条目同名不同属性，`count=2` 无法互相覆盖。

### 5. Cookie 同步策略（v1.3）

**核心规则**：有有效 token → 覆盖 cookie；有过期 token → 只清对应缓存并跳过；无 token → 不做任何操作。

- reg 接口返回 token 时，不管现有 cookie 是否存在、是否在有效期，都直接调用 `syncSessionCookie` 覆盖
- reg 接口未返回 token 时，跳过同步，不清空现有 cookie（避免误清除 webview 内登录产生的 ticket）
- 同步成功后清除 one-shot token（`AUTH_TOKEN`），失败时保留以供重试
- **JWT 过期检查**（v1.3）：同步前检查 token 的 `exp` 字段，若已过期（超过 30s 宽限期）则：
  - 只清除对应来源的缓存（one-shot → `AUTH_TOKEN`，domain cache → domain key）
  - 跳过 cookie 覆写，避免用过期 token 覆盖 webview 内重新登录获得的新 ticket
  - 30s 宽限（`JWT_EXPIRY_BUFFER_MS`）容忍客户端与服务端时钟偏移
- **webview 重新登录后清缓存**（v1.3）：`persistTicketCookie()` 在检测到 webview 登录成功后，清除 `AUTH_TOKEN` + domain key 双缓存，作为主修复；`syncCookieAndBuildUrl` 的 exp 检查作为防御性兜底

**v1.2 逻辑**（已更新）：有 token → 无条件覆盖。v1.3 增加了过期检查，防止 webview 重新登录后旧缓存覆盖新 ticket。

---

## 布局结构

```
.app-container (100vh, flex column)
  ├── .app-header (48px, flex-shrink: 0)
  └── .app-body (flex: 1, flex row, overflow: hidden)
      ├── .app-sider (140px)
      └── .app-content (flex: 1, overflow-y: auto, padding: 20px 24px)
          └── wrapper div (flex: 1, flex column, min-height: 0)
              └── .page (flex: 1, flex column, min-height: 0)
                  │
                  ├── [webviewVisible = true]
                  │   └── <EmbeddedWebview url={...} onClose={...}>
                  │       └── .container (flex: 1, flex column)
                  │           ├── .toolbar (固定高度, flex-shrink: 0)
                  │           │   ├── 返回按钮
                  │           │   ├── URL 显示 (.url, ellipsis)
                  │           │   └── 刷新按钮
                  │           ├── Alert (可选, 加载失败时显示)
                  │           └── <webview> (flex: 1, 撑满剩余空间)
                  │
                  └── [webviewVisible = false]
                      ├── 依赖告警 (Alert)
                      ├── 账号状态 (section)
                      ├── 服务状态 (section)
                      └── 快捷操作 (section)
```

`.page` 添加了 `display: flex; flex-direction: column; flex: 1; min-height: 0` 以确保 webview 能撑满内容区。

---

## Webview 错误处理

`EmbeddedWebview` 组件在 `useEffect` 中注册事件监听，卸载时自动清除：

| 事件 | 处理 |
|------|------|
| `did-fail-load` | 当 `errorCode !== -3`（排除导航取消）时显示 Alert 错误提示 |
| `did-start-loading` | 清除之前的错误状态 |

错误以 `<Alert type="error" closable>` 形式显示在工具栏下方，用户可手动关闭或等待下次加载自动清除。

---

## IPC 接口

### `session:setCookie`

**方向**：Renderer → Main

**参数**：

```typescript
{
  url: string;       // cookie 关联的 URL（e.g. "https://agent.nuwax.com"）
  name: string;      // cookie 名称（e.g. "ticket"）
  value: string;     // cookie 值（token）
  // domain 不设置 → host-only cookie，与 webview Set-Cookie 行为一致
  httpOnly?: boolean; // 默认 true
  // secure 不设置 → 主进程根据 URL scheme 自动判断（HTTPS→true, HTTP→false）
}
```

**返回**：

```typescript
{ success: boolean; error?: string }
```

**实现**：
1. `removeSameNameCookies()` — 清除所有同名旧 cookie（含 domain cookie 和 host-only cookie）
2. `electronSession.defaultSession.cookies.set()` — 写新 cookie
3. 当 `secure: true` 时自动设置 `sameSite: 'no_restriction'`

---

## 安全考量

| 风险 | 缓解措施 |
|------|---------|
| webview 加载恶意内容 | 仅加载用户自己配置的 domain（`authState.domain`），非任意 URL |
| Token 泄露 | httpOnly cookie 防止 JS 读取；token 存 SQLite 与其他凭证同等安全 |
| `session:setCookie` 被滥用 | `contextIsolation: true` + preload 白名单，仅 `electronAPI.session.setCookie` 可调用 |
| `webviewTag: true` 安全性 | Electron 官方建议谨慎使用，但本场景加载可信域名，风险可控 |
| `allowpopups` | 允许页面打开弹窗（如 OAuth），弹窗共享 `defaultSession`，可信域名下可接受 |

---

## 相关文档

- [认证机制与 SavedKey 生命周期](./auth-savedkey-lifecycle.md) — savedKey / configKey 设计
- [服务启动与 Reg 同步](../../CLAUDE.md#service-startup--reg-sync) — reg 接口调用时序

---

*本文档由架构维护者负责更新*
