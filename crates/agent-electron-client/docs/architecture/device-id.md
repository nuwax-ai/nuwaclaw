---
version: 1.1
last-updated: 2026-03-05
status: implemented
---

# Device ID 生成方案

## 概述

为 Electron 客户端生成稳定、安全的设备唯一标识符（deviceId），用于设备识别、授权绑定等场景。

---

## 方案

### 核心公式

```
deviceId = SHA-256(machineId + appSalt)
```

- `machineId`：操作系统级机器标识（通过 `node-machine-id` 获取原始值）
- `appSalt`：应用固定盐值，避免不同应用使用相同 machineId 产生碰撞

### 实现

```typescript
import { machineIdSync } from "node-machine-id";
import { createHash } from "crypto";
import * as os from "os";
import log from "electron-log";

const APP_SALT = "nuwax-agent";
let cachedDeviceId: string | null = null;

export function getDeviceId(): string {
  if (cachedDeviceId) return cachedDeviceId;

  let raw: string;
  try {
    raw = machineIdSync(true);
  } catch (e) {
    log.warn("[DeviceId] Failed to read machineId, using hostname fallback:", e);
    raw = os.hostname();
  }

  cachedDeviceId = createHash("sha256")
    .update(raw + APP_SALT)
    .digest("hex");

  log.info(`[DeviceId] ${cachedDeviceId}`);
  return cachedDeviceId;
}
```

### 各平台 machineId 数据源

| 平台 | 数据源 | 说明 |
|------|--------|------|
| **macOS** | `ioreg` → `IOPlatformUUID` | 硬件 UUID，无需管理员权限 |
| **Windows** | 注册表 `HKLM\SOFTWARE\Microsoft\Cryptography\MachineGuid` | 系统安装时生成 |
| **Linux** | `/var/lib/dbus/machine-id` | systemd 机器 ID |

### 依赖

| 包名 | 版本 | 说明 |
|------|------|------|
| `node-machine-id` | ^1.1.12 | 跨平台机器 ID 读取，零 native 依赖 |

`crypto` 为 Node.js 内置模块，无需额外安装。

---

## 设计要点

### 1. 稳定性

- 同一台机器每次调用返回相同值
- 进程内缓存，避免重复读取系统命令

### 2. 安全性

- SHA-256 单向 hash，不暴露原始 machineId
- 加入应用盐值，防止跨应用关联

### 3. 唯一性

- machineId 由操作系统保证唯一
- 加盐 hash 后不同应用产生不同 deviceId

### 4. 位置

- 实现在 **main process**（`src/main/services/` 下）
- renderer 通过 IPC + preload bridge 获取

---

## 架构集成

```
Main Process
├── src/main/services/system/deviceId.ts   # 实现 + 缓存 + 日志
├── src/main/services/system/index.ts      # re-export
├── src/main/main.ts                       # 启动时调用并输出日志
└── src/main/ipc/appHandlers.ts            # IPC handler

Preload
└── src/preload/index.ts                   # contextBridge 暴露

Renderer
└── window.electronAPI.app.getDeviceId()   # 调用
```

### IPC 通道

```typescript
// main (appHandlers.ts)
ipcMain.handle("app:getDeviceId", () => getDeviceId());

// preload (index.ts)
app: {
  getDeviceId: () => ipcRenderer.invoke("app:getDeviceId"),
}
```

---

## 特性对比（为何选此方案）

| 方案 | 稳定性 | 安全性 | 依赖 | 备注 |
|------|--------|--------|------|------|
| **hash(machineId + salt)** | 高 | 高 | 1 个 npm 包 | **选用** |
| 纯 machineId | 高 | 低（暴露原始值） | 1 个 npm 包 | 不推荐 |
| hw-fingerprint（硬件指纹） | 中（换硬件会变） | 高 | 重依赖 systeminformation | 过重 |
| 本地持久化 UUID | 低（删文件会变） | 中 | 无 | 不绑定设备 |
| hash(machineId + randomUUID) | 无（每次不同） | - | - | 错误方案 |

---

## 注意事项

1. **容器/镜像环境**：基于镜像的环境可能共享相同 machine-id，Linux 下可用 `dbus-uuidgen` 重新生成
2. **Windows 系统更新**：MachineGuid 在重大系统更新后极少数情况下可能变化
3. **macOS 权限**：IOPlatformUUID 无需额外权限，区别于 IOPlatformSerialNumber（新版 macOS 受限）

---

*参考: 此方案为 SaaS 客户端常用的设备标识模式*
