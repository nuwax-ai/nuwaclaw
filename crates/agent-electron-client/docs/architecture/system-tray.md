# 系统托盘逻辑与实现

> 本文档梳理 Electron 客户端**系统托盘（Tray）**的创建时机、图标策略、右键菜单、与主进程/渲染进程的协作，以及 macOS 开发模式下托盘不显示的缓解措施。

---

## 1. 概述

- **平台**：macOS（菜单栏）、Windows / Linux（系统托盘区）。
- **能力**：左键/双击显示主窗口、右键上下文菜单（显示主窗口、重启/停止服务、开机自启动、检查更新、退出）。
- **状态**：图标统一，状态通过 **tooltip** 区分（`TrayStatus`：运行中 / 已停止 / 错误 / 启动中）；不按状态切换多套图标文件。
- **依赖**：主进程 `TrayManager`（`window/trayManager.ts`）、`ServiceManager`（托盘菜单中的重启/停止）、`AutoLaunchManager`（开机自启动）。

---

## 2. 创建时机

| 场景 | 行为 |
|------|------|
| **非 macOS** 或 **已打包** | `app.whenReady()` 内：`createWindow()` 后立即 `initTrayManager()`；macOS 时先 `app.dock.show()`。 |
| **macOS 且未打包（开发）** | 不在 `whenReady` 里创建托盘；在 main 窗口 **`ready-to-show`** 回调里 `show()` 之后 **延迟 300ms** 再执行 `initTrayManager()`，以减少「从终端启动时菜单栏托盘不显示」的问题。 |

- 实现位置：`main.ts` 中 `createWindow()`、`mainWindow.once('ready-to-show', ...)` 与 `app.whenReady().then(...)`。
- 托盘实例通过模块级变量 `trayManager` 持有，避免被回收。

---

## 3. 图标策略

### 3.1 图标文件（`public/tray/`）

| 文件 | 用途 |
|------|------|
| `trayTemplate.png` | macOS 打包后：22x22 黑色剪影（Template Image，随系统主题变色）。 |
| `trayTemplate@2x.png` | macOS 打包后：44x44 Retina 版。 |
| `tray.png` | Windows/Linux 托盘；macOS 开发模式回退。 |
| `tray@2x.png` | macOS 开发模式优先使用（高分辨率）。 |

### 3.2 路径解析（`getIconPath`）

- **打包后**：`path.join(process.resourcesPath, 'tray', fileName)`（如 `*.app/Contents/Resources/tray/trayTemplate@2x.png`）。
- **开发**：使用 **`__dirname` 相对路径**，不依赖 `process.cwd()`，避免 monorepo 或从其他目录启动时图标找不到。
  - 编译后 `trayManager` 在 `dist/main/window/`，故 `path.join(__dirname, '..', '..', '..', 'public', 'tray', fileName)` 指向包根目录下的 `public/tray/`。

### 3.3 按平台与模式选择图标（`createTrayIcon`）

| 平台 | 模式 | 行为 |
|------|------|------|
| **macOS** | 开发（`!app.isPackaged`） | 使用**彩色图标**：先 `tray@2x.png`，失败则 `tray.png`；若尺寸 > 22 则缩放到 22x22。**不使用** Template Image，避免菜单栏不显示。若两个文件都加载失败，则用 1x1 PNG data URL 生成 22x22 占位图。 |
| **macOS** | 打包后 | 使用 **Template**：先 `trayTemplate@2x.png`，失败则 `trayTemplate.png`，`setTemplateImage(true)`。失败时同样回退到占位图。 |
| **Windows / Linux** | 任意 | 使用 `tray.png`（彩色）。 |

- **占位图**：`createPlaceholderTrayImage(size)` 用 1x1 PNG 的 data URL 生成图并 resize 到 16~22px，保证传给 `new Tray(icon)` 的始终为非空 `NativeImage`，避免因空图导致托盘不创建或不可见。

---

## 4. TrayManager 与选项

### 4.1 单例与创建

- `createTrayManager(options)`：若已有实例则先 `destroy()`，再 `new TrayManager(options)` 并赋值给模块级 `trayManager`。
- `getTrayManager()`：返回当前单例或 null。

### 4.2 TrayManagerOptions（main 传入）

| 字段 | 说明 |
|------|------|
| `onShowWindow` | 左键/双击托盘时调用：`mainWindow?.show()`、`mainWindow?.focus()`。 |
| `onRestartServices` | 菜单「重启服务」：调用 `serviceManager.restartAllServices()`，成功后 `trayManager.updateServicesStatus(true)`。 |
| `onStopServices` | 菜单「停止服务」：调用 `serviceManager.stopAllServices()`，然后 `trayManager.updateServicesStatus(false)`。 |

### 4.3 内部状态

- `status`：`TrayStatus` = `'running' | 'stopped' | 'error' | 'starting'`，用于 tooltip 文案。
- `servicesRunning`：布尔，控制「停止服务」是否 enabled、以及与 `status` 的联动。
- `autoLaunchEnabled`：来自 `AutoLaunchManager.isEnabled()`，用于菜单「开机自启动」勾选状态。

