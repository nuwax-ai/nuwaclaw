# Agent Desktop 项目指南

本文档为 AI 助手提供项目的完整指南，包括架构、技术栈、开发规范和工作流程。

## 项目概述

agent-tauri-client 是一个基于 Tauri 2.0 的跨平台桌面客户端应用，使用 React 18 + TypeScript 构建前端，Rust 构建后端插件。支持系统权限管理、Agent 状态监控和日志查看等功能。

### 技术栈

- **前端框架**: React 18 + TypeScript + Vite
- **UI 组件库**: Ant Design 5
- **桌面框架**: Tauri 2.0
- **后端语言**: Rust
- **包管理器**: pnpm (前端) + cargo (Rust)

### 项目结构

```
agent-tauri-client/
├── src/                      # React 前端源码
│   ├── App.tsx              # 主应用组件，包含所有 Tab 页面
│   ├── main.tsx             # 应用入口
│   ├── App.css              # 样式文件
│   ├── assets/              # 静态资源
│   └── services/            # 服务层
│       ├── index.ts         # 服务导出入口
│       ├── mockService.ts   # Mock 数据服务（开发调试用）
│       ├── permissions.ts   # 权限管理服务
│       └── permissionsRust.ts  # Rust 后端权限桥接
├── src-tauri/               # Tauri/Rust 后端
│   ├── src/
│   │   ├── lib.rs          # Tauri 命令实现
│   │   └── main.rs         # 入口文件
│   ├── Cargo.toml          # Rust 依赖配置
│   ├── tauri.conf.json    # Tauri 配置
│   ├── build.rs           # 构建脚本
│   ├── capabilities/      # 权限配置
│   └── icons/             # 应用图标
├── package.json            # 前端依赖配置
├── vite.config.ts          # Vite 配置
└── tsconfig.json          # TypeScript 配置
```

---

## 开发环境配置

### 必需工具

```bash
# Rust (使用 rustup 安装)
rustup install stable
rustup default stable

# Node.js (推荐 v18+)
# 使用 nvm 管理版本

# pnpm
npm install -g pnpm

# Tauri CLI
pnpm add -g @tauri-apps/cli
```

### 开发命令

```bash
# 安装依赖
pnpm install

# 开发模式（前端 + Tauri）
pnpm tauri dev

# 或仅启动前端开发服务器
pnpm dev

# 构建前端
pnpm build

# 构建 Tauri 应用
pnpm tauri build
```

### 快速启动

```bash
# 启动完整开发环境
./run_ui.sh dev

# 仅前端
cd agent-tauri-client && pnpm dev
```

---

## 代码规范

### TypeScript/JavaScript 规范

遵循 Airbnb 规范：

- 使用 TypeScript 进行类型检查
- 使用函数式组件 + Hooks (React 18)
- 组件文件以 `.tsx` 结尾
- 工具函数以 `.ts` 结尾
- 使用 `const` 声明常量
- 异步操作使用 `async/await`

**代码示例：**

```typescript
import { useState, useEffect } from 'react';
import { Card, Button } from 'antd';
import { invoke } from '@tauri-apps/api/core';

interface AgentStatus {
  status: string;
  session_id?: string;
}

export default function AgentPanel() {
  const [loading, setLoading] = useState(false);

  const handleStart = async () => {
    try {
      setLoading(true);
      await invoke('start_agent');
    } finally {
      setLoading(false);
    }
  };

  return (
    <Card>
      <Button type="primary" onClick={handleStart} loading={loading}>
        启动 Agent
      </Button>
    </Card>
  );
}
```

### Rust 规范

