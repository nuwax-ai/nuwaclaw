---
version: 1.0
last-updated: 2026-03-12
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
        ├── loginAndRegister()  ─── if (response.token) → settingsSet('auth.token', token)
        │
        └── syncConfigToServer() ── if (response.token) → settingsSet('auth.token', token)
```

token 存入 SQLite（通过 `settingsSet`），与其他认证字段（username、password、configKey）同级管理。

### Cookie 同步时序

```
用户点击「开始会话」
    │
    ├── 1. settingsGet('auth.token') → 读取 token
    │
    ├── 2. electronAPI.session.setCookie({
    │        url:      authState.domain,         // e.g. "https://agent.nuwax.com"
    │        name:     'ticket',
    │        value:    token,
    │        domain:   new URL(domain).hostname,  // e.g. "agent.nuwax.com"
    │        httpOnly: true,
    │        secure:   domain.startsWith('https'),
    │      })
    │      │
    │      └── [Main Process] electronSession.defaultSession.cookies.set(...)
    │
    └── 3. setWebviewVisible(true)
            │
            └── <webview src={redirectUrl}> 发起请求
                ├── 请求自动携带 Set-Cookie: ticket=xxx (httpOnly)
                └── 服务端校验通过 → 免登录加载页面
```

### 清除时机

| 场景 | 动作 |
|------|------|
| 退出登录 (`clearAuthInfo`) | `settingsSet('auth.token', null)` |
| 退出登录 (`handleLogout`) | `setWebviewVisible(false)` — 关闭 webview |
| reg 返回新 token | 覆盖旧值（login 和 sync 两个入口均会更新） |

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
  httpOnly: true,      // 防止 webview 内 JS 读取 token
  secure: true/false,  // 跟随 domain 的 scheme
  sameSite: 'no_restriction',  // 允许 webview 跨站携带
}
```

- `httpOnly: true` — 安全性：即使 webview 加载的页面被注入 XSS，也无法通过 `document.cookie` 读取 token
- `sameSite: 'no_restriction'` — Electron webview 可能被视为跨站，需要宽松策略

### 4. Token 不存在时的降级

如果 reg 接口未返回 `token`（服务端未支持或字段为空），cookie 同步步骤跳过，webview 正常显示页面，用户需手动登录。不阻塞 webview 打开。

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
  domain: string;    // cookie 域（e.g. "agent.nuwax.com"）
  httpOnly?: boolean; // 默认 true
  secure?: boolean;   // 默认 true
}
```

**返回**：

```typescript
{ success: boolean; error?: string }
```

**实现**：调用 `electronSession.defaultSession.cookies.set()`，固定 `sameSite: 'no_restriction'`。

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
