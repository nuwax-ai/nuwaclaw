# Electron 客户端自动更新方案设计

## 1. 当前状态分析

### 1.1 项目结构
```
nuwax-agent/
├── crates/agent-electron-client/
│   ├── package.json          # v0.4.11
│   ├── electron-builder 配置 # 已存在
│   └── src/main/main.ts     # 主进程入口
├── .github/workflows/
│   ├── release-electron.yml  # 发布流程
│   └── ci-electron.yml      # CI 构建
```

### 1.2 当前发布流程
- 使用 GitHub Releases（tag: `electron-v*`）
- 构建产物：
  - macOS: dmg + zip
  - Windows: nsis + portable
  - Linux: AppImage + deb

### 1.3 现有配置（package.json build）
| 配置项 | 当前值 |
|--------|--------|
| appId | com.nuwax.agent |
| productName | Nuwax Agent |
| 签名配置 | 已存在（afterSign） |
| 更新服务器 | **未配置** |

---

## 2. 更新方案设计

### 2.1 核心原则
- **只检测**：启动时检查版本 + 用户手动检查
- **用户确认**：发现新版本后提示用户，由用户决定是否下载
- **手动下载**：用户确认后打开 GitHub Release 页面下载

### 2.2 对标 Tauri 客户端

参考 `agent-tauri-client` 的更新方案：

| 特性 | Tauri 客户端 | Electron 客户端 |
|------|-------------|----------------|
| 更新插件 | tauri_plugin_updater | autoUpdater |
| 主 endpoint | 阿里云 OSS | GitHub Releases |
| 备用 endpoint | GitHub Releases | 阿里云 OSS (可选) |
| 签名验证 | pubkey | 代码签名 |
| 检测触发 | 启动检查 + 手动 | 启动检查 + 手动 + 托盘 |

### 2.3 签名失效问题

**问题：**
- macOS 签名证书会过期（通常 1 年）
- 签名失效后，用户无法通过自动更新检测

**解决方案：**
1. **多 endpoint 降级**：GitHub Releases 作为备用
2. **检测失败不阻塞**：更新检测失败不影响应用正常使用
3. **手动下载兜底**：即使自动检测失败，用户仍可手动下载

### 2.4 推荐方案：update.electronjs.org + GitHub Releases

---

## 3. 实施计划

### 3.1 第一步：添加依赖

```bash
cd crates/agent-electron-client
npm install electron-updater
```

或使用内置模块：
```javascript
const { autoUpdater } = require('electron');
```

### 3.2 创建更新模块

**文件：`src/main/autoUpdate.ts`**