### 4.4 事件与菜单

- **click**：`onShowWindow()`。
- **double-click**：`onShowWindow()`。
- **setToolTip**：初始为应用名；`updateIcon()` 时设为 `"应用名 - 运行中/已停止/错误/启动中"`。
- **setContextMenu**：由 `updateMenu()` 构建，见下表。

---

## 5. 右键菜单项

| 菜单项 | 行为 |
|--------|------|
| 显示主窗口 | `onShowWindow()` |
| （分隔线） | — |
| 重启服务 | `onRestartServices()` |
| 停止服务 | `enabled: servicesRunning`，点击 `onStopServices()` |
| （分隔线） | — |
| 开机自启动 | checkbox，`checked: autoLaunchEnabled`，点击切换并调用 `autoLaunchManager.setEnabled(newEnabled)`，失败弹窗 |
| 检查更新 | 调用 `showUpdateDialogFlow()`（autoUpdater） |
| （分隔线） | — |
| 关于 {App} v{x} | 仅展示，`enabled: false` |
| 退出 | `app.quit()` |

---

## 6. IPC 与渲染进程同步

- **通道**：`tray:updateStatus`、`tray:updateServicesStatus`（main 中 `ipcMain.handle`）。
- **preload**：`tray.updateStatus(status)`、`tray.updateServicesStatus(running)`。
- **用途**：渲染进程可根据 Agent/服务状态调用上述 API，使托盘 tooltip 与「停止服务」可用状态与界面一致。当前主进程侧在托盘菜单「重启服务」「停止服务」后会调用 `updateServicesStatus`，渲染进程若需与客户端页状态同步可调用 `tray.updateStatus(status)` / `tray.updateServicesStatus(running)`。

---

## 7. Dock 图标（仅 macOS）

- 在 `app.whenReady()` 内：若 `process.platform === 'darwin' && app.dock`，则用 `getDockIconPath()` 加载 PNG（开发：`process.cwd()/public/icon-dock.png`，打包：`process.resourcesPath/icon-dock.png`），成功则 `app.dock.setIcon(iconImage)`。
- 目的：开发模式下明确设置 Dock 图标，便于识别；与托盘图标相互独立。

---

## 8. 窗口关闭与应用退出

- **window-all-closed**：  
  - 非 macOS：直接 `app.quit()`，触发 `before-quit` → 清理进程与 DB。  
  - macOS：不退出应用；仅做服务清理（MCP、lanproxy、agentRunner、fileServer 等），主窗口可关，托盘仍在，用户可通过托盘再次「显示主窗口」或「退出」。
- **activate**（macOS）：若无窗口则再次 `createWindow()`。
- **before-quit**：执行 `cleanupAllProcesses()`（含 Agent、ComputerServer、FileServer、Lanproxy、MCP、引擎等），然后 `closeDb()`、`app.exit(0)`。托盘在进程退出时随之销毁。

---

## 9. 涉及文件汇总

| 类型 | 路径 |
|------|------|
| 托盘核心 | `src/main/window/trayManager.ts`（TrayManager、图标逻辑、菜单、单例） |
| 导出 | `src/main/trayManager.ts`（re-export） |
| 主进程入口 | `src/main/main.ts`（initTrayManager、创建时机、IPC、Dock、window-all-closed） |
| 服务与自启 | `src/main/window/serviceManager.ts`、`src/main/window/autoLaunchManager.ts` |
| 更新 | `src/main/services/autoUpdater.ts`（检查更新） |
| Preload / 类型 | `src/preload/index.ts`（tray API）、`src/shared/types/electron.d.ts`（TrayAPI） |
| 图标资源 | `public/tray/trayTemplate.png`、`trayTemplate@2x.png`、`tray.png`、`tray@2x.png` |

---

## 10. macOS 开发模式托盘不显示说明

- **现象**：从终端运行 `electron .` 或 npm 开发脚本时，菜单栏托盘图标有时不出现；日志中已打印「Tray created」「icon loaded」。
- **原因**：Electron/macOS 在非 .app 打包、从命令行启动时，对菜单栏图标的显示存在已知差异。
- **当前缓解**：  
  1. **延迟创建**：仅在 macOS 且未打包时，在 main 窗口 `ready-to-show` 且 `show()` 后延迟 300ms 再创建 Tray。  
  2. **开发用彩色图标**：macOS 开发模式一律使用 `tray.png` / `tray@2x.png`，不用 Template Image。  
  3. **图标路径**：开发下用 `__dirname` 相对路径解析到 `public/tray/`，避免 cwd 不准。  
  4. **占位图**：图标文件缺失时仍传入非空占位图，避免 `new Tray(empty)` 导致不显示。
- **验证**：打包后的 .app 在 macOS 上托盘通常正常；若开发下仍不显示，可查看日志中 `[Tray]` 行确认使用的是彩色图标还是占位图。
