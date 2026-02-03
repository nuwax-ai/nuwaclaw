# agent-tauri-client 权限管理系统实施方案

> 创建日期：2026-02-03  
> 项目：多端客户端（Windows / macOS / Linux）系统权限授权管理

---

## 目录

- [1. 背景与目标](#1-背景与目标)
- [2. 方案概述](#2-方案概述)
- [3. 技术选型](#3-技术选型)
- [4. 架构设计](#4-架构设计)
- [5. 实施计划](#5-实施计划)
- [6. 资源评估](#6-资源评估)
- [7. 风险与应对](#7-风险与应对)

---

## 1. 背景与目标

### 1.1 项目背景

agent-tauri-client 需要作为多端桌面客户端，支持 Windows / macOS / Linux 三个平台。系统需要处理以下类型的权限请求：

| 权限类型 | 说明 | 平台差异 |
|----------|------|----------|
| 屏幕截图 | 捕获屏幕内容用于 AI 分析 | macOS TCC / Windows DXGI / Linux PipeWire |
| 屏幕录制 | 录制屏幕视频 | macOS TCC / Windows GDI / Linux PipeWire |
| 键盘输入 | 全局键盘监听和输入 | macOS Accessibility / Windows Hook / Linux X11 |
| 鼠标输入 | 全局鼠标控制和监听 | macOS Accessibility / Windows Input / Linux X11 |
| 剪贴板 | 读写系统剪贴板 | 各平台默认或需授权 |
| 文件系统 | 读取/写入用户文件 | 各平台沙盒/权限系统 |
| 网络请求 | 发起 HTTP 请求 | 各平台默认 |
| 进程管理 | 查看/终止进程 | 需管理员权限 |

### 1.2 项目目标

| 目标 | 描述 | 优先级 |
|------|------|--------|
| P0 | 跨平台权限检查和请求 | 必须 |
| P0 | 权限状态持久化 | 必须 |
| P1 | 权限请求 UI 组件 | 必须 |
| P1 | 权限审计日志 | 应该 |
| P2 | 权限策略配置 | 可以 |

---

## 2. 方案概述

### 2.1 技术架构

```
┌─────────────────────────────────────────────────────────────┐
│                    agent-tauri-client                       │
├─────────────────────────────────────────────────────────────┤
│  ┌─────────────────┐    ┌─────────────────┐               │
│  │   React UI      │    │  Permission     │               │
│  │   Components    │◄──►│  Service        │               │
│  └─────────────────┘    └────────┬────────┘               │
│                                  │                        │
│  ┌───────────────────────────────▼──────────────────────┐  │
│  │              Rust Core (Tauri)                     │  │
│  │  ┌─────────────┐  ┌─────────────────────────┐     │  │
│  │  │  System    │  │  Tauri Permissions   │     │  │
│  │  │  Perms     │  │  (capabilities)      │     │  │
│  │  └─────┬─────┘  └──────────┬──────────┘     │  │
│  │        │                    │                  │  │
│  │  ┌─────▼────────────┐     │                  │  │
│  │  │  Policy Engine   │     │                  │  │
│  │  │  (Operation)    │     │                  │  │
│  │  └─────────────────┘     │                  │  │
│  └───────────────────────────────────────────────┘  │
│                      │                              │
│         ┌────────────┼────────────┐                │
│         ▼            ▼            ▼                │
│  ┌───────────┐  ┌───────────┐  ┌───────────┐    │
│  │  macOS    │  │  Windows  │  │   Linux   │    │
│  │  (TCC)    │  │  (UAC)    │  │  (AT-SPI) │    │
│  └───────────┘  └───────────┘  └───────────┘    │
└─────────────────────────────────────────────────────────────┘
```

### 2.2 方案对比

| 方案 | 来源 | 优点 | 缺点 | 采用 |
|------|------|------|------|------|
| nuwax-agent system-permissions | 内置 | 跨平台完整、Trait 模式 | 新项目 | ✅ 采用 |
| agent-desktop permission.rs | 内置 | 策略+审计、细粒度 | 无平台特异 | ✅ 参考 |
| Tauri capabilities | 官方 | 官方集成 | 有限 | ✅ 采用 |
| 各项目现有方案 | 外部 | 简单 | 分散 | ❌ 不采用 |

---

## 3. 技术选型

### 3.1 权限库

```rust
// Cargo.toml 添加依赖
[dependencies]
# 现有项目中的系统权限库
system-permissions = { path = "../crates/system-permissions" }

# Tauri 官方权限
tauri = { workspace = true, features = ["shell-open"] }
tauri-plugin-shell = "2"
tauri-plugin-http = "2"
tauri-plugin-notification = "2"
tauri-plugin-clipboard = "2"

# 序列化
serde = { workspace = true }
serde_json = "1.0"

# 异步运行时
tokio = { workspace = true }
```

### 3.2 权限类型

```rust
// src/permissions/types.rs

/// 系统级权限类型
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum SystemPermission {
    Accessibility,
    ScreenRecording,
    Microphone,
    Camera,
    Notifications,
    Location,
    Clipboard,
    FileSystemRead,
    FileSystemWrite,
    KeyboardMonitoring,
    Network,
}

/// Agent 操作级权限
#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub enum OperationPermission {
    // 文件操作
    FileRead,
    FileWrite,
    FileDelete,
    FileExecute,
    
    // 系统操作
    TerminalExecute,
    SystemInfo,
    ProcessList,
    ProcessKill,
    
    // 网络操作
    NetworkScan,
    PortConnect,
    
    // UI 操作
    Screenshot,
    ScreenRecord,
    KeyboardInput,
    MouseInput,
    ClipboardRead,
    ClipboardWrite,
}

/// 权限状态
#[derive(Debug, Clone)]
pub struct PermissionState {
    pub permission: SystemPermission,
    pub status: PermissionStatus,
    pub granted_at: Option<chrono::DateTime<chrono::Utc>>,
    pub can_request: bool,
}

/// 权限请求结果
#[derive(Debug, Clone)]
pub struct PermissionRequest {
    pub permission: SystemPermission,
    pub granted: bool,
    pub status: PermissionStatus,
    pub settings_guide: Option<String>,
}
```

### 3.3 权限策略

```rust
// src/permissions/policy.rs

/// 权限策略配置
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PermissionPolicy {
    pub name: String,
    pub description: String,
    pub rules: Vec<PermissionRule>,
    pub default_action: PolicyAction,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum PolicyAction {
    Allow,
    Deny,
    Confirm,  // 需要用户确认
    Prompt,   // 每次提示
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PermissionRule {
    pub permission: String,
    pub action: PolicyAction,
    pub conditions: Vec<PermissionCondition>,
    pub require_audit: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum PermissionCondition {
    PathPrefix(Vec<String>),
    UserGroup(String),
    TimeRange { start: String, end: String },
    DomainWhitelist(Vec<String>),
}
```

---

## 4. 架构设计

### 4.1 目录结构

```
agent-tauri-client/
├── src/
│   ├── permissions/
│   │   ├── mod.rs                    # 模块入口
│   │   ├── lib.rs                    # 公共 API
│   │   ├── types.rs                  # 类型定义
│   │   ├── manager.rs                # 权限管理器
│   │   ├── policy.rs                 # 策略引擎
│   │   ├── audit.rs                  # 审计日志
│   │   ├── tauri_permissions/        # Tauri 权限集成
│   │   │   ├── mod.rs
│   │   │   └── capabilities.rs
│   │   ├── platform/                 # 平台特异实现
│   │   │   ├── macos/
│   │   │   ├── windows/
│   │   │   └── linux/
│   │   └── utils/
│   │       ├── mod.rs
│   │       └── dialog.rs
│   ├── components/
│   │   ├── permissions/
│   │   │   ├── PermissionGuard.tsx
│   │   │   ├── PermissionRequest.tsx
│   │   │   ├── PermissionStatus.tsx
│   │   │   ├── PermissionSettings.tsx
│   │   │   └── PermissionCard.tsx
│   │   ├── hooks/
│   │   │   ├── usePermission.ts
│   │   │   ├── usePermissions.ts
│   │   │   └── usePolicy.ts
│   │   └── services/
│   │       └── permissionService.ts
│   └── services/
│       └── permissionService.ts
├── src-tauri/
│   ├── capabilities/
│   │   ├── default.json
│   │   └── agent.json
│   ├── permissions/
│   │   ├── core.json
│   │   ├── fs.json
│   │   ├── shell.json
│   │   └── http.json
│   └──tauri.conf.json
└── tests/
    ├── unit/
    │   ├── types.test.ts
    │   ├── policy.test.ts
    │   └── manager.test.ts
    └── integration/
        └── permissions.test.ts
```

### 4.2 核心 API

```rust
// src/permissions/manager.rs

/// 权限管理器 trait
#[async_trait::async_trait]
pub trait PermissionManager {
    /// 检查权限状态
    async fn check(&self, permission: SystemPermission) -> PermissionState;
    
    /// 批量检查权限
    async fn check_all(&self, permissions: Vec<SystemPermission>) -> CheckResult;
    
    /// 请求权限
    async fn request(
        &self,
        permission: SystemPermission,
        options: RequestOptions,
    ) -> PermissionRequest;
    
    /// 打开系统设置页面
    async fn open_settings(&self, permission: SystemPermission) -> Result<(), String>;
    
    /// 获取权限设置引导
    fn get_settings_guide(&self, permission: SystemPermission) -> String;
}

/// 权限请求选项
#[derive(Debug, Clone)]
pub struct RequestOptions {
    pub interactive: bool,        // 是否显示系统对话框
    pub timeout_ms: u64,          // 超时时间
    pub reason: Option<String>,   // 理由（macOS）
    pub verbose_errors: bool,     // 详细错误
}

impl Default for RequestOptions {
    fn default() -> Self {
        Self {
            interactive: true,
            timeout_ms: 30_000,
            reason: None,
            verbose_errors: true,
        }
    }
}

impl RequestOptions {
    pub fn interactive() -> Self {
        Self { interactive: true, ..Default::default() }
    }
    
    pub fn non_interactive() -> Self {
        Self { interactive: false, ..Default::default() }
    }
    
    pub fn with_reason(mut self, reason: impl Into<String>) -> Self {
        self.reason = Some(reason.into());
        self
    }
    
    pub fn with_timeout(mut self, ms: u64) -> Self {
        self.timeout_ms = ms;
        self
    }
}
```

### 4.3 Tauri 集成

```rust
// src-tauri/src/commands/permissions.rs

use crate::permissions::{create_permission_manager, SystemPermission, PermissionManager};

#[tauri::command]
pub async fn check_permission(
    permission: String,
    window: tauri::Window,
) -> Result<serde_json::Value, String> {
    let manager = create_permission_manager();
    let perm = parse_permission(&permission)?;
    let state = manager.check(perm).await;
    
    Ok(json!({
        "permission": permission,
        "status": format!("{:?}", state.status),
        "granted": state.status.is_authorized(),
        "canRequest": state.can_request,
    }))
}

#[tauri::command]
pub async fn request_permission(
    permission: String,
    reason: Option<String>,
    window: tauri::Window,
) -> Result<serde_json::Value, String> {
    let manager = create_permission_manager();
    let perm = parse_permission(&permission)?;
    
    let options = RequestOptions::interactive()
        .with_reason(reason.unwrap_or_default());
    
    let result = manager.request(perm, options).await;
    
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
    
    let manager = create_permission_manager();
    let result = manager.check_all(permissions).await;
    
    Ok(json!({
        "states": result.states.iter().map(|s| json!({
            "permission": s.permission.name(),
            "status": format!("{:?}", s.status),
            "granted": s.is_authorized(),
        })).collect::<Vec<_>>(),
        "authorizedCount": result.authorized_count,
        "missingCount": result.missing_count,
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

### 4.4 前端集成

```tsx
// src/components/permissions/PermissionGuard.tsx

import { useEffect, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';

interface PermissionState {
  permission: string;
  status: string;
  granted: boolean;
  canRequest: boolean;
}

export function usePermission(permission: string) {
  const [state, setState] = useState<PermissionState | null>(null);
  const [loading, setLoading] = useState(true);
  
  useEffect(() => {
    checkPermission();
  }, [permission]);
  
  const checkPermission = async () => {
    setLoading(true);
    try {
      const result = await invoke<PermissionState>('check_permission', { permission });
      setState(result);
    } catch (error) {
      console.error('Failed to check permission:', error);
    } finally {
      setLoading(false);
    }
  };
  
  const requestPermission = async (reason?: string) => {
    try {
      const result = await invoke('request_permission', { permission, reason });
      setState(result as PermissionState);
      return result;
    } catch (error) {
      console.error('Failed to request permission:', error);
      throw error;
    }
  };
  
  return { state, loading, requestPermission, refresh: checkPermission };
}

interface PermissionGuardProps {
  permission: string;
  children: React.ReactNode;
  fallback?: React.ReactNode;
  onDeny?: () => void;
}

export function PermissionGuard({ 
  permission, 
  children, 
  fallback = null,
  onDeny 
}: PermissionGuardProps) {
  const { state, loading, requestPermission } = usePermission(permission);
  
  if (loading) return <div>Loading...</div>;
  
  if (!state?.granted) {
    return (
      fallback || (
        <div className="permission-request">
          <p>Permission required: {permission}</p>
          <button onClick={() => requestPermission()}>
            Grant Permission
          </button>
          {onDeny && <button onClick={onDeny}>Continue Anyway</button>}
        </div>
      )
    );
  }
  
  return <>{children}</>;
}

// 使用示例
<PermissionGuard permission="screen-recording">
  <ScreenCaptureComponent />
</PermissionGuard>
```

---

## 5. 实施计划

### 5.1 分阶段实施

#### 阶段 1：基础设施（Week 1）

| 任务 | 内容 | 交付物 |
|------|------|---------|
| 1.1 | 搭建权限模块目录结构 | 目录结构创建 |
| 1.2 | 定义权限类型枚举 | types.rs |
| 1.3 | 实现权限管理器 Trait | manager.rs |
| 1.4 | 集成 system-permissions | 依赖配置 |
| 1.5 | 单元测试 | tests/unit/ |

**详细任务：**

```markdown
### 1.1 目录结构创建
```
mkdir -p src/permissions/{platform/{macos,windows,linux},tauri_permissions}
mkdir -p src/components/permissions
mkdir -p src/hooks
mkdir -p tests/{unit,integration}
```

### 1.2 权限类型定义
- SystemPermission 枚举（15+ 类型）
- PermissionStatus 枚举
- RequestOptions 结构体
- RequestResult 结构体
- CheckResult 结构体

### 1.3 权限管理器 Trait
- check() 方法
- check_all() 方法
- request() 方法
- open_settings() 方法
- get_settings_guide() 方法

### 1.4 依赖配置
- 添加 system-permissions 依赖
- 添加 Tauri 权限插件依赖
- 配置 Cargo.toml

### 1.5 单元测试
- 类型测试
- Manager 测试
- Platform 测试（Mock）
```

#### 阶段 2：平台实现（Week 2）

| 任务 | 内容 | 交付物 |
|------|------|---------|
| 2.1 | macOS 权限实现 | platform/macos/mod.rs |
| 2.2 | Windows 权限实现 | platform/windows/mod.rs |
| 2.3 | Linux 权限实现 | platform/linux/mod.rs |
| 2.4 | 平台测试 | tests/integration/ |

**macOS 实现要点：**

```rust
// platform/macos/mod.rs

use objc::{msg_send, sel, sel_impl};
use cocoa::base::{id, nil, BOOL, YES, NO};
use core_foundation::string::CFString;

pub struct MacOSPermissionManager;

impl MacOSPermissionManager {
    pub fn new() -> Self {
        Self
    }
    
    /// 检查 Accessibility 权限
    fn check_accessibility(&self) -> PermissionStatus {
        // 使用 AXIsProcessTrustedWithOptions 检查
        let trusted: BOOL = unsafe {
            msg_send![class!(AXIsProcessTrustedWithOptions), nil]
        };
        
        if trusted == YES {
            PermissionStatus::Authorized
        } else {
            PermissionStatus::Denied
        }
    }
    
    /// 打开系统偏好设置
    fn open_accessibility_settings(&self) {
        // 打开 "System Preferences" -> "Security & Privacy" -> "Privacy" -> "Accessibility"
        let url = "x-apple.systempreferences:com.apple.Security_Privacy_Accessibility";
        // 使用 open 命令打开
    }
}
```

**Windows 实现要点：**

```rust
// platform/windows/mod.rs

use windows::Win32::System::Com::*;
use windows::Win32::UI::Shell::*;
use windows::Win32::Security::*;

pub struct WindowsPermissionManager;

impl WindowsPermissionManager {
    pub fn new() -> Self {
        Self
    }
    
    /// 检查辅助功能权限（模拟 UAC）
    fn check_accessibility(&self) -> PermissionStatus {
        // Windows 辅助功能通常通过 UAC 或管理员权限处理
        // 检查当前进程是否以管理员身份运行
        let is_admin = unsafe {
            let mut token: HANDLE = HANDLE::default();
            let mut elevation = TOKEN_ELEVATION_TYPE::default();
            let mut size = std::mem::size_of::<TOKEN_ELEVATION_TYPE>() as u32;
            
            OpenProcessToken(
                GetCurrentProcess(),
                TOKEN_QUERY,
                &mut token,
            );
            
            GetTokenInformation(
                token,
                TokenElevationType,
                Some(&mut elevation as *mut _ as *mut c_void),
                size,
                &mut size,
            )
        };
        
        if is_admin {
            PermissionStatus::Authorized
        } else {
            PermissionStatus::NotDetermined
        }
    }
}
```

**Linux 实现要点：**

```rust
// platform/linux/mod.rs

use std::process::Command;

pub struct LinuxPermissionManager;

impl LinuxPermissionManager {
    pub fn new() -> Self {
        Self
    }
    
    /// 检查 AT-SPI 辅助功能权限
    fn check_accessibility(&self) -> PermissionStatus {
        // 检查 dbus org.a11y.Bus 是否可用
        let output = Command::new("busctl")
            .args(&["call", "--system", "--type=method_call", "--dest=org.a11y.Bus", "/org/a11y/Bus", "org.a11y.Bus", "ListNames"])
            .output();
            
        match output {
            Ok(result) if result.status.success() => {
                PermissionStatus::Authorized
            }
            _ => PermissionStatus::NotDetermined,
        }
    }
}
```

#### 阶段 3：Tauri 集成（Week 3）

| 任务 | 内容 | 交付物 |
|------|------|---------|
| 3.1 | Tauri 命令实现 | commands/permissions.rs |
| 3.2 | capabilities 配置 | src-tauri/capabilities/ |
| 3.3 | 权限插件配置 | src-tauri/permissions/ |
| 3.4 | 前后端联调 | 端到端测试 |

**capabilities 配置：**

```json
// src-tauri/capabilities/default.json
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

#### 阶段 4：前端组件（Week 4）

| 任务 | 内容 | 交付物 |
|------|------|---------|
| 4.1 | PermissionGuard 组件 | components/PermissionGuard.tsx |
| 4.2 | PermissionRequest 组件 | components/PermissionRequest.tsx |
| 4.3 | PermissionSettings 组件 | components/PermissionSettings.tsx |
| 4.4 | Hooks 和 Service | hooks/usePermission.ts |
| 4.5 | 样式和主题 | permissions.css |

**UI 设计：**

```tsx
// PermissionSettings.tsx

import { usePermissions } from '../hooks/usePermissions';

export function PermissionSettings() {
  const { permissions, refresh, request } = usePermissions();
  
  return (
    <div className="permission-settings">
      <h2>权限设置</h2>
      
      <div className="permission-list">
        {permissions.map((perm) => (
          <PermissionCard
            key={perm.name}
            permission={perm}
            onRequest={() => request(perm.name)}
            onOpenSettings={() => openSystemSettings(perm.name)}
          />
        ))}
      </div>
      
      <button onClick={refresh}>刷新状态</button>
    </div>
  );
}

function PermissionCard({ permission, onRequest, onOpenSettings }) {
  const statusColors = {
    authorized: 'green',
    denied: 'red',
    not_determined: 'yellow',
    restricted: 'orange',
  };
  
  return (
    <div className="permission-card" data-status={statusColors[permission.status]}>
      <div className="permission-icon">{getIcon(permission.name)}</div>
      <div className="permission-info">
        <h3>{permission.name}</h3>
        <p>{permission.description}</p>
        <span className="status">{permission.status}</span>
      </div>
      <div className="permission-actions">
        {!permission.granted && (
          <button onClick={onRequest}>请求权限</button>
        )}
        {permission.status === 'denied' && (
          <button onClick={onOpenSettings}>打开设置</button>
        )}
      </div>
    </div>
  );
}
```

#### 阶段 5：策略和审计（Week 5）

| 任务 | 内容 | 交付物 |
|------|------|---------|
| 5.1 | 策略引擎实现 | policy.rs |
| 5.2 | 审计日志 | audit.rs |
| 5.3 | 持久化存储 | storage.rs |
| 5.4 | 策略配置 UI | settings 扩展 |

**策略引擎：**

```rust
// policy.rs

#[derive(Debug, Clone)]
pub struct PolicyEngine {
    policies: HashMap<String, PermissionPolicy>,
    current_policy: String,
    audit_log: Vec<AuditEntry>,
}

impl PolicyEngine {
    pub fn new() -> Self {
        let mut engine = Self {
            policies: HashMap::new(),
            current_policy: "default".to_string(),
            audit_log: Vec::new(),
        };
        
        // 加载默认策略
        engine.load_default_policy();
        engine
    }
    
    pub fn check(&mut self, permission: &str, context: &Context) -> CheckResult {
        let policy = match self.policies.get(&self.current_policy) {
            Some(p) => p,
            None => return CheckResult::denied("No policy found"),
        };
        
        // 查找匹配的规则
        for rule in &policy.rules {
            if rule.permission == permission {
                // 检查条件
                if self.check_conditions(&rule.conditions, context) {
                    // 记录审计日志
                    self.log_access(permission, context, &rule.action);
                    
                    return match rule.action {
                        PolicyAction::Allow => CheckResult::allowed(),
                        PolicyAction::Deny => CheckResult::denied("Denied by policy"),
                        PolicyAction::Confirm => CheckResult::confirmation_required(),
                        PolicyAction::Prompt => CheckResult::prompt_required(),
                    };
                }
            }
        }
        
        // 默认策略
        self.log_access(permission, context, &policy.default_action);
        match policy.default_action {
            PolicyAction::Allow => CheckResult::allowed(),
            _ => CheckResult::denied("Default policy"),
        }
    }
    
    fn check_conditions(&self, conditions: &[PermissionCondition], context: &Context) -> bool {
        conditions.iter().all(|c| match c {
            PermissionCondition::PathPrefix(prefixes) => {
                if let Some(path) = &context.path {
                    prefixes.iter().any(|p| path.starts_with(p))
                } else {
                    false
                }
            }
            PermissionCondition::UserGroup(group) => context.user_group == *group,
            PermissionCondition::TimeRange { start, end } => {
                // 检查当前时间是否在范围内
                let now = chrono::Local::now().format("%H:%M").to_string();
                now >= *start && now <= *end
            }
            _ => true,
        })
    }
}
```

#### 阶段 6：测试和优化（Week 6）

| 任务 | 内容 | 交付物 |
|------|------|---------|
| 6.1 | 单元测试补充 | coverage > 80% |
| 6.2 | 集成测试 | E2E 测试 |
| 6.3 | 性能优化 | benchmark |
| 6.4 | 文档编写 | README + API 文档 |

### 5.2 时间线

```
Week 1    Week 2    Week 3    Week 4    Week 5    Week 6
  ├──────────┬──────────┬──────────┬──────────┬──────────┤
  │基础设施   │平台实现   │Tauri集成  │前端组件   │策略审计   │测试优化  │
  └──────────┴──────────┴──────────┴──────────┴──────────┘
```

### 5.3 里程碑

| 里程碑 | 时间 | 验收标准 |
|--------|------|----------|
| M1: 基础架构完成 | Week 1 | 模块结构、类型定义、单元测试 |
| M2: 平台支持完成 | Week 2 | 三个平台权限检查和请求 |
| M3: Tauri 集成完成 | Week 3 | 前后端通信正常 |
| M4: UI 组件完成 | Week 4 | 所有组件可用 |
| M5: 完整功能完成 | Week 5 | 策略+审计+持久化 |
| M6: 发布准备完成 | Week 6 | 测试覆盖 > 80%，文档完整 |

---

## 6. 资源评估

### 6.1 代码量预估

| 模块 | 文件数 | 代码行数估计 |
|------|--------|--------------|
| Rust Core | 8 | 1500+ |
| 前端组件 | 6 | 800+ |
| 测试 | 15 | 600+ |
| 配置 | 5 | 300+ |
| **总计** | **34** | **3200+** |

### 6.2 依赖项

```toml
# Cargo.toml 新增依赖
[dependencies]
system-permissions = { path = "../crates/system-permissions" }
tokio = { workspace = true, features = ["full"] }
async-trait = "0.1"
serde = { workspace = true }
serde_json = "1.0"
thiserror = { workspace = true }
chrono = { workspace = true, optional = true }

[target."cfg(target_os = "macos")".dependencies]
objc = "0.2.7"
cocoa = "0.24"
core-foundation = "0.10"

[target."cfg(target_os = "windows")".dependencies]
windows = "0.57"
```

```json
// package.json 新增依赖
{
  "dependencies": {
    "zustand": "^4.5.0",
    "lucide-react": "^0.300.0"
  },
  "devDependencies": {
    "@testing-library/react": "^14.0.0",
    "msw": "^2.0.0"
  }
}
```

---

## 7. 风险与应对

| 风险 | 影响 | 可能性 | 应对措施 |
|------|------|--------|----------|
| 平台 API 变更 | 功能失效 | 中 | 抽象接口，隔离平台代码 |
| 权限政策变化 | 合规风险 | 低 | 持续监控，灵活配置 |
| 性能问题 | 用户体验 | 中 | 缓存优化，异步处理 |
| 测试覆盖不足 | 质量风险 | 中 | 自动化测试，CI 集成 |
| 依赖库变更 | 兼容性 | 低 | 锁定版本，定期更新 |

---

## 附录

### A. 参考资料

- [nuwax-agent system-permissions](file:///Users/louis/workspace/nuwax-agent/crates/system-permissions)
- [Tauri Permissions](https://v2.tauri.dev/security/permissions)
- [macOS TCC Documentation](https://developer.apple.com/documentation/technologies/tcc)
- [Windows UAC](https://learn.microsoft.com/windows/security/identity-protection/user-account-control)
- [Linux AT-SPI](https://developer.gnome.org/atspi/stable/)

### B. 术语表

| 术语 | 说明 |
|------|------|
| TCC | Transparency, Consent, and Control (macOS 权限系统) |
| UAC | User Account Control (Windows 权限系统) |
| AT-SPI | Assistive Technology Service Provider Interface (Linux 权限系统) |
| capability | Tauri 权限配置单元 |
| policy | 权限策略规则集合 |

---

*文档创建时间：2026-02-03*
*版本：v1.0*
