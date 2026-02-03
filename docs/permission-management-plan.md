# nuwax-agent Tauri 多端客户端权限管理实施计划

## 📋 概述

为 nuwax-agent 的 Tauri 多端客户端（Windows / Linux / macOS）实现统一的系统权限管理。

---

## 🎯 目标平台权限需求

### macOS
| 权限 | 用途 | 重要性 |
|------|------|--------|
| `ScreenRecording` | 屏幕截图 (pyautogui截图) | 🔴 必需 |
| `Accessibility` | 鼠标/键盘控制 | 🔴 必需 |
| `AppleEvents` | 跨应用自动化 | 🟡 可选 |

### Windows
| 权限 | 用途 | 重要性 |
|------|------|--------|
| `UAC` | 管理员操作 | 🔴 必需 |
| `Accessibility` | 鼠标/键盘模拟 | 🔴 必需 |
| `ScreenCapture` | 屏幕截图 | 🔴 必需 |

### Linux
| 权限 | 用途 | 重要性 |
|------|------|--------|
| `X11` | 屏幕截图/鼠标控制 | 🔴 必需 |
| `AT-SPI` | 无障碍支持 | 🟡 可选 |
| `polkit` | 系统操作 | 🟡 可选 |

---

## 📁 实施目录结构

```
crates/agent-tauri-client/
├── src/
│   ├── utils/
│   │   └── permissions.ts          # 权限管理模块
│   ├── services/
│   │   └── permission-service.ts   # 权限服务
│   └── components/
│       └── PermissionCheck.tsx     # 权限检查组件
├── src-tauri/
│   ├── src/
│   │   └── permissions.rs          # Rust 权限后端
│   ├── capabilities/
│   │   ├── default.json            # 默认权限
│   │   ├── macos.json              # macOS 权限
│   │   ├── windows.json            # Windows 权限
│   │   └── linux.json              # Linux 权限
│   └── tauri.conf.json             # Tauri 配置
└── docs/
    └── permission-guide.md         # 权限配置指南
```

---

## 🚀 实施阶段

### Phase 1: Tauri 权限配置 (Week 1)

#### 1.1 配置 capabilities

```json
// src-tauri/capabilities/macos.json
{
  "$schema": "../gen/schemas/desktop-schema.json",
  "identifier": "macos-default",
  "description": "macOS permissions",
  "windows": ["main"],
  "permissions": [
    "core:default",
    "core:window:default",
    "core:app:default",
    "shell:allow-open",
    {
      "identifier": "shell",
      "permissions": ["allow-open"]
    }
  ]
}
```

#### 1.2 添加 Tauri 插件依赖

```toml
# Cargo.toml
[dependencies]
tauri = { version = "2", features = ["shell-open"] }
tauri-plugin-shell = "2"
```

### Phase 2: Rust 后端实现 (Week 2)

#### 2.1 权限检查命令

```rust
// src-tauri/src/permissions.rs

#[tauri::command]
async fn check_screen_permission() -> bool {
    // macOS: 检查 ScreenRecording 权限
    #[cfg(target_os = "macos")]
    return check_macos_screen_permission();
    
    #[cfg(target_os = "windows")]
    return check_windows_screen_permission();
    
    #[cfg(target_os = "linux")]
    return check_linux_screen_permission();
}

#[tauri::command]
async fn request_screen_permission() -> Result<bool, String> {
    // 引导用户到系统设置
    #[cfg(target_os = "macos")]
    return request_macos_permission("ScreenRecording");
    
    // ...
}
```

### Phase 3: TypeScript 前端实现 (Week 3)

#### 3.1 权限管理模块

