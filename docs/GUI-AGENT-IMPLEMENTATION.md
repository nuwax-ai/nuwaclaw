# GUI Agent 实现文档

GUI Agent 使 AI 引擎（claude-code / nuwaxcode）能够通过 bash curl 调用本地 HTTP 服务完成屏幕截图和键鼠操作，支持 macOS / Windows / Linux。

---

## 架构

```
Agent Process (claude-code / nuwaxcode)
    │  bash: curl http://127.0.0.1:$GUI_AGENT_PORT/gui/xxx
    │        -H "Authorization: Bearer $GUI_AGENT_TOKEN"
    ▼
GUI Agent HTTP Server (Electron Main Process, 127.0.0.1 only)
    ├── POST /gui/screenshot    → ScreenshotService (desktopCapturer)
    ├── POST /gui/input         → InputService (@nut-tree/nut-js)
    ├── GET  /gui/displays      → screen.getAllDisplays()
    ├── GET  /gui/cursor        → mouse.getPosition()
    ├── GET  /gui/permissions   → PermissionService
    └── GET  /gui/health        → { status: 'ok' }
```

Agent 进程在 ACP 启动时自动获得两个环境变量：

| 环境变量 | 说明 |
|---------|------|
| `GUI_AGENT_PORT` | HTTP 服务端口（默认 60010） |
| `GUI_AGENT_TOKEN` | Bearer Token（每次启动时随机生成 UUID v4） |

同时，ACP 引擎的 system prompt 会自动追加 GUI Agent 使用说明（包含 curl 示例、坐标系说明等），Agent 无需额外配置即可使用。

---

## 启用

### 方式一：设置 UI

1. 打开 **设置** → **GUI Agent 设置**（`GUIAgentSettings.tsx` 组件）
2. 打开「启用 GUI Agent」开关
3. 点击「启动」按钮
4. 服务启动后会显示 Token 和端口

### 方式二：IPC 调用（渲染进程）

```typescript
// 启动（使用默认或持久化配置）
const result = await window.electronAPI.guiAgent.start();
// result: { success: true, token: 'uuid-v4-token' }

// 启动（自定义配置）
const result = await window.electronAPI.guiAgent.start({
  port: 60010,
  screenshotScale: 0.5,
  screenshotFormat: 'jpeg',
  screenshotQuality: 80,
  rateLimit: 10,
});
```

### 自动注入

服务启动后，下一次 Agent 引擎创建时会自动：

1. 通过 `engineHooks` 的 `envProvider` 注入 `GUI_AGENT_PORT` + `GUI_AGENT_TOKEN` 到引擎进程环境
2. 通过 `engineHooks` 的 `promptEnhancer` 在 system prompt 末尾追加 GUI Agent 使用指南

---

## 配置

### 默认配置（`DEFAULT_GUI_AGENT_CONFIG`）

| 字段 | 默认值 | 说明 |
|------|--------|------|
| `enabled` | `false` | 是否启用 |
| `port` | `60010` | HTTP 服务端口 |
| `screenshotScale` | `0.5` | 截图缩放比例（0.1 - 1.0），减小体积 |
| `screenshotFormat` | `'jpeg'` | 截图格式（jpeg / png） |
| `screenshotQuality` | `80` | JPEG 质量（1-100） |
| `rateLimit` | `10` | 速率限制（ops/s） |

### 持久化

配置存储在 SQLite，键为 `gui_agent_config`（`STORAGE_KEYS.GUI_AGENT_CONFIG`）。

```typescript
// 读取
const config = await window.electronAPI.guiAgent.getConfig();

// 修改并保存
await window.electronAPI.guiAgent.setConfig({
  port: 60020,
  screenshotScale: 0.8,
  rateLimit: 20,
});
```

---

## 停止

### 方式一：设置 UI

点击 GUI Agent 设置页中的「停止」按钮。

### 方式二：IPC 调用

```typescript
await window.electronAPI.guiAgent.stop();
```

### 自动清理

应用退出时，`guiAgentHandlers.ts` 通过 `app.on('will-quit')` 自动停止服务。无需在 `main.ts` 中手动添加清理代码。

---

## API 端点

所有端点均需 Bearer Token 认证，绑定 `127.0.0.1`（仅本地访问）。

### POST /gui/screenshot

截取屏幕截图。

```bash
curl -X POST http://127.0.0.1:60010/gui/screenshot \
  -H "Authorization: Bearer $GUI_AGENT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"scale": 0.5, "format": "jpeg", "quality": 80}'
```

**请求参数（均可选）：**

| 字段 | 类型 | 说明 |
|------|------|------|
| `scale` | `number` | 缩放比例 0.1-1.0 |
| `format` | `string` | `"jpeg"` 或 `"png"` |
| `quality` | `number` | JPEG 质量 1-100 |
| `displayIndex` | `number` | 显示器索引（默认 0 = 主屏） |
| `region` | `{x, y, width, height}` | 裁剪区域 |

**返回：**
```json
{
  "success": true,
  "data": {
    "image": "base64...",
    "mimeType": "image/jpeg",
    "width": 2560,
    "height": 1440,
    "scaledWidth": 1280,
    "scaledHeight": 720,
    "elapsed": 150
  }
}
```

### POST /gui/input

执行键鼠操作。

