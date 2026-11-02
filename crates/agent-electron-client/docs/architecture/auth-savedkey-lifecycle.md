---
version: 1.1
last-updated: 2026-03-19
status: stable
---

# 认证机制与 SavedKey 生命周期

> 本文档说明 Nuwax Agent 客户端的认证设计，重点描述 `savedKey` 的作用、存储结构、完整生命周期，以及退出登录与服务启动的联动逻辑。

---

## 核心概念

### 两类认证凭证

| 凭证 | 存储键 | 说明 | 退出登录后 |
|------|--------|------|-----------|
| `configKey` | `auth.config_key` | 当前会话的登录态 token，从服务端 `/register` 接口获取 | **清除** |
| `savedKey` | `auth.saved_key` | 设备级注册凭证（"记住我" token），与 configKey 值相同，但跨登录会话持久化 | **保留** |

> **重要**：`savedKey` 与 `configKey` 值相同（均为服务端返回的 `response.configKey`），区别在于持久化策略不同。`savedKey` 的存在代表"这台设备已完成注册，可以免密重新认证"。

### 多账号隔离存储

`savedKey` 按 `domain + username` 维度分别存储，支持同一设备多账号切换：

```
auth.saved_key                          ← 全局快速访问（最后一次登录的账号）
auth.saved_keys.<domain>_<username>     ← 域名+用户级持久化（每个账号独立）
```

**键名与迁移**：存储键中的 `<domain>` 由 `normalizeDomain()`（auth.ts）生成（hostname 或规范化字符串）。若未来调整域名规范化规则（如大小写、去端口、trailing slash），需考虑旧键兼容或提供迁移逻辑，避免已存账号无法匹配。

---

## 完整生命周期

### 第一次登录（全新设备/账号）

```
用户输入 domain + username + password
    │
    └── getSavedKey(domain, username)
        └── 未找到 → savedKey = undefined
            │
            └── registerClient({ username, password, savedKey: undefined })
                │
                └── 服务端返回 { configKey, ... }
                    │
                    ├── setConfigKey(configKey)
                    │       └── auth.config_key = configKey
                    │
                    └── setSavedKey(configKey, domain, username)
                            ├── auth.saved_keys.<domain>_<username> = configKey
                            └── auth.saved_key = configKey
```

### 退出登录

```
用户点击"退出登录"（ClientPage.tsx → handleLogout）
    │
    ├── 1. 停止所有运行中的服务（按顺序）
    │       ├── agent.destroy()
    │       ├── fileServer.stop()
    │       ├── lanproxy.stop()
    │       ├── mcp.stop()
    │       └── computerServer.stop()   ← 登出时单独停止，避免进程残留与端口占用
    │
    └── 2. logout() → clearAuthInfo()
            ├── auth.username      = null
            ├── auth.config_key    = null    ← 登录态清除
            ├── auth.user_info     = null
            ├── auth.online_status = null
            └── auth.saved_key     = 保留    ← 设备凭证不清除，下次可免密重连
```

> **注意**：密码从不持久化保存。登录时用户输入的密码仅用于本次认证请求，不存入数据库。

### 重新打开 App（有 savedKey，自动重连）

```
App 启动 → autoReconnect（App.tsx）
    │
    ├── 检查 loginStartedRef.current（内存变量）
    │       └── 已由登录流程启动 → 跳过（同一会话内有效）
    │
    ├── 检查 setupJustCompleted
    │       └── 向导刚完成 → 直接启动服务（不走重连）
    │
    └── 读取 auth.saved_key
            ├── 不存在 → 跳过（首次使用，需手动登录）
            │
            └── 存在 → syncConfigToServer({ suppressToast: true })
                    │
                    ├── 成功（服务端接受 savedKey）
                    │       ├── 更新 auth.config_key（新 token）
                    │       ├── 更新 auth.saved_key（续期）
                    │       ├── 更新 auth.online_status / user_info
                    │       └── startServicesSequentially(
                    │               ['mcpProxy', 'agent', 'fileServer', 'lanproxy']
                    │           )
                    │
                    └── 失败（网络断开 / token 过期 / 账号被封）
                            └── 服务不启动，停留在登录页
```

### 用户再次登录（已有 savedKey 的账号）

```
用户输入 domain + username + password
    │
    └── getSavedKey(domain, username)
        └── 找到 → savedKey = "<持久化的 configKey>"
            │
            └── registerClient({ username, password, savedKey })
                    └── 服务端识别为老设备，直接续期返回新 configKey
```

### 切换账号（不同 domain 或 username）

```
用户输入 domainB + userB（与上次不同）
    │
    └── getSavedKey(domainB, userB)
        └── 未找到 → savedKey = undefined
            │
            └── registerClient({ username, password, savedKey: undefined })
                    └── 服务端视为全新设备注册
```

---

## 服务与登录状态的联动规则

| 场景 | 服务行为 |
|------|---------|
| 当前会话退出登录 | 立即停止所有运行中的服务 |
| 重启 App，有 savedKey，重连成功 | 自动启动全部服务（mcpProxy → agent → fileServer → lanproxy）|
| 重启 App，有 savedKey，重连失败 | 服务不启动，停留在登录页 |
| 重启 App，无 savedKey | 服务不启动，停留在登录页 |
| 手动登录成功 | 由 `onComplete` 触发服务启动（不走 autoReconnect）|

> **服务启动顺序固定**：`mcpProxy` 必须先于 `agent`，因为 Agent 初始化时需要连接 MCP Proxy 注入 mcpServers。

---

## 相关代码位置

| 逻辑 | 文件 | 关键函数/位置 |
|------|------|--------------|
| savedKey 存取 | `src/renderer/services/core/auth.ts` | `getSavedKey()` / `setSavedKey()` L86-100 |
| 退出登录清理 | `src/renderer/services/core/auth.ts` | `clearAuthInfo()` L131-138 |
| 停止服务+登出 | `src/renderer/components/pages/ClientPage.tsx` | `handleLogout()` L171-200 |
| 自动重连逻辑 | `src/renderer/App.tsx` | `autoReconnect` effect L297-349 |
| 静默重新认证 | `src/renderer/services/core/auth.ts` | `syncConfigToServer()` L383-458 |
| 注册/登录 | `src/renderer/services/core/auth.ts` | `loginAndRegister()` L209-314 |

---

## 相关文档

- [依赖与服务生命周期](./dependency-and-services-lifecycle.md)
- [存储实现](./STORAGE.md)
- [安全审查](../reviews/SECURITY-REVIEW.md)
