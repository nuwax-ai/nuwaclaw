# 应用自动更新

## 概述

基于 `electron-updater` 实现应用内自动更新，支持 macOS / Windows (NSIS) / Linux 自动下载安装，Windows MSI 安装引导到 Releases 页面手动下载。

## 核心文件

| 文件 | 职责 |
|------|------|
| `src/main/services/autoUpdater.ts` | 更新服务：检查、下载、安装、状态管理 |
| `src/renderer/components/pages/AboutPage.tsx` | 关于页面：手动检查更新 UI |
| `src/main/window/trayManager.ts` | 托盘菜单：检查更新入口 |
| `src/main/ipc/appHandlers.ts` | IPC 处理：checkUpdate / downloadUpdate / installUpdate / openReleasesPage |
| `src/preload/index.ts` | preload 暴露 API |
| `src/shared/types/updateTypes.ts` | 类型定义：UpdateState / UpdateInfo / UpdateProgress |
| `dev-app-update.yml` | 开发模式更新源配置 |

## 更新流程

### 1. 启动自动检查

```
App 启动 → 延迟 10s → checkForUpdates()
                         │
                         ├── 无更新 → 静默，不提示
                         │
                         ├── 有更新 → 检查 skipped version
                         │              │
                         │              ├── 已跳过 → 不弹窗
                         │              │
                         │              └── 未跳过 → 弹窗提示
                         │                            │
                         │                            ├── "立即更新" → 下载 → 二次确认 → 重启安装
                         │                            │
                         │                            └── "跳过此版本" → 记录到文件，下次不再提示
                         │
                         └── 失败 → 静默记录日志
```

### 2. 手动检查（About 页面）

```
用户点击 "检查更新"
  │
  ├── 检查中... (loading 状态)
  │
  ├── 无更新 → 提示 "当前已是最新版本"，重置按钮
  │
  ├── 有更新 → 显示 "下载更新" 按钮
  │              │
  │              └── 点击 → 下载（显示进度条）→ 完成 → Modal 确认 → 重启安装
  │
  └── 错误 → 显示错误信息 + 重试按钮
```

### 3. 手动检查（托盘菜单）

与 About 页面类似，但使用原生 `dialog.showMessageBox` 弹窗交互。

## Windows 安装类型检测

通过检查 NSIS 卸载程序文件是否存在来区分安装方式：

```typescript
// NSIS 安装会生成: {appDir}/Uninstall {productName}.exe
// MSI 安装由 Windows Installer 管理，无此文件
function detectInstallerType(): InstallerType {
  const nsisUninstaller = path.join(appDir, `Uninstall ${productName}.exe`);
  return fs.existsSync(nsisUninstaller) ? 'nsis' : 'msi';
}
```

| 安装类型 | 自动更新 | 行为 |
|----------|---------|------|
| NSIS (.exe) | 支持 | 下载 → 重启安装 |
| MSI (.msi) | 不支持 | 引导到 GitHub Releases 页面 |
| macOS (.dmg) | 支持 | 下载 → 重启安装 |
| Linux (.AppImage/.deb) | 支持 | 下载 → 重启安装 |

## 跳过版本

- 用户在启动弹窗中选择"跳过此版本"后，版本号写入 `~/.nuwaxbot/.skipped-update-version`
- 下次启动时，若远程最新版本与已跳过版本相同，不弹窗
- 出现更新的版本（高于已跳过版本）时，重新弹窗提示
- 手动检查更新（About 页面 / 托盘菜单）不受跳过逻辑影响

## 安装前清理

`installUpdate()` 在调用 `quitAndInstall()` 之前，先执行 `cleanupAllProcesses()`：

- 停止 Computer Server
- 销毁 Unified Agent Service
- 终止 Agent Runner / Lanproxy / File Server 进程
- 清理 MCP Proxy
- 停止所有 Engine 进程

## 开发模式

- 通过 `dev-app-update.yml` 配置更新源（GitHub）
- `forceDevUpdateConfig = true` 启用开发模式检查
- 允许检查更新（验证 API 通路）
- 下载和安装被阻止（Squirrel.Mac bundle ID 不匹配会导致崩溃）
- `autoInstallOnAppQuit = false`

## 自定义更新源

通过环境变量 `NUWAX_UPDATE_SERVER` 可指定自定义更新服务器：

```bash
NUWAX_UPDATE_SERVER=http://localhost:8080/updates npm run dev
```

使用 `generic` provider，适合本地测试。

## UpdateState 类型

```typescript
interface UpdateState {
  status: 'idle' | 'checking' | 'available' | 'not-available' | 'downloading' | 'downloaded' | 'error';
  version?: string;
  progress?: { percent: number; bytesPerSecond: number; transferred: number; total: number };
  error?: string;
  canAutoUpdate?: boolean;  // false 表示 MSI 安装，需手动下载
}
```

## IPC 通道

| 通道 | 方向 | 说明 |
|------|------|------|
| `app:checkUpdate` | renderer → main | 手动检查更新 |
| `app:downloadUpdate` | renderer → main | 下载更新 |
| `app:installUpdate` | renderer → main | 重启安装 |
| `app:getUpdateState` | renderer → main | 获取当前更新状态 |
| `app:openReleasesPage` | renderer → main | 打开 GitHub Releases |
| `update:status` | main → renderer | 推送更新状态变化 |