```typescript
// src/utils/permissions.ts

export interface Permission {
  id: string;
  name: string;
  description: string;
  platform: 'macos' | 'windows' | 'linux';
  required: boolean;
}

export const PERMISSIONS: Permission[] = [
  {
    id: 'screen-capture',
    name: 'Screen Capture',
    description: 'Required for taking screenshots',
    platform: 'all',
    required: true,
  },
  {
    id: 'accessibility',
    name: 'Accessibility',
    description: 'Required for mouse and keyboard control',
    platform: 'all',
    required: true,
  },
];

export async function checkPermissions(): Promise<Record<string, boolean>> {
  // 调用 Rust 后端检查权限状态
}

export async function requestPermissions(): Promise<void> {
  // 请求权限或引导用户到系统设置
}
```

#### 3.2 权限检查组件

```typescript
// src/components/PermissionCheck.tsx

import React from 'react';
import { Button, Alert, List } from 'antd';
import { usePermissions } from '../hooks/usePermissions';

export const PermissionCheck: React.FC = () => {
  const { permissions, checkPermissions, openSystemSettings } = usePermissions();

  const missingPermissions = Object.entries(permissions)
    .filter(([_, granted]) => !granted)
    .map(([id]) => PERMISSIONS.find(p => p.id === id))
    .filter(Boolean);

  if (missingPermissions.length === 0) {
    return null;
  }

  return (
    <Alert
      type="warning"
      message="Permissions Required"
      description={
        <>
          <p>The following permissions are required:</p>
          <List
            size="small"
            dataSource={missingPermissions}
            renderItem={p => <List.Item>{p?.name}: {p?.description}</List.Item>}
          />
          <Button type="primary" onClick={openSystemSettings}>
            Open System Settings
          </Button>
        </>
      }
    />
  );
};
```

### Phase 4: 集成测试 (Week 4)

#### 4.1 测试清单

```markdown
## 测试清单

### macOS
- [ ] ScreenRecording 权限检查
- [ ] Accessibility 权限检查
- [ ] 权限被拒绝时的引导
- [ ] 权限恢复后的状态更新

### Windows
- [ ] UAC 权限处理
- [ ] 辅助功能权限检查
- [ ] 屏幕截图权限

### Linux
- [ ] X11 权限检查
- [ ] polkit 权限处理
- [ ] 截图功能测试
```

---

## 📚 参考资料

### 已下载的开源项目

| 项目 | GitHub | 本地路径 | 参考内容 |
|------|--------|----------|----------|
| **untu-tip** | [TencentCloudADP/youtu-tip](https://github.com/TencentCloudADP/youtu-tip) | `../../youtu-tip/` | macOS 权限处理、pyautogui 截图 |
| **Agent-S** | [simular-ai/Agent-S](https://github.com/simular-ai/Agent-S) | `../../Agent-S/` | Windows 自动化 (WAA) |
| **Open-AutoGLM** | [zai-org/Open-AutoGLM](https://github.com/zai-org/Open-AutoGLM) | `../../Open-AutoGLM/` | iOS/Android 自动化 |
| **UI-TARS-desktop** | [bytedance/UI-TARS-desktop](https://github.com/bytedance/UI-TARS-desktop) | `../../UI-TARS-desktop/` | 浏览器截图工具 |
| **OpenClaw** | [openclaw/openclaw](https://github.com/openclaw/openclaw) | `../../openclaw-source/` | TCC 权限管理文档 |

### 关键代码文件

```bash
# unyou-tip 权限处理参考
youtu-tip/python/app/gui_agent/local_env.py

# OpenClaw TCC 权限文档
openclaw-source/docs/platforms/mac/permissions.md
openclaw-source/docs/platforms/windows.md
openclaw-source/docs/platforms/linux.md
```

---

## ✅ 验收标准

1. **macOS**: 启动时检查权限，未授权时显示清晰引导
2. **Windows**: UAC 弹窗处理，辅助功能权限检查
3. **Linux**: X11 权限处理，fallback 方案
4. **跨平台**: 统一的 API，平台特定实现
5. **文档**: 权限配置指南和故障排除

---

## 📝 待办事项

- [ ] 创建项目目录结构
- [ ] 实现 Rust 后端权限命令
- [ ] 实现 TypeScript 前端权限模块
- [ ] 创建权限检查 UI 组件
- [ ] 编写集成测试
- [ ] 编写文档
