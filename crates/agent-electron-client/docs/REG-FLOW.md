# reg 调用流程说明

## 概述

`reg` 接口（`POST /api/sandbox/config/reg`）用于同步本地配置到后端，并获取最新的服务器配置（`serverHost`/`serverPort`）。**所有启动服务的场景都必须先调用 reg，返回后再启动服务**，确保 lanproxy 使用最新的代理服务器地址。

---

## 统一流程

```
reg 调用 → mcpProxy → agent → fileServer → lanproxy
```

**核心原则**：reg 必须在 lanproxy 启动之前完成，因为 lanproxy 依赖 reg 返回的 `serverHost`/`serverPort`。

---

## 各场景流程

| 场景 | 触发位置 | 流程 |
|------|----------|------|
| **登录** | `ClientPage.handleLogin` | `loginAndRegister` → **reg** → mcpProxy → agent → fileServer → lanproxy |
| **启动全部** | `ClientPage.handleStartAll` | **reg** → mcpProxy → agent → fileServer → lanproxy |
| **手动启动单个** | `ClientPage.handleStartServiceManual` | 直接启动指定服务（不调用 reg） |
| **自动重连** | `App.tsx autoReconnect` | **reg** → mcpProxy → agent → fileServer → lanproxy |
| **退出登录** | `ClientPage.handleLogout` | 不调用 reg，停止所有服务 |

**说明**：手动启动单个服务时不调用 reg，因为用户通常在已登录状态下操作，配置已是最新。

---

## 代码位置

| 场景 | 文件 | 函数 |
|------|------|------|
| 登录 | `src/renderer/components/pages/ClientPage.tsx` | `handleLogin` |
| 启动全部 | `src/renderer/components/pages/ClientPage.tsx` | `handleStartAll` |
| 手动启动单个 | `src/renderer/components/pages/ClientPage.tsx` | `handleStartServiceManual` |
| 自动重连 | `src/renderer/App.tsx` | `autoReconnect` (useEffect) |
| reg 实现 | `src/renderer/services/core/auth.ts` | `syncConfigToServer` |
| 服务启动 | `src/renderer/components/pages/ClientPage.tsx` | `handleStartService` |

---

## reg 接口参数

```typescript
interface ClientRegisterParams {
  username: string;
  password: string;        // 手动登录时传入，自动认证时为空字符串
  savedKey?: string;       // 持久化密钥，跨会话有效（用于自动认证）
  deviceId?: string;
  sandboxConfigValue: {
    hostWithScheme: string;
    agentPort: number;      // 从 step1_config 读取
    vncPort: number;
    fileServerPort: number; // 从 step1_config 读取
    apiKey?: string;
    maxUsers?: number;
  };
}
```

**注意**：密码不持久化保存。首次登录后，后续自动认证仅依赖 `savedKey`。

## reg 接口返回

```typescript
interface ClientRegisterResponse {
  id: number;
  configKey: string;
  serverHost?: string;     // lanproxy 连接地址
  serverPort?: number;     // lanproxy 连接端口
  online: boolean;
  name: string;
  token?: string;          // webview cookie 同步用
  // ...
}
```

---

## 状态管理

### Loading 状态

- **不使用全局 loading**（已移除 `regSyncing` 状态和 "正在同步配置..." overlay）
- 使用服务项局部 loading（`startingServices` Set），覆盖 reg + 启动整个流程

### 防止重复启动

- 登录流程调用 `onLoginStarted()` 设置内存变量 `loginStartedRef.current = true`
- App.tsx 自动重连检查该内存变量，若为 true 则跳过（同一会话内有效，不持久化）

---

## 失败处理

| 场景 | reg 失败时行为 |
|------|---------------|
| 登录 | 继续启动服务（使用本地已保存配置） |
| 启动全部 | 继续启动服务（使用本地已保存配置） |
| 手动启动单个 | 不调用 reg，直接启动 |
| 自动重连 | 显示 notification，使用本地配置尝试启动 |

**设计原则**：reg 失败不应阻止服务启动，允许用户在离线环境下使用。

---

## 相关文档

- [TESTING-0.9.1-2026-03-19.md](./TESTING-0.9.1-2026-03-19.md) - 测试分层与 Harness-Engineering
- [review-reg-and-autoreconnect.md](./review-reg-and-autoreconnect.md) - 历史代码审查记录

---

*最后更新：2026-03-19*