```typescript
import { autoUpdater } from 'electron';
import { app, dialog, shell } from 'electron';
import log from 'electron-log';

let mainWindow: Electron.BrowserWindow | null = null;

// 配置化的更新服务器 URL
const UPDATE_SERVERS = [
  'https://update.electronjs.org/nuwax-ai/nuwax-agent-client',  // 主：update.electronjs.org
  // TODO: 备用：阿里云 OSS（需要配置）
  // 'https://nuwa-packages.oss-rg-china-mainland.aliyuncs.com/electron-client/latest',
];

let currentServerIndex = 0;

/**
 * 获取当前更新服务器 URL
 */
function getUpdateServerUrl(): string {
  return UPDATE_SERVERS[currentServerIndex];
}

/**
 * 切换到备用服务器（签名失效时降级）
 */
function tryFallbackServer(): boolean {
  if (currentServerIndex < UPDATE_SERVERS.length - 1) {
    currentServerIndex++;
    log.warn(`[AutoUpdate] 切换到备用服务器: ${getUpdateServerUrl()}`);
    return true;
  }
  return false;
}

export interface UpdateInfo {
  version: string;
  releaseDate: string;
  releaseNotes?: string;
}

/**
 * 初始化自动更新（启动时检查）
 */
export function initAutoUpdater(window: Electron.BrowserWindow) {
  mainWindow = window;

  // 只在打包后启用
  if (!app.isPackaged) {
    log.info('[AutoUpdate] 跳过更新检查（开发环境）');
    return;
  }

  // 设置更新服务器
  autoUpdater.setFeedURL({
    url: getUpdateServerUrl()
  });

  // 绑定事件
  autoUpdater.on('checking-for-update', () => {
    log.info('[AutoUpdate] 检查更新中...');
    mainWindow?.webContents.send('update-checking');
  });

  autoUpdater.on('update-available', (info) => {
    log.info('[AutoUpdate] 发现新版本:', info.version);
    currentServerIndex = 0; // 成功后重置
    mainWindow?.webContents.send('update-available', {
      version: info.version,
      releaseDate: info.releaseDate,
    });
  });

  autoUpdater.on('update-not-available', () => {
    log.info('[AutoUpdate] 已是最新版本');
    currentServerIndex = 0;
    mainWindow?.webContents.send('update-not-available');
  });

  autoUpdater.on('error', (err) => {
    log.error('[AutoUpdate] 错误:', err.message);

    // 签名失效时尝试备用服务器
    const isSignatureError = err.message.includes('signature') 
      || err.message.includes('certificate')
      || err.message.includes(' notarization');

    if (isSignatureError && tryFallbackServer()) {
      log.warn('[AutoUpdate] 签名失效，尝试备用服务器');
      setTimeout(() => autoUpdater.checkForUpdates(), 1000);
    } else {
      mainWindow?.webContents.send('update-error', err.message);
    }
  });

  // 延迟检查，避免阻塞应用启动
  setTimeout(() => {
    autoUpdater.checkForUpdates();
  }, 5000); // 5 秒延迟
}

/**
 * 手动检查更新（供 IPC 调用）
 */
export async function checkForUpdates(): Promise<UpdateInfo | null> {
  if (!app.isPackaged) {
    return null;
  }

  try {
    const result = await autoUpdater.checkForUpdates();
    return result?.updateInfo ? {
      version: result.updateInfo.version,
      releaseDate: result.updateInfo.releaseDate,
    } : null;
  } catch (error: any) {
    log.error('[AutoUpdate] 检查失败:', error.message);
    return null;
  }
}

/**
 * 提示用户下载新版本
 * 用户确认后打开 GitHub Release 页面
 */
export function promptUserToDownload(version: string) {
  dialog.showMessageBox({
    type: 'info',
    title: '发现新版本',
    message: `新版本 ${version} 已发布`,
    detail: '是否前往 GitHub 下载最新版本？',
    buttons: ['前往下载', '稍后']
  }).then((result) => {
    if (result.response === 0) {
      // 打开 GitHub Release 页面
      shell.openExternal(
        'https://github.com/nuwax-ai/nuwax-agent-client/releases'
      );
    }
  });
}

/**
 * 获取当前版本
 */
export function getCurrentVersion(): string {
  return app.getVersion();
}
```

### 3.3 集成到 main.ts

**修改：`src/main/main.ts`**

```typescript
import { initAutoUpdater, checkForUpdates, promptUserToDownload } from './autoUpdate';
import { ipcMain } from 'electron';

// 在 app.whenReady() 中添加
app.whenReady().then(async () => {
  // ... 现有初始化代码 ...

  // 初始化自动更新（启动时检查）
  initAutoUpdater(mainWindow);

  // 注册 IPC 处理器
  ipcMain.handle('check-for-updates', async () => {
    return await checkForUpdates();
  });

  ipcMain.handle('download-update', (_event, version: string) => {
    promptUserToDownload(version);
  });
});
```

### 3.4 添加前端 UI

**文件：`src/renderer/hooks/useAutoUpdate.ts`**

```tsx
import { useEffect, useState } from 'react';
import { Modal } from 'antd';

export function useAutoUpdate() {
  const [checking, setChecking] = useState(false);
  const [updateInfo, setUpdateInfo] = useState<{ version: string } | null>(null);

  useEffect(() => {
    // 监听主进程事件
    window.electron.on('update-checking', () => {
      setChecking(true);
    });

    window.electron.on('update-available', (info: { version: string }) => {
      setChecking(false);
      setUpdateInfo(info);
      // 弹窗提示
      Modal.info({
        title: '发现新版本',
        content: `版本 ${info.version} 已发布，是否前往下载？`,
        okText: '前往下载',
        cancelText: '稍后',
        onOk: () => {
          window.electron.invoke('download-update', info.version);
        },
      });
    });

    window.electron.on('update-not-available', () => {
      setChecking(false);
    });

    window.electron.on('update-error', () => {
      setChecking(false);
    });
  }, []);

  const check = async () => {
    setChecking(true);
    await window.electron.invoke('check-for-updates');
  };

  return { checking, updateInfo, check };
}
```

### 3.5 添加托盘菜单更新入口

**修改：`src/main/trayManager.ts`**

```typescript
// 添加托盘菜单项
{
  label: '检查更新',
  click: async () => {
    const result = await checkForUpdates();
    if (result) {
      promptUserToDownload(result.version);
    } else {
      dialog.showMessageBox({
        type: 'info',
        title: '检查更新',
        message: '已是最新版本',
      });
    }
  },
}
```