遵循 [Rust API Guidelines](https://rust-lang.github.io/api-guidelines/)：

- 使用 `snake_case` for 函数和变量
- 使用 `CamelCase` for 类型和 trait
- 公有 API 必须添加文档注释
- 错误处理使用 `thiserror`

**代码示例：**

```rust
/// 检查权限状态
///
/// # 参数
/// * `permission` - 权限名称字符串
///
/// # 返回
/// 权限状态 DTO
#[tauri::command]
async fn check_permission(
    state: State<'_, PermissionsState>,
    permission: String,
) -> Result<PermissionStateDto, String> {
    // ...
}
```

---

## 主要功能模块

### 1. 权限管理

**前端服务**: `src/services/permissions.ts`

- `checkPermission(category)` - 检查单个权限状态
- `checkAllPermissions()` - 批量检查所有权限
- `openSystemSettings(category)` - 打开系统设置页面

**Rust 后端**: `src-tauri/src/lib.rs`

- `check_permission` - 检查权限状态
- `request_permission` - 请求权限
- `open_settings` - 打开系统设置
- `get_all_permissions` - 批量获取权限

**支持的权限类型**：

| ID | 显示名称 | 说明 | 支持平台 |
|----|----------|------|----------|
| accessibility | 辅助功能 | 键盘鼠标控制 | macOS/Windows/Linux |
| screen_recording | 屏幕录制 | 远程桌面画面 | macOS/Windows/Linux |
| microphone | 麦克风 | 语音/音频 | macOS/Windows/Linux |
| camera | 摄像头 | 视频 | macOS/Windows/Linux |
| location | 位置信息 | 定位 | macOS/Windows/Linux |
| notifications | 通知 | 系统通知 | macOS/Windows |
| file_access | 文件访问 | 文件传输 | macOS/Windows/Linux |
| network | 网络访问 | 网络通信 | macOS/Windows/Linux |
| nuwaxcode | NuwaxCode | 编辑器集成 | macOS/Windows/Linux |
| claude_code | Claude Code | 编辑器集成 | macOS/Windows/Linux |
| keyboard_monitoring | 键盘监控 | 全局快捷键 | macOS/Windows/Linux |

### 2. Agent 状态管理

**服务**: `src/services/mockService.ts`

- `getStatus()` - 获取 Agent 状态
- `startAgent()` - 启动 Agent
- `stopAgent()` - 停止 Agent
- `getLogs()` - 获取日志
- `getConnectionInfo()` - 获取连接信息

### 3. UI 组件

**主界面** (`src/App.tsx`):

- **Client Tab**: Agent 控制面板，启动/停止、日志查看
- **Settings Tab**: 服务器配置、开关设置
- **Dependencies Tab**: 依赖管理（Node.js、Python、NuwaxCode、Claude Code）
- **Permissions Tab**: 权限状态查看与管理
- **About Tab**: 应用信息
- **Debug Tab**: 调试信息

---

## API 端点

### Tauri 命令

| 命令 | 参数 | 返回 | 说明 |
|------|------|------|------|
| `check_permission` | permission: String | PermissionStateDto | 检查权限状态 |
| `request_permission` | permission: String, interactive: bool | RequestResultDto | 请求权限 |
| `open_settings` | permission: String | () | 打开系统设置 |
| `get_all_permissions` | - | PermissionStateDto[] | 批量获取权限 |
| `greet` | name: String | String | 欢迎测试命令 |

### 前端服务函数

| 函数 | 参数 | 返回 | 说明 |
|------|------|------|------|
| `getAgentStatus` | - | AgentStatus | 获取 Agent 状态 |
| `startAgent` | - | boolean | 启动 Agent |
| `stopAgent` | - | boolean | 停止 Agent |
| `getLogs` | - | LogEntry[] | 获取日志 |
| `getPermissions` | - | PermissionsState | 获取权限状态 |
| `refreshPermissions` | - | PermissionsState | 刷新权限状态 |
| `openSystemPreferences` | permissionId: string | boolean | 打开系统偏好设置 |

---

## 常见任务

### 添加新的 Tauri 命令

1. 在 `src-tauri/src/lib.rs` 中定义命令函数
2. 添加 `#[tauri::command]` 宏
3. 在 `invoke_handler` 中注册

```rust
#[tauri::command]
async fn my_command(state: State<'_, MyState>, param: String) -> Result<String, String> {
    // 命令逻辑
    Ok("result".to_string())
}

// 注册
.invoke_handler(tauri::generate_handler![my_command, ...])
```

### 添加新的前端组件

1. 在 `src/components/` 创建 `.tsx` 文件
2. 导出组件
3. 在 `App.tsx` 中使用

### 修改权限配置

1. **前端权限列表**: 修改 `src/services/permissions.ts` 中的 `PERMISSION_CONFIGS`
2. **权限检测逻辑**: 修改 `src/services/permissions.ts` 中的 `checkMacOSPermission` 等函数
3. **Rust 权限映射**: 修改 `src-tauri/src/lib.rs` 中的 `parse_permission` 函数

---

## 测试规范

### Rust 测试

```rust
#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn test_my_function() {
        // 测试逻辑
    }
}
```

### 前端测试

使用 React Testing Library：

```typescript
import { render, screen } from '@testing-library/react';
import MyComponent from './MyComponent';

test('renders component', () => {
  render(<MyComponent />);
  expect(screen.getByText('Content')).toBeInTheDocument();
});
```

---

## 调试技巧

### Tauri 日志

```bash
# 启用详细日志
TAURI_DEBUG=1 pnpm tauri dev
```

### 前端日志

前端使用 `console.log` 和 Ant Design `message` API 显示提示。

---

## 注意事项

1. **先输出方案**: 重大变更前先向用户展示方案，确认后再实施
2. **详细注释**: 代码中包含清晰的注释说明
3. **优先中文**: 界面文本使用中文
4. **错误处理**: 所有异步操作必须有错误处理
5. **类型安全**: 避免使用 `any`，使用明确的类型定义
6. **提交前检查**: 确保代码编译通过，无警告
7. **跨平台**: 注意 macOS/Windows/Linux 的差异处理