```bash
# 鼠标点击
curl -X POST http://127.0.0.1:60010/gui/input \
  -H "Authorization: Bearer $GUI_AGENT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"action": {"type": "mouse_click", "x": 100, "y": 200}}'

# 键盘输入
curl -X POST http://127.0.0.1:60010/gui/input \
  -H "Authorization: Bearer $GUI_AGENT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"action": {"type": "keyboard_type", "text": "Hello World"}}'

# 快捷键
curl -X POST http://127.0.0.1:60010/gui/input \
  -H "Authorization: Bearer $GUI_AGENT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"action": {"type": "keyboard_hotkey", "keys": ["cmd", "c"]}}'
```

**支持的 action types：**

| 类型 | 参数 | 说明 |
|------|------|------|
| `mouse_move` | `x, y` | 移动鼠标 |
| `mouse_click` | `x, y, button?` | 单击 |
| `mouse_double_click` | `x, y, button?` | 双击 |
| `mouse_drag` | `startX, startY, endX, endY` | 拖拽 |
| `mouse_scroll` | `x, y, deltaY, deltaX?` | 滚轮 |
| `keyboard_type` | `text` | 输入文本 |
| `keyboard_press` | `key` | 按单个键 |
| `keyboard_hotkey` | `keys[]` | 组合键 |

### GET /gui/displays

获取所有显示器信息。

```bash
curl http://127.0.0.1:60010/gui/displays \
  -H "Authorization: Bearer $GUI_AGENT_TOKEN"
```

### GET /gui/cursor

获取鼠标当前位置。

```bash
curl http://127.0.0.1:60010/gui/cursor \
  -H "Authorization: Bearer $GUI_AGENT_TOKEN"
```

### GET /gui/permissions

检查平台权限状态。

```bash
curl http://127.0.0.1:60010/gui/permissions \
  -H "Authorization: Bearer $GUI_AGENT_TOKEN"
```

### GET /gui/health

健康检查。

```bash
curl http://127.0.0.1:60010/gui/health \
  -H "Authorization: Bearer $GUI_AGENT_TOKEN"
```

---

## 安全机制

| 机制 | 说明 |
|------|------|
| **Bearer Token** | 每次启动时 `crypto.randomUUID()` 生成，通过 env 传递给引擎 |
| **127.0.0.1 绑定** | HTTP 服务仅监听本地回环地址 |
| **令牌桶速率限制** | 默认 10 ops/s，防止滥用 |
| **请求体大小限制** | 1MB |
| **审计日志** | 环形缓冲区记录最近 1000 条操作 |

---

## 平台权限

| 平台 | 截图权限 | 键鼠权限 | 检测方式 |
|------|---------|---------|---------|
| **macOS** | Screen Recording | Accessibility | `systemPreferences.getMediaAccessStatus('screen')` + `isTrustedAccessibilityClient(true)` |
| **Windows** | 不需要 | 不需要 | 返回 `not_needed` |
| **Linux** | X11 自动支持；Wayland 受限 | 需要 xdotool (X11) | `$XDG_SESSION_TYPE` + `which xdotool` |

权限管理 IPC：

```typescript
// 检查权限
const info = await window.electronAPI.guiAgent.checkPermissions();
// { screenCapture: 'granted', accessibility: 'denied', platform: 'darwin' }

// 请求授权（macOS 弹窗）
await window.electronAPI.guiAgent.requestPermission('screenCapture');
await window.electronAPI.guiAgent.requestPermission('accessibility');

// 打开系统设置
await window.electronAPI.guiAgent.openPermissionSettings('screenCapture');
```

---

## 文件结构

```
src/main/services/gui/              # 自包含模块，core 代码零依赖
├── guiAgentServer.ts               # HTTP 服务（路由、生命周期）
├── screenshotService.ts            # 截图（desktopCapturer）
├── inputService.ts                 # 键鼠（@nut-tree/nut-js, lazy load）
├── permissionService.ts            # 平台权限检测
├── securityManager.ts              # Token、速率限制、审计日志
├── systemPrompt.ts                 # Agent system prompt 生成
└── index.ts                        # barrel export

src/main/services/engines/
└── engineHooks.ts                  # 通用扩展点（envProvider + promptEnhancer）

src/main/ipc/
└── guiAgentHandlers.ts             # IPC + 自注册 hooks + cleanup

src/shared/types/
└── guiAgentTypes.ts                # 共享类型定义

src/renderer/components/settings/
└── GUIAgentSettings.tsx            # Ant Design 设置 UI
```

### 低侵入设计

核心模块的改动极小，GUI Agent 通过 hooks 自注册：

| 核心文件 | 改动 |
|---------|------|
| `acpEngine.ts` | +2 行：import `enhanceSystemPrompt`，调用 `enhanceSystemPrompt(request.system_prompt)` |
| `unifiedAgent.ts` | +5 行：import `collectEnvFromProviders`，收集并合并 hook env |
| `ipc/index.ts` | +2 行：import + 调用 `registerGuiAgentHandlers()` |
| `main.ts` | **0 改动** — cleanup 由 guiAgentHandlers 自注册 |

---

## 依赖

| 包 | 用途 | 备注 |
|----|------|------|
| `@nut-tree/nut-js` | 键鼠自动化 | 可选，lazy load，不影响截图功能 |

安装：
```bash
cd crates/agent-electron-client
npm install @nut-tree/nut-js
```
