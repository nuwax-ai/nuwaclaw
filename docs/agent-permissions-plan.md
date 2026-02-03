# nuwax-agent: agent-tauri-client 权限管理系统实施方案

> 创建日期：2026-02-03  
> 项目：nuwax-agent (Tauri + React + Ant Design)  
> 目标：多端客户端（Windows / macOS / Linux）系统权限授权管理

---

## 目录

- [1. 背景与目标](#1-背景与目标)
- [2. 现有方案调研](#2-现有方案调研)
- [3. 方案设计](#3-方案设计)
- [4. 实施计划](#4-实施计划)
- [5. 资源评估](#5-资源评估)
- [6. 风险与应对](#6-风险与应对)

---

## 1. 背景与目标

### 1.1 项目背景

agent-tauri-client 作为 nuwax-agent 的多端桌面客户端，需要支持 Windows / macOS / Linux 三个平台。系统需要处理以下类型的权限请求：

| 权限类型 | 说明 | 现有支持 |
|----------|------|----------|
| 屏幕截图 | 捕获屏幕内容用于 AI 分析 | ✅ system-permissions |
| 屏幕录制 | 录制屏幕视频 | ✅ system-permissions |
| 键盘输入 | 全局键盘监听和输入 | ✅ system-permissions |
| 鼠标输入 | 全局鼠标控制和监听 | ✅ system-permissions |
| 剪贴板 | 读写系统剪贴板 | ✅ system-permissions |
| 文件系统 | 读取/写入用户文件 | ✅ system-permissions |
| 网络请求 | 发起 HTTP 请求 | ✅ Tauri HTTP |
| 麦克风/相机 | 音视频捕获 | ✅ system-permissions |

### 1.2 现有基础设施

**nuwax-agent 已有组件：**

```
crates/system-permissions/          # ✅ 已实现跨平台权限库
├── src/
│   ├── lib.rs                     # 主入口
│   ├── types.rs                   # SystemPermission 枚举 (15+ 类型)
│   ├── permissions_trait.rs       # PermissionManager Trait
│   ├── factory.rs                 # create_permission_manager()
│   ├── macos/mod.rs               # TCC 实现
│   ├── windows/mod.rs             # UAC 实现
│   └── linux/mod.rs               # AT-SPI 实现
└── examples/
    ├── basic.rs
    └── monitoring.rs
```

### 1.3 项目目标

| 目标 | 描述 | 优先级 |
|------|------|--------|
| P0 | 复用 system-permissions，实现跨平台权限检查和请求 | 必须 |
| P0 | 权限状态持久化（用户偏好） | 必须 |
| P1 | 权限请求 UI 组件（React + Ant Design） | 必须 |
| P1 | 权限审计日志 | 应该 |
| P2 | 权限策略配置（操作级权限） | 可以 |

---

## 2. 现有方案调研

### 2.1 workspace 项目对比

| 项目 | 技术栈 | 权限方案 | 借鉴点 |
|------|--------|----------|--------|
| **nuwax-agent** | Rust + Tauri | `system-permissions` crate | ✅ **核心依赖** |
| **agent-desktop** | Rust + Tauri | `rustdesk-core/permission.rs` | 策略+审计模式 |
| **Agent-S** | Python | pyautogui/mss | 无显式权限管理 |
| **ScreenAgent** | Python + VNC | VNC 认证 | 远程桌面模式 |
| **Open-AutoGLM** | Python + ADB | USB 调试授权 | 移动端授权模式 |
| **UI-TARS-desktop** | Rust + Tauri | 多操作器 (ADB/AIO/Browser) | Tauri 集成参考 |

### 2.2 nuwax-agent system-permissions 详细分析

**支持权限矩阵：**

| 权限 | macOS (TCC) | Windows (UAC) | Linux (AT-SPI) |
|------|-------------|---------------|----------------|
| Accessibility | ✅ | ✅ (UAC) | ✅ |
| ScreenRecording | ✅ | ✅ (DXGI) | ✅ (PipeWire) |
| Microphone | ✅ | ✅ | ✅ |
| Camera | ✅ | ✅ | ✅ |
| Notifications | ✅ | ✅ | ❌ |
| SpeechRecognition | ✅ | ❌ | ❌ |
| Location | ✅ | ✅ | ✅ |
| AppleScript | ✅ | ❌ | ❌ |
| Clipboard | ✅ | ✅ | ✅ |
| KeyboardMonitoring | ✅ | ✅ | ✅ |
| FileSystem Read/Write | ✅ | ✅ | ✅ |
| Network | ✅ | ✅ | ✅ |
| NuwaxCode | ✅ | ✅ | ✅ |
| ClaudeCode | ✅ | ✅ | ✅ |

**核心 API：**

```rust
// 创建权限管理器（自动适配平台）
let manager = create_permission_manager();

// 检查权限状态
let state = manager.check(SystemPermission::Microphone).await;

// 请求权限
let result = manager.request(
    SystemPermission::Microphone,
    RequestOptions::interactive().with_reason("需要麦克风"),
).await;

// 批量检查
let result = manager.check_all(vec![
    SystemPermission::Microphone,
    SystemPermission::Camera,
]).await;
```

### 2.3 agent-desktop 权限策略模式（参考）

从 `rustdesk-core/src/permission.rs` 借鉴操作级权限管理：

```rust
// 操作级权限类型
pub enum Operation {
    FileRead, FileWrite, FileDelete, FileExecute,
    TerminalExecute, TerminalReadOutput,
    Screenshot, ScreenRecord,
    KeyboardInput, MouseInput,
    ClipboardRead, ClipboardWrite,
}

// 权限策略配置
pub struct PermissionPolicy {
    pub name: String,
    pub permissions: Vec<Permission>,
    pub default_policy: PolicyAction,  // Allow/Deny/Confirm
}
```

---

## 3. 方案设计

### 3.1 架构设计

```
nuwax-agent/
├── crates/
│   └── system-permissions/        # ✅ 现有，跨平台权限库
│       ├── src/
│       │   ├── types.rs           # SystemPermission 枚举
│       │   ├── permissions_trait.rs
│       │   ├── factory.rs
│       │   ├── macos/mod.rs
│       │   ├── windows/mod.rs
│       │   └── linux/mod.rs
│       └── examples/
├── apps/
│   └── agent-tauri-client/        # 多端客户端
│       ├── src/
│       │   ├── permissions/       # 新增：权限管理模块
│       │   │   ├── mod.rs
│       │   │   ├── manager.rs     # 权限管理器包装
│       │   │   ├── persistence.rs # 持久化存储
│       │   │   ├── audit.rs       # 审计日志
│       │   │   └── policy.rs      # 操作级策略
│       │   ├── components/
│       │   │   └── permissions/   # React 权限组件
│       │   │       ├── PermissionGuard.tsx
│       │   │       ├── PermissionRequest.tsx
│       │   │       ├── PermissionStatus.tsx
│       │   │       └── PermissionSettings.tsx
│       │   ├── hooks/
│       │   │   ├── usePermission.ts
│       │   │   └── usePermissions.ts
│       │   └── services/
│       │       └── permissionService.ts
│       └── src-tauri/
│           ├── capabilities/
│           │   └── default.json
│           └── tauri.conf.json
```

### 3.2 权限管理模块设计

```rust
// apps/agent-tauri-client/src/permissions/manager.rs

use system_permissions::{
    create_permission_manager,
    SystemPermission,
    PermissionManager,
    RequestOptions,
    PermissionState,
    CheckResult,
};

/// Agent 权限管理器
///
/// 封装 system-permissions，提供：
/// - 权限状态缓存
/// - 持久化存储
/// - 操作级权限策略
pub struct AgentPermissionManager {
    system_manager: Box<dyn PermissionManager>,
    storage: PermissionStorage,
    policy_engine: PolicyEngine,
}

impl AgentPermissionManager {
    /// 检查权限状态（带缓存）
    pub async fn check(&self, permission: SystemPermission) -> PermissionState {
        // 1. 检查缓存
        if let Some(cached) = self.storage.get_cached(permission) {
            if !cached.is_stale() {
                return cached;
            }
        }
        
        // 2. 查询系统权限
        let state = self.system_manager.check(permission).await;
        
        // 3. 更新缓存
        self.storage.set_cached(permission, &state);
        
        state
    }
    
    /// 批量检查权限
    pub async fn check_all(&self, permissions: Vec<SystemPermission>) -> CheckResult {
        self.system_manager.check_all(permissions).await
    }
    
    /// 请求权限（带策略检查）
    pub async fn request(
        &self,
        permission: SystemPermission,
        reason: Option<String>,
    ) -> RequestResult {
        // 1. 策略检查
        if let Some(deny_reason) = self.policy_engine.check_deny(permission).await {
            return RequestResult::denied(permission, deny_reason, None);
        }
        
        // 2. 检查是否需要确认
        if self.policy_engine.requires_confirmation(permission) {
            // 返回需要用户确认的状态
        }
        
        // 3. 请求系统权限
        self.system_manager
            .request(permission, RequestOptions::interactive().with_reason(reason))
            .await
    }
    
    /// 打开系统设置页面
    pub async fn open_settings(&self, permission: SystemPermission) {
        self.system_manager.open_settings(permission).await
    }
}
```

### 3.3 前端组件设计

```tsx
// apps/agent-tauri-client/src/components/permissions/PermissionGuard.tsx

import { useEffect, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { message } from 'antd';

interface PermissionState {
  permission: string;
  status: 'NotDetermined' | 'Authorized' | 'Denied' | 'Restricted' | 'Unavailable';
  granted: boolean;
  canRequest: boolean;
}

export function usePermission(permission: string) {
  const [state, setState] = useState<PermissionState | null>(null);
  const [loading, setLoading] = useState(true);
  
  const check = async () => {
    setLoading(true);
    try {
      const result = await invoke<PermissionState>('check_permission', { permission });
      setState(result);
    } catch (error) {
      message.error(`检查权限失败: ${error}`);
    } finally {
      setLoading(false);
    }
  };
  
  useEffect(() => {
    check();
  }, [permission]);
  
  const request = async (reason?: string) => {
    try {
      const result = await invoke('request_permission', { permission, reason });
      setState(result as PermissionState);
      return result;
    } catch (error) {
      message.error(`请求权限失败: ${error}`);
      throw error;
    }
  };
  
  return { state, loading, request, refresh: check };
}

// 权限守卫组件
export function PermissionGuard({ 
  permission, 
  children, 
  fallback,
  onDeny 
}: PermissionGuardProps) {
  const { state, loading, request } = usePermission(permission);
  
  if (loading) return <Spin tip="检查权限中..." />;
  
  if (!state?.granted) {
    return fallback || (
      <div className="permission-request-card">
        <Alert
          type="warning"
          message={`需要 ${permission} 权限`}
          description="请授予权限以继续使用此功能"
          action={
            <Button size="small" onClick={() => request()}>
              授予权限
            </Button>
          }
        />
      </div>
    );
  }
  
  return <>{children}</>;
}
```

### 3.4 Tauri 集成

```rust
// apps/agent-tauri-client/src-tauri/src/commands/permissions.rs

use crate::permissions::AgentPermissionManager;
use system_permissions::SystemPermission;

#[tauri::command]
pub async fn check_permission(
    permission: String,
    window: tauri::Window,
) -> Result<serde_json::Value, String> {
    let manager = window.state::<AgentPermissionManager>();
    let perm = parse_permission(&permission)?;
    let state = manager.check(perm).await;
    
    Ok(json!({
        "permission": permission,
        "status": format!("{:?}", state.status),
        "granted": state.is_authorized(),
        "canRequest": state.can_request,
    }))
}

#[tauri::command]
pub async fn request_permission(
    permission: String,
    reason: Option<String>,
    window: tauri::Window,
) -> Result<serde_json::Value, String> {
    let manager = window.state::<AgentPermissionManager>();
    let perm = parse_permission(&permission)?;
    let result = manager.request(perm, reason).await;
    
    Ok(json!({
        "permission": permission,
        "granted": result.granted,
        "status": format!("{:?}", result.status),
        "settingsGuide": result.settings_guide,
    }))
}

#[tauri::command]
pub async fn check_all_permissions(
    window: tauri::Window,
) -> Result<serde_json::Value, String> {
    let permissions = vec![
        SystemPermission::ScreenRecording,
        SystemPermission::Accessibility,
        SystemPermission::Microphone,
        SystemPermission::Camera,
        SystemPermission::Clipboard,
        SystemPermission::FileSystemRead,
        SystemPermission::FileSystemWrite,
    ];
    
    let manager = window.state::<AgentPermissionManager>();
    let result = manager.check_all(permissions).await;
    
    Ok(json!({
        "permissions": result.states.iter().map(|s| json!({
            "permission": s.permission.name(),
            "status": format!("{:?}", s.status),
            "granted": s.is_authorized(),
        })).collect::<Vec<_>>(),
        "summary": {
            "authorized": result.authorized_count,
            "missing": result.missing_count,
        }
    }))
}

fn parse_permission(s: &str) -> Result<SystemPermission, String> {
    match s.to_lowercase().as_str() {
        "screen-recording" | "screen" => Ok(SystemPermission::ScreenRecording),
        "accessibility" | "input" => Ok(SystemPermission::Accessibility),
        "microphone" | "mic" => Ok(SystemPermission::Microphone),
        "camera" => Ok(SystemPermission::Camera),
        "clipboard" => Ok(SystemPermission::Clipboard),
        "filesystem-read" | "fs-read" => Ok(SystemPermission::FileSystemRead),
        "filesystem-write" | "fs-write" => Ok(SystemPermission::FileSystemWrite),
        _ => Err(format!("Unknown permission: {}", s)),
    }
}
```

### 3.5 Tauri Capabilities 配置

```json
// apps/agent-tauri-client/src-tauri/capabilities/default.json
{
  "identifier": "default",
  "description": "Default permissions for agent-tauri-client",
  "permissions": [
    "core:default",
    "core:window:default",
    "core:app:default",
    {
      "identifier": "agent-permissions",
      "description": "Custom agent permissions",
      "permissions": [
        "core:default",
        "shell:allow-open",
        "fs:allow-read-file",
        "fs:allow-write-file",
        "fs:allow-read-dir",
        "http:default",
        "notification:default"
      ]
    }
  ]
}
```

---

## 4. 实施计划

### 4.1 分阶段实施

#### 阶段 1：基础集成（Week 1）

| 任务 | 内容 | 交付物 |
|------|------|---------|
| 1.1 | 集成 system-permissions 依赖 | Cargo.toml |
| 1.2 | 创建 AgentPermissionManager 包装器 | manager.rs |
| 1.3 | 实现权限状态持久化 | persistence.rs |
| 1.4 | 单元测试 | tests/unit/ |

**详细任务：**

```markdown
### 1.1 依赖配置
```toml
# apps/agent-tauri-client/Cargo.toml
[dependencies]
system-permissions = { path = "../../../crates/system-permissions" }
```

### 1.2 权限管理器包装器
- 封装 system_permissions::create_permission_manager
- 添加缓存层
- 实现状态持久化接口

### 1.3 持久化存储
- 使用 Tauri Store 插件
- 存储用户权限偏好
- 支持缓存过期机制
```

#### 阶段 2：Tauri 命令（Week 2）

| 任务 | 内容 | 交付物 |
|------|------|---------|
| 2.1 | 实现 check_permission 命令 | commands/permissions.rs |
| 2.2 | 实现 request_permission 命令 | commands/permissions.rs |
| 2.3 | 实现 check_all_permissions 命令 | commands/permissions.rs |
| 2.4 | 注册 Tauri State | main.rs |

#### 阶段 3：前端组件（Week 3）

| 任务 | 内容 | 交付物 |
|------|------|---------|
| 3.1 | usePermission Hook | hooks/usePermission.ts |
| 3.2 | PermissionGuard 组件 | components/PermissionGuard.tsx |
| 3.3 | PermissionRequest 组件 | components/PermissionRequest.tsx |
| 3.4 | PermissionSettings 页面 | pages/Settings/Permissions.tsx |

#### 阶段 4：高级功能（Week 4）

| 任务 | 内容 | 交付物 |
|------|------|---------|
| 4.1 | 审计日志 | audit.rs |
| 4.2 | 操作级策略引擎 | policy.rs |
| 4.3 | 权限使用统计 | statistics.rs |
| 4.4 | 集成测试 | tests/integration/ |

### 4.2 时间线

```
Week 1    Week 2    Week 3    Week 4
  ├──────────┬──────────┬──────────┤
  │基础集成   │Tauri命令  │前端组件   │高级功能  │
  └──────────┴──────────┴──────────┘
```

### 4.3 里程碑

| 里程碑 | 时间 | 验收标准 |
|--------|------|----------|
| M1: 基础集成完成 | Week 1 | system-permissions 集成，缓存工作 |
| M2: Tauri 命令完成 | Week 2 | 前后端通信正常 |
| M3: UI 组件完成 | Week 3 | 所有组件可用 |
| M4: 完整功能完成 | Week 4 | 策略+审计+测试 |

---

## 5. 资源评估

### 5.1 代码量预估

| 模块 | 文件数 | 代码行数 |
|------|--------|----------|
| Rust Core | 4 | 600+ |
| 前端组件 | 5 | 400+ |
| 测试 | 8 | 300+ |
| **总计** | **17** | **1300+** |

### 5.2 依赖项

```toml
# Cargo.toml 新增依赖
[dependencies]
system-permissions = { path = "../../../crates/system-permissions" }
tauri-plugin-store = "2"
serde_json = "1.0"

[target."cfg(target_os = "macos")".dependencies]
objc = "0.2.7"
cocoa = "0.24"
```

```json
// package.json 新增依赖
{
  "dependencies": {
    "@tauri-apps/api": "2",
    "antd": "^5.0.0"
  }
}
```

---

## 6. 风险与应对

| 风险 | 影响 | 可能性 | 应对措施 |
|------|------|--------|----------|
| 平台 API 变更 | 功能失效 | 中 | 抽象接口，隔离平台代码 |
| system-permissions 变更 | 兼容性 | 低 | 锁定版本，定期同步 |
| 权限政策变化 | 合规风险 | 低 | 灵活配置，策略可调 |
| 性能问题 | 用户体验 | 中 | 缓存优化，异步处理 |

---

## 附录

### A. 参考资料

- [nuwax-agent system-permissions](file:///Users/louis/workspace/nuwax-agent/crates/system-permissions)
- [agent-desktop permission.rs](file:///Users/louis/workspace/agent-desktop/libs/rustdesk-core/src/permission.rs)
- [Tauri Capabilities](https://v2.tauri.dev/security/permissions)

### B. 术语表

| 术语 | 说明 |
|------|------|
| TCC | Transparency, Consent, and Control (macOS 权限系统) |
| UAC | User Account Control (Windows 权限系统) |
| AT-SPI | Assistive Technology Service Provider Interface (Linux) |

---

*文档创建时间：2026-02-03*  
*版本：v1.0 (nuwax-agent specific)*
