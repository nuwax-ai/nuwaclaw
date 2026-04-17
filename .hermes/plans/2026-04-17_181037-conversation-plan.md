# 客户端模式切换 - Code 模式嵌入实施计划

## 目标

在 `feature/client-mode` 分支上，将 AppDev 页面（Code 模式）嵌入为 Electron 客户端的第三个 Tab，使用 webview 方式加载。

## 当前状态

### 已完成 ✅
- clientMode 状态管理（启动读取 + 持久化）
- 侧边栏顶部模式 icon tabs（💬 ⇄ `</>`）
- menuItems 模式感知（Chat 模式隐藏任务/依赖/权限）
- Header 右侧模式标签
- 4 个语言文件 i18n 翻译

### 未完成 ❌
- Code 模式的 Tab 实际嵌入（点击 `</>` 图标没有对应页面）
- `TabKey` 类型中没有 `"code"`
- `activeTab === "code"` 没有对应组件渲染

---

## 实施方案

### 方案：复用 SessionsPage webview 模式

**核心思路：**
- AppDev 在 nuwax PC 浏览器端是 UMI 路由页面 `/app/:agentId` 或 `/app-dev/:projectId`
- Electron 客户端通过 webview 加载这个 URL
- 需要解决：webview 如何知道加载哪个 project

**简化方案（第一期）：**
- 创建一个 `AppDevPage` 组件
- 入口：一个简单的项目选择列表（从后端 API 获取用户有权限的 AppDev 项目）
- 选择项目后 → 打开 webview 加载 AppDev 页面
- 同时需要一个 `onWebviewChange` 回调来隐藏侧边栏

---

## 实施步骤

### Step 1: 添加 TabKey 类型

**文件：** `crates/agent-electron-client/src/renderer/App.tsx`

```typescript
// 第 117-126 行
type TabKey =
  | "client"
  | "sessions"
  | "tasks"
  | "settings"
  | "dependencies"
  | "permissions"
  | "logs"
  | "about"
  | "model"
  | "code";  // ← 新增
```

### Step 2: 创建 AppDevPage 组件

**文件：** `crates/agent-electron-client/src/renderer/components/pages/AppDevPage.tsx`

核心结构参考 SessionsPage：
- 两个视图：`list`（项目列表） 和 `webview`（AppDev 页面）
- 项目列表 API：待确认（可能复用现有的 project list API）
- Webview URL：`${serverHost}/app-dev/${projectId}?hideMenu=true` 或类似
- `onWebviewChange` 回调控制侧边栏显示/隐藏

```typescript
interface AppDevPageProps {
  onWebviewChange?: (actions: WebviewHeaderActions | null) => void;
}
```

### Step 3: 在 App.tsx 中添加渲染逻辑

**文件：** `crates/agent-electron-client/src/renderer/App.tsx`

```typescript
// 第 1719-1724 附近添加
{activeTab === "code" && (
  <AppDevPage
    onWebviewChange={setWebviewActions}
  />
)}
```

### Step 4: 导入 AppDevPage

```typescript
import AppDevPage from "./components/pages/AppDevPage";
```

### Step 5: i18n 翻译（新增）

需要新增的翻译 key：
- `Claw.AppDev.title` - "应用开发"
- `Claw.AppDev.noProjects` - "暂无应用开发项目"
- `Claw.AppDev.selectProject` - "请选择一个项目"

---

## 关键文件改动

| 文件 | 改动 |
|------|------|
| `App.tsx` | TabKey 添加 "code"；import AppDevPage；添加渲染逻辑 |
| `AppDevPage.tsx` | 新建 - 项目列表 + webview 嵌入 |
| `locales/zh-CN.json` | 新增 AppDev 翻译 |
| `locales/en-US.json` | 新增 AppDev 翻译 |
| `locales/zh-HK.json` | 新增 AppDev 翻译 |
| `locales/zh-TW.json` | 新增 AppDev 翻译 |

---

## 待确认问题

1. **AppDev 项目列表 API** — 从哪个 API 获取用户有权限的 AppDev 项目？
2. **AppDev Webview URL 格式** — `/app-dev/:projectId` 还是其他路由？
3. **登录态同步** — AppDev webview 如何复用 Electron 侧的登录 ticket？

---

## 验证步骤

1. 启动 `npm run electron:dev`
2. 侧边栏顶部点击 `</>` 图标
3. 应显示 AppDev 项目列表（或直接打开 webview）
4. 选择项目后 webview 内加载 AppDev 页面
5. 侧边栏自动隐藏（webview 模式）
6. 点击返回按钮回到项目列表

---

## 风险

1. AppDev 可能依赖一些 Electron 侧没有的全局状态（如 umi 的 useModel）
2. Webview 内登录态处理可能需要单独同步 cookie
3. AppDev 页面可能需要额外的权限校验

---

## 替代方案

如果 AppDev 作为独立 webview 有问题，可以考虑：
- **方案 B**：将 AppDev 核心组件（FileTree, ChatArea, Preview, MonacoEditor）提取为共享组件，直接嵌入 Electron
- **方案 C**：Code 模式打开新的 Electron 窗口，而不是 Tab 内嵌