### 3.6 electron-builder 配置

**修改：`package.json`**

```json
{
  "build": {
    "publish": [
      {
        "provider": "github",
        "owner": "nuwax-ai",
        "repo": "nuwax-agent-client"
      }
    ]
  }
}
```

### 3.7 与 Tauri 客户端对齐

参考 `agent-tauri-client` 的配置，可选添加签名验证：

| 项目 | Tauri | Electron |
|------|-------|----------|
| 签名验证 | pubkey | 代码签名 |
| 备用 endpoint | GitHub Releases | 阿里云 OSS (可选) |
| 插件 | tauri_plugin_updater | autoUpdater |

**可选：添加阿里云 OSS 作为备用**
```json
{
  "publish": [
    {
      "provider": "generic",
      "url": "https://nuwa-packages.oss-rg-china-mainland.aliyuncs.com/electron-client/"
    }
  ]
}
```

---

## 4. GitHub Actions 发布流程

### 4.1 发布命令

```bash
# 推送 tag 触发发布
git tag electron-v0.4.12
git push origin electron-v0.4.12
```

### 4.2 现有流程（无需修改）

当前 `release-electron.yml` 已创建 GitHub Release，
autoUpdater 会自动从 GitHub Releases 获取更新信息。

---

## 5. 代码签名要求

### 5.1 macOS

| 状态 | 影响 |
|------|------|
| 未签名 | 用户需右键打开，无法自动检测更新 |
| 已签名未公证 | Gatekeeper 可能拦截 |
| 已签名已公证 | ✅ 完全正常 |

**配置 Secrets：**
- `APPLE_CERTIFICATE` - .p12 证书
- `APPLE_CERTIFICATE_PASSWORD` - 证书密码
- `APPLE_API_KEY` - .p8 密钥
- `APPLE_API_KEY_ID` - 密钥 ID
- `APPLE_API_ISSUER` - Issuer ID

### 5.2 Windows

| 状态 | 影响 |
|------|------|
| 未签名 | SmartScreen 警告 |
| OV 签名 | SmartScreen 警告 |
| EV 签名 | ✅ 正常 |

---

## 6. 实现检查清单

- [ ] 创建 `src/main/autoUpdate.ts` 模块
  - [ ] 支持多服务器降级
  - [ ] 签名失效检测与降级
  - [ ] 启动延迟检查（5秒）
- [ ] 在 main.ts 中初始化
- [ ] 添加 IPC 处理器
- [ ] 添加托盘菜单更新入口
- [ ] 添加前端 useAutoUpdate hook
- [ ] 配置 `package.json publish`
- [ ] 配置 macOS 签名 Secrets（或接受备用方案）
- [ ] 测试发布流程
- [ ] 测试签名失效降级

---

## 7. 预计工作量

| 任务 | 预估时间 |
|------|----------|
| 创建 autoUpdate.ts | 1h |
| 集成到 main.ts | 0.5h |
| 托盘菜单入口 | 0.5h |
| 前端 UI | 1h |
| 配置发布流程 | 0.5h |
| 测试 | 1h |
| **总计** | **~5h** |

---

## 8. 风险与注意事项

### 8.1 签名失效问题

| 风险 | 影响 | 解决方案 |
|------|------|----------|
| macOS 签名过期 | 无法检测更新 | 备用服务器 + 手动下载 |
| Windows 签名过期 | SmartScreen 警告 | EV 证书或 Azure Trusted Signing |
| 签名错误 | 更新检测失败 | 降级到 GitHub Releases |

**签名失效时的用户体验：**
```
1. 自动检测失败 → 记录日志
2. 尝试备用服务器 → 成功则提示用户
3. 备用也失败 → 静默失败（不影响使用）
4. 用户可手动点击"检查更新"重试
```

### 8.2 其他注意事项

1. **测试环境**：确保在打包后环境测试，不要在开发环境测试
2. **用户流程**：检测到新版本 → 弹窗提示 → 用户点击"前往下载" → 打开 GitHub 页面
3. **启动延迟**：更新检测延迟 5 秒，避免阻塞应用启动
4. **静默失败**：更新检测失败不弹窗，不影响用户体验

---

## 9. 参考文档

- [Electron Auto-Updater](https://www.electronjs.org/docs/latest/api/auto-updater)
- [Updating Applications](https://www.electronjs.org/docs/latest/tutorial/updates)
- [electron-builder Publish](https://www.electron.build/configuration/publish)

---

*方案设计：2026-02-27*
