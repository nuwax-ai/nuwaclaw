# 应用自动更新

## 概述

基于 `electron-updater` 实现应用内自动更新，支持 macOS / Windows (NSIS) / Linux 自动下载安装，Windows MSI 安装引导到下载页（优先 OSS 安装包直链）。

**强制使用 latest.json**：应用与 Release 流程均以 OSS 上的 `latest.json` 为**唯一数据源**。版本检查、各平台下载地址、签名与大小均来自该文件；不直接依赖 GitHub Release 或 electron-builder 生成的 yml 作为来源。

**更新源（macOS / Linux 应用内升级）**：检查与下载均走阿里云 OSS。

- **检查更新**：**仅**拉取 OSS `latest/latest.json` 获取最新版本；其中 `platforms` 已包含各平台完整的 OSS 下载包地址（url、signature、size）。若有更新则将 electron-updater 的 feed 设为版本化 OSS 路径 `${OSS_BASE}/electron-v${version}`。
- **下载安装包**：安装包地址**仅**来自 `latest.json` 的 `platforms`（已是完整 OSS URL）。electron-updater 实际下载时从 feed 请求的 `latest-mac.yml` / `latest-linux.yml` 等，**必须**由同一份 `latest.json` 的 `platforms` 在 Release 流程中派生生成，不得使用 GitHub 自带的 yml。
- **回退**：仅当 OSS 不可达时，才回退为 GitHub（检查与下载均走 GitHub）。

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
| MSI (.msi) | 不支持 | 引导到下载页（OSS 安装包直链，来源为 latest.json） |
| macOS (.dmg) | 支持 | 下载 → 重启安装 |
| Linux (.AppImage/.deb) | 支持 | 下载 → 重启安装 |

## 跳过版本

- 用户在启动弹窗中选择"跳过此版本"后，版本号写入 `~/.nuwaclaw/.skipped-update-version`
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

## OSS 与 GitHub 分工（强制 latest.json）

所有更新元数据**强制以 latest.json 为准**：应用端只读 OSS `latest/latest.json` 做版本判断与地址解析；Release 流程只产出并上传由该文件派生的 yml，禁止使用或上传 GitHub 自带的 yml。

| 步骤         | 正常路径（强制 latest.json）     | 回退（OSS 不可达） |
|--------------|----------------------------------|--------------------|
| 检查更新     | 仅 OSS latest.json               | GitHub API         |
| Feed 基地址  | OSS 版本化路径                   | GitHub provider    |
| 下载安装包   | 仅 OSS（yml 必须由 latest.json 的 platforms 派生） | GitHub Release 资产 |

**数据源规则**：OSS 上**只**维护并信任 `latest.json`（含 version、notes、pub_date、platforms 多架构与完整 OSS 下载地址）。Release 流程（`.github/workflows/release-electron.yml`）**必须**根据该 `latest.json` 的 `platforms` 生成 electron-updater 所需的 `latest-mac.yml`、`latest-linux.yml`、`latest.yml`，并写入 release-assets 后一并上传；**禁止**使用或上传 GitHub 自带的 yml；yml 内下载地址为相对路径（相对 feed 基地址即 OSS 版本化路径）。

本地触发 OSS 同步时，可在本 crate 下执行 `scripts/sync-oss.sh <tag>`（如 `electron-v0.8.0`），会触发上述 workflow 并轮询直至完成；依赖 `gh`、`jq`。

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
| `app:openReleasesPage` | renderer → main | 打开下载页（Windows 优先从 latest.json 解析 OSS 安装包直链，否则 GitHub Releases） |
| `update:status` | main → renderer | 推送更新状态变化 |
