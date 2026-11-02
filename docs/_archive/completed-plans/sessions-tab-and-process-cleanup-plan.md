# Plan: 新增「会话」Tab（内嵌 webview）+ 进程清理改进

## Context

当前「开始会话」会打开一个新的浏览器窗口，体验割裂。需要重构为在主窗口内新增「会话」Tab，内嵌 webview 展示会话页面，同时展示活跃会话列表，支持打开/停止。此外需要修复停止 agent 服务时僵尸进程的问题。

---

## 1. 新增 `DetailedSession` 类型

**新建:** `src/shared/types/sessions.ts`

```typescript
export interface DetailedSession {
  id: string;
  title?: string;
  engineType: 'claude-code' | 'nuwaxcode';
  projectId?: string;
  status: 'idle' | 'pending' | 'active' | 'terminating';
  createdAt: number;
  lastActivity?: number;
}
```

---

## 2. AcpEngine + UnifiedAgentService 新增方法

**文件:** `src/main/services/engines/acp/acpEngine.ts`
- 新增 `listSessionsDetailed()` — 遍历 `this.sessions` Map 返回 DetailedSession[]（含 status/projectId/lastActivity + engineType from `this.config.engine`）

**文件:** `src/main/services/engines/unifiedAgent.ts`
- 新增 `listAllSessionsDetailed()` — 遍历 `this.engines` Map，汇总所有 engine 的 sessions

---

## 3. 新增 IPC handlers + Preload

**文件:** `src/main/ipc/agentHandlers.ts`
- `agent:listSessionsDetailed` — 调用 `agentService.listAllSessionsDetailed()`
- `agent:stopSession` — 根据 sessionId 定位 engine，先 abort 再 destroy 该 engine

**文件:** `src/preload/index.ts`
- `agent.listSessionsDetailed`
- `agent.stopSession`

---

## 4. 新增 SessionsPage 组件（核心变更）

**新建:** `src/renderer/components/pages/SessionsPage.tsx`

### 布局设计

SessionsPage 内部有两个视图，通过 state 切换：

#### 视图 A: 会话列表（默认）

- **顶部操作栏**: 「新建会话」按钮 + 「刷新」按钮
- **活跃会话列表**（Ant Design Table/List）:
  - 每行: 会话标题/ID、引擎类型 Tag、状态 Tag、创建时间
  - 操作: 「打开」按钮（切换到视图 B 展示该会话 webview）、「停止」按钮（kill 进程）
- 每 3s 轮询 `agent:listSessionsDetailed` 刷新
- 空状态提示

#### 视图 B: 内嵌 webview

- 复用现有 `EmbeddedWebview` 组件（`src/renderer/components/EmbeddedWebview.tsx`）
- 工具栏「返回」按钮 → 切回视图 A
- URL 构造复用 ClientPage 中的 redirect URL 逻辑：`${domain}/api/sandbox/config/redirect/${userId}`
- Cookie 设置复用 ClientPage 中的 setCookie 逻辑

### 「新建会话」流程

点击「新建会话」→ 执行 cookie sync → 构造 redirect URL → 切换到视图 B（内嵌 webview 加载 URL）

### 「打开」已有会话流程

点击列表中「打开」→ 同样切换到视图 B，URL 可附带 session 参数（如果后端支持）或直接用 redirect URL

### Props

SessionsPage 需要从 App.tsx 获取 auth 信息来构造 URL。两种方案：
- **方案 A（推荐）**: 组件内部通过 `window.electronAPI.settings.get()` 读取 auth 信息（domain, userId, token），自包含
- 方案 B: 从 App.tsx 传 props

---

## 5. 重构 ClientPage「开始会话」

**文件:** `src/renderer/components/pages/ClientPage.tsx`

- `handleStartSession` 改为调用 `onNavigate('sessions')`（已有此 prop）切换到会话 Tab
- 删除 `webview.openWindow` 相关逻辑
- 保留 QR 码功能不变

---

## 6. App.tsx 集成

**文件:** `src/renderer/App.tsx`

1. TabKey 类型新增 `'sessions'`
2. `menuItems` 在 `'client'` 之后插入 `{ key: 'sessions', icon: <TeamOutlined />, label: '会话' }`
3. 渲染区域新增 `{activeTab === 'sessions' && <SessionsPage />}`
4. import `SessionsPage` 和 `TeamOutlined`

---

## 7. 进程清理改进（僵尸进程修复）

### 7a. 进程树 kill 工具

**新建:** `src/main/services/utils/processTree.ts`

```typescript
export async function killProcessTree(pid: number, signal?: NodeJS.Signals): Promise<void>
```

- macOS/Linux: spawn 时 `detached: true` + `process.kill(-pid, signal)` 杀进程组
- Windows: `taskkill /T /F /PID`
- 兜底: SIGTERM → 等 3s → SIGKILL

### 7b. AcpEngine.destroy() — SIGKILL 升级 + 进程树

**文件:** `src/main/services/engines/acp/acpEngine.ts`

改当前 `this.acpProcess.kill()` 为：
1. 用 `killProcessTree(pid, 'SIGTERM')` 杀进程树
2. 等待最多 5s（监听 `exit` 事件）
3. 超时后 `killProcessTree(pid, 'SIGKILL')` 强杀

### 7c. AcpClient spawn — Unix 下 detached: true

**文件:** `src/main/services/engines/acp/acpClient.ts`

`createAcpConnection` spawn 时非 Windows 加 `detached: true`，支持进程组杀法。

### 7d. UnifiedAgentService.destroy() — 每个 engine 加超时

**文件:** `src/main/services/engines/unifiedAgent.ts`

每个 `engine.destroy()` 外包 `Promise.race` + 10s 超时。

### 7e. ManagedProcess.kill() — SIGKILL 升级

**文件:** `src/main/processManager.ts`

SIGTERM 后设 3s 定时器，进程未退出则 SIGKILL。

---

## 实施顺序

1. `src/shared/types/sessions.ts` — 新建 DetailedSession 类型
2. `src/main/services/utils/processTree.ts` — 新建进程树 kill 工具
3. `src/main/services/engines/acp/acpClient.ts` — spawn detached: true（Unix）
4. `src/main/services/engines/acp/acpEngine.ts` — listSessionsDetailed() + destroy() 改进
5. `src/main/services/engines/unifiedAgent.ts` — listAllSessionsDetailed() + destroy 超时
6. `src/main/processManager.ts` — kill() SIGKILL 升级
7. `src/main/ipc/agentHandlers.ts` — 新增 IPC handlers
8. `src/preload/index.ts` — 暴露新 IPC
9. `src/renderer/components/pages/SessionsPage.tsx` — 新建会话页面（列表 + 内嵌 webview）
10. `src/renderer/App.tsx` — 新增 sessions tab
11. `src/renderer/components/pages/ClientPage.tsx` — 重构「开始会话」为导航到 sessions tab

---

## 验证

1. `npm run electron:dev` 启动应用
2. 登录后点击「开始会话」→ 确认跳转到「会话」tab 并在内嵌 webview 中打开（不再弹出新窗口）
3. 「会话」tab 列表中可见活跃会话，状态正确
4. 点击列表中「打开」→ 切到 webview 展示
5. 点击「停止」→ 会话进程被终止，列表刷新
6. 停止 agent 服务 → 所有引擎进程及子进程被清理，`ps aux | grep acp` 无僵尸
7. webview 工具栏「返回」→ 回到列表视图
