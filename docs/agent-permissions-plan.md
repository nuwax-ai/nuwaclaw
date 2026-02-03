# nuwax-agent: agent-tauri-client 权限管理系统实施方案

> 创建日期：2026-02-03  
> 最后更新：2026-02-04  
> 项目：nuwax-agent (Tauri + React + Ant Design)  
> 目标：基于现有实现，补充 UI、持久化、策略功能

---

## 目录

- [1. 当前实现分析](#1-当前实现分析)
- [2. 架构设计](#2-架构设计)
- [3. 实施计划](#3-实施计划)
- [4. 资源评估](#4-资源评估)
- [5. 风险与应对](#5-风险与应对)
- [附录A：macOS 权限请求方式](#附录a-macos-权限请求方式)
- [附录B：UI 组件设计](#附录b-ui-组件设计)
- [附录C：文件索引](#附录c-文件索引)

---

## 1. 当前实现分析

### 1.1 已完成功能 ✅

#### Rust 后端 (`src-tauri/src/lib.rs`)

| 命令/结构 | 功能 | 行数 |
|-----------|------|------|
| `PermissionsState` | 延迟初始化管理器 | ✅ |
| `MonitorState` | 权限监控状态 | ✅ |
| `check_permission` | 检查单个权限 | ✅ |
| `request_permission` | 请求权限（交互式） | ✅ |
| `open_settings` | 打开系统设置 | ✅ |
| `get_all_permissions` | 批量获取所有权限 | ✅ |
| `start_permission_monitor` | 启动权限变化监控 | ✅ |
| `stop_permission_monitor` | 停止监控 | ✅ |
| `PermissionChangeEvent` | 权限变化事件 DTO | ✅ |

**代码示例（现有）：**

```rust
// 延迟初始化避免启动崩溃
struct PermissionsState {
    manager: Mutex<Option<Arc<dyn system_permissions::PermissionManager + Send + Sync>>>,
}

impl PermissionsState {
    async fn get_manager(&self) -> Arc<dyn system_permissions::PermissionManager + Send + Sync> {
        let mut guard = self.manager.lock().await;
        if guard.is_none() {
            *guard = Some(create_permission_manager());
        }
        guard.as_ref().unwrap().clone()
    }
}
```

#### 前端 Rust 桥接 (`src/services/permissionsRust.ts`)

| 函数 | 功能 | 行数 |
|------|------|------|
| `checkPermission` | 调用 Rust 检查权限 | ✅ 35行 |
| `checkAllPermissions` | 批量检查 | ✅ 20行 |
| `requestPermission` | 请求权限 | ✅ 40行 |
| `openSystemSettings` | 打开系统设置 | ✅ 25行 |
| `startPermissionMonitor` | 启动监控 | ✅ 15行 |
| `stopPermissionMonitor` | 停止监控 | ✅ 10行 |
| `onPermissionChange` | 监听权限变化 | ✅ 20行 |
| `PERMISSION_MAPPING` | 权限名称映射 | ✅ 15行 |
| `SETTINGS_URLS` | 系统设置 URL 映射 | ✅ 15行 |

#### 前端服务层 (`src/services/permissions.ts`)

| 功能 | 说明 | 行数 |
|------|------|------|
| `PermissionsService` | 权限服务单例 | ✅ 300+行 |
| 缓存机制 | 5秒缓存过期 | ✅ |
| fallback 机制 | Rust 不可用时本地检测 | ✅ |
| 平台检测 | macOS/Windows/Linux | ✅ |
| 权限配置 | 14 种权限定义 | ✅ |
| 监控集成 | Tauri 事件订阅 | ✅ |

**现有权限配置（`permissions.ts`）：**

```typescript
const PERMISSION_CONFIGS: Record<PermissionCategory, Omit<PermissionItem, 'status'>> = {
  accessibility: {
    id: 'accessibility',
    displayName: '辅助功能',
    description: '用于远程控制时模拟键盘鼠标输入',
    required: true,
    platform: ['macos', 'windows', 'linux'],
  },
  screen_recording: {
    id: 'screen_recording',
    displayName: '屏幕录制',
    description: '用于远程桌面实时画面传输',
    required: true,
    platform: ['macos', 'windows', 'linux'],
  },
  // ... 14 种权限
};
```

### 1.2 现有代码结构

```
crates/agent-tauri-client/
├── src-tauri/src/lib.rs              # ✅ Rust 后端 (450行)
│   ├── PermissionsState              # 延迟初始化
│   ├── MonitorState                  # 监控状态
│   ├── PermissionStateDto            # IPC 序列化
│   ├── RequestResultDto              # IPC 序列化
│   ├── check_permission              # 命令
│   ├── request_permission            # 命令
│   ├── open_settings                 # 命令
│   ├── get_all_permissions           # 命令
│   ├── start_permission_monitor      # 命令
│   ├── stop_permission_monitor       # 命令
│   └── greet                         # 示例命令
│
├── src/services/
│   ├── permissionsRust.ts            # ✅ Rust 桥接 (200行)
│   │   ├── PERMISSION_MAPPING        # 权限映射
│   │   ├── SETTINGS_URLS             # 设置 URL
│   │   ├── checkPermission()         # 调用 Rust
│   │   ├── requestPermission()       # 调用 Rust
│   │   ├── openSystemSettings()      # 调用 Rust
│   │   ├── startPermissionMonitor()  # 调用 Rust
│   │   └── onPermissionChange()      # 事件监听
│   │
│   └── permissions.ts                # ✅ 前端服务 (400行)
│       ├── PermissionsService        # 服务单例
│       ├── PERMISSION_CONFIGS        # 权限配置
│       ├── checkPermission()         # 带缓存
│       ├── checkAllPermissions()     # 批量检查
│       ├── openSystemSettings()      # 打开设置
│       ├── startMonitoring()         # 启动监控
│       └── onPermissionChange()      # 订阅变化
│
└── src/App.tsx                       # 集成权限检查
```

### 1.3 待补充功能 ⚠️

| 功能 | 优先级 | 位置 | 说明 |
|------|--------|------|------|
| **UI 组件** | P0 | `src/components/permissions/` | PermissionGuard, Request, StatusCard |
| **权限设置页** | P1 | `src/pages/Settings/` | 完整设置页面 |
| **持久化** | P1 | `src-tauri/src/persistence.rs` | 缓存 + 用户偏好 |
| **策略引擎** | P2 | `src-tauri/src/policy.rs` | 操作级权限控制 |
| **审计日志** | P2 | `src-tauri/src/audit.rs` | 操作记录 |

---

## 2. 架构设计

### 2.1 整体架构（基于现有实现）

```
┌─────────────────────────────────────────────────────────────────┐
│                    agent-tauri-client                           │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │  UI 层 (待开发)                                         │   │
│  │  ┌──────────────┐ ┌──────────────┐ ┌──────────────┐   │   │
│  │  │PermissionGuard│ │PermissionRequest│ │SettingsPage│   │   │
│  │  └──────┬───────┘ └──────┬───────┘ └──────┬───────┘   │   │
│  └─────────┼────────────────┼────────────────┼───────────┘   │
│            │                │                │                │
│  ┌─────────┼────────────────┼────────────────┼───────────┐   │
│  │  Hooks  │                │                │           │   │
│  │  usePermission.ts        │                │           │   │
│  │  usePermissionRequest.ts │                │           │   │
│  └─────────┼────────────────┼────────────────┼───────────┘   │
│            │                │                │                │
│  ┌─────────▼────────────────▼────────────────▼───────────┐   │
│  │  Services 层 (现有代码，无需大改)                       │   │
│  │  ┌────────────────────────────────────────────────┐   │   │
│  │  │  permissions.ts (现有 400行)                    │   │   │
│  │  │  - PermissionsService 单例                      │   │   │
│  │  │  - 缓存机制 (5秒过期)                           │   │   │
│  │  │  - fallback 本地检测                            │   │   │
│  │  └────────────────────────────────────────────────┘   │   │
│  │  ┌────────────────────────────────────────────────┐   │   │
│  │  │  permissionsRust.ts (现有 200行)                │   │   │
│  │  │  - Rust 桥接函数                                │   │   │
│  │  │  - PERMISSION_MAPPING                          │   │   │
│  │  │  - Tauri 事件监听                               │   │   │
│  │  └────────────────────────────────────────────────┘   │   │
│  └────────────────────────────────────────────────────────┘   │
│                          │                                    │
│  ┌──────────────────────────────────────────────────────────┐ │
│  │  Rust 后端 (现有 450行，无需大改)                        │ │
│  │  ┌────────────────────────────────────────────────────┐ │ │
│  │  │  lib.rs                                            │ │ │
│  │  │  - 8 个 Tauri 命令 (check/request/open/monitor)   │ │ │
│  │  │  - PermissionsState (延迟初始化)                   │ │ │
│  │  │  - MonitorState (监控状态)                         │ │ │
│  │  └────────────────────────────────────────────────────┘ │ │
│  │  ┌────────────────────────────────────────────────────┐ │ │
│  │  │  persistence.rs (新增)                             │ │ │
│  │  │  - PermissionStorage                              │ │ │
│  │  │  - 用户偏好持久化                                 │ │ │
│  │  └────────────────────────────────────────────────────┘ │ │
│  │  ┌────────────────────────────────────────────────────┐ │ │
│  │  │  policy.rs (新增)                                 │ │ │
│  │  │  - PolicyEngine                                   │ │ │
│  │  │  - PermissionPolicy                               │ │ │
│  │  └────────────────────────────────────────────────────┘ │ │
│  │  ┌────────────────────────────────────────────────────┐ │ │
│  │  │  audit.rs (新增)                                  │ │ │
│  │  │  - AuditLogger                                    │ │ │
│  │  │  - 权限操作记录                                   │ │ │
│  │  └────────────────────────────────────────────────────┘ │ │
│  └──────────────────────────────────────────────────────────┘ │
│                          │                                    │
│         ┌────────────────┼────────────────┐                   │
│         ▼                ▼                ▼                   │
│  ┌───────────┐    ┌───────────┐    ┌───────────┐           │
│  │  macOS    │    │  Windows  │    │   Linux   │           │
│  │  (TCC)    │    │  (UAC)    │    │  (AT-SPI) │           │
│  └───────────┘    └───────────┘    └───────────┘           │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

### 2.2 新增文件设计

#### 2.2.1 Rust 后端新增

**persistence.rs (新增)**

```rust
// src-tauri/src/persistence.rs
use tauri_plugin_store::Store;
use std::sync::Mutex;

pub struct PermissionStorage {
    store: Mutex<Store>,
}

impl PermissionStorage {
    pub fn new(store: Store) -> Self { /* ... */ }
    pub fn get_cached(&self, permission: &str) -> Option<CachedState> { /* ... */ }
    pub fn set_cached(&self, permission: &str, state: &PermissionState) { /* ... */ }
    pub fn get_user_preference(&self, permission: &str) -> Option<Preference> { /* ... */ }
    pub fn set_user_preference(&self, permission: &str, pref: Preference) { /* ... */ }
}
```

**policy.rs (新增)**

```rust
// src-tauri/src/policy.rs
pub struct PolicyEngine {
    policies: Vec<PermissionPolicy>,
    current_policy: String,
}

impl PolicyEngine {
    pub fn check(&self, permission: SystemPermission) -> PolicyResult { /* ... */ }
    pub fn set_policy(&mut self, name: String) { /* ... */ }
}
```

**audit.rs (新增)**

```rust
// src-tauri/src/audit.rs
pub struct AuditLogger {
    entries: VecDeque<AuditEntry>,
    max_entries: usize,
}

impl AuditLogger {
    pub fn log(&mut self, entry: AuditEntry) { /* ... */ }
    pub fn get_entries(&self) -> Vec<AuditEntry> { /* ... */ }
}
```

#### 2.2.2 前端新增

**hooks/usePermission.ts (新增)**

```typescript
// src/hooks/usePermission.ts
import { useState, useEffect } from 'react';
import { checkPermission as rustCheck, requestPermission as rustRequest } from '../services/permissionsRust';

export function usePermission(permissionId: string) {
  const [state, setState] = useState<PermissionState | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    checkAndSetState();
  }, [permissionId]);

  const checkAndSetState = async () => {
    setLoading(true);
    const result = await rustCheck(permissionId);
    setState(result);
    setLoading(false);
  };

  const request = async (reason?: string) => {
    const result = await rustRequest(permissionId, true);
    await checkAndSetState();
    return result;
  };

  return { state, loading, request, refresh: checkAndSetState };
}
```

**hooks/usePermissionRequest.ts (新增)**

```typescript
// src/hooks/usePermissionRequest.ts
export function usePermissionRequest(permissionId: string) {
  const { state, loading, request } = usePermission(permissionId);
  const [requestType, setRequestType] = useState<'popup' | 'settings'>('popup');

  const requestWithFeedback = async (reason?: string) => {
    const result = await request(reason);
    return result;
  };

  return { loading, requestType, request: requestWithFeedback };
}
```

**components/permissions/PermissionGuard.tsx (新增)**

```typescript
// src/components/permissions/PermissionGuard.tsx
import { ReactNode } from 'react';
import { usePermission } from '../../hooks/usePermission';

interface PermissionGuardProps {
  permission: string;
  children: ReactNode;
  fallback?: ReactNode;
}

export function PermissionGuard({ permission, children, fallback }: PermissionGuardProps) {
  const { state, loading, request } = usePermission(permission);

  if (loading) return <div>检查权限中...</div>;
  if (!state?.granted) {
    return fallback || (
      <div className="permission-fallback">
        <p>需要 {permission} 权限</p>
        <button onClick={() => request()}>授予权限</button>
      </div>
    );
  }
  return <>{children}</>;
}
```

**components/permissions/PermissionRequest.tsx (新增)**

```typescript
// src/components/permissions/PermissionRequest.tsx
import { Modal, Button, Descriptions, Alert } from 'antd';
import { useState } from 'react';
import { usePermissionRequest } from '../../hooks/usePermissionRequest';

interface PermissionRequestProps {
  permission: string;
  reason?: string;
  onSuccess?: () => void;
  onFail?: () => void;
}

export function PermissionRequest({ permission, reason, onSuccess, onFail }: PermissionRequestProps) {
  const { loading, request } = usePermissionRequest(permission);
  const [visible, setVisible] = useState(true);

  const handleRequest = async () => {
    const result = await request(reason);
    if (result.granted) {
      onSuccess?.();
      setVisible(false);
    } else {
      onFail?.();
    }
  };

  return (
    <Modal
      title={`请求权限: ${permission}`}
      open={visible}
      onCancel={() => setVisible(false)}
      footer={[
        <Button key="cancel" onClick={() => setVisible(false)}>暂不</Button>,
        <Button key="request" type="primary" loading={loading} onClick={handleRequest}>
          授予权限
        </Button>,
      ]}
    >
      <Descriptions column={1}>
        <Descriptions.Item label="权限">{permission}</Descriptions.Item>
        {reason && <Descriptions.Item label="用途">{reason}</Descriptions.Item>}
      </Descriptions>
      <Alert type="info" message="点击授予权限后将弹出系统对话框" showIcon />
    </Modal>
  );
}
```

**components/permissions/PermissionStatusCard.tsx (新增)**

```typescript
// src/components/permissions/PermissionStatusCard.tsx
import { Card, Tag, Button, Space } from 'antd';
import { CheckCircleOutlined, CloseCircleOutlined, QuestionCircleOutlined } from '@ant-design/icons';
import { usePermission } from '../../hooks/usePermission';

interface PermissionStatusCardProps {
  permission: string;
  description: string;
}

export function PermissionStatusCard({ permission, description }: PermissionStatusCardProps) {
  const { state, loading, request, refresh } = usePermission(permission);
  const status = state?.status || 'NotDetermined';

  const config: Record<string, { color: string; icon: any; text: string }> = {
    Authorized: { color: 'success', icon: <CheckCircleOutlined />, text: '已授权' },
    Denied: { color: 'error', icon: <CloseCircleOutlined />, text: '已拒绝' },
    NotDetermined: { color: 'warning', icon: <QuestionCircleOutlined />, text: '待授权' },
  };

  const { color, icon, text } = config[status] || config.NotDetermined;

  return (
    <Card size="small">
      <Card.Meta
        avatar={icon}
        title={<><span>{permission}</span><Tag color={color}>{text}</Tag></>}
        description={description}
      />
      <div style={{ marginTop: 12 }}>
        {status === 'Authorized' ? (
          <Tag icon={<CheckCircleOutlined />} color="success">已启用</Tag>
        ) : (
          <Space>
            <Button type="primary" size="small" loading={loading} onClick={() => request()}>
              授权
            </Button>
            <Button size="small" onClick={refresh}>刷新</Button>
          </Space>
        )}
      </div>
    </Card>
  );
}
```

**pages/Settings/Permissions.tsx (新增)**

```typescript
// src/pages/Settings/Permissions.tsx
import { Tabs, Row, Col, Alert, Button } from 'antd';
import { ReloadOutlined } from '@ant-design/icons';
import { PermissionStatusCard } from '../../components/permissions/PermissionStatusCard';

export function PermissionsPage() {
  const tabItems = [
    {
      key: 'core',
      label: '核心权限',
      children: (
        <Row gutter={[16, 16]}>
          <Col xs={24} sm={12} md={8}>
            <PermissionStatusCard permission="accessibility" description="用于远程控制" />
          </Col>
          <Col xs={24} sm={12} md={8}>
            <PermissionStatusCard permission="screen_recording" description="用于画面传输" />
          </Col>
        </Row>
      ),
    },
    {
      key: 'input',
      label: '输入权限',
      children: (
        <Row gutter={[16, 16]}>
          <Col xs={24} sm={12} md={8}>
            <PermissionStatusCard permission="microphone" description="用于语音输入" />
          </Col>
          <Col xs={24} sm={12} md={8}>
            <PermissionStatusCard permission="camera" description="用于视频通话" />
          </Col>
        </Row>
      ),
    },
  ];

  return (
    <div className="permissions-page">
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 24 }}>
        <h2>权限设置</h2>
        <Button>刷新状态</Button>
      </div>
      <Alert type="info" message="部分权限需手动在系统设置中启用" showIcon style={{ marginBottom: 24 }} />
      <Tabs items={tabItems} />
    </div>
  );
}
```

### 2.3 集成现有代码

#### 更新 lib.rs

```rust
// src-tauri/src/lib.rs

// 新增导入
use crate::persistence::PermissionStorage;
use crate::policy::PolicyEngine;
use crate::audit::AuditLogger;

// 新增 State
struct PersistenceState {
    storage: Mutex<Option<PermissionStorage>>,
}

struct PolicyState {
    engine: Mutex<PolicyEngine>,
}

struct AuditState {
    logger: Mutex<AuditLogger>,
}

// 在 run() 中注册
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_store::init())
        .manage(PermissionsState::default())
        .manage(MonitorState::default())
        .manage(PersistenceState::default())
        .manage(PolicyState::default())
        .manage(AuditState::default())
        .invoke_handler(tauri::generate_handler![
            // 现有命令...
            // 新增命令...
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
```

#### 更新 permissions.ts

```typescript
// src/services/permissions.ts

// 新增：获取权限设置页面 URL
export function getSettingsUrl(category: PermissionCategory): string {
  return SETTINGS_URLS[category] || 'x-apple.systempreferences:com.apple.security.privacy';
}

// 新增：检查权限是否需要手动设置
export function requiresManualSettings(status: PermissionStatus): boolean {
  return status === 'Denied' || status === 'Restricted';
}

// 新增：获取权限请求类型
export function getRequestType(permission: string): 'popup' | 'settings' {
  const popupPermissions = ['microphone', 'camera', 'screen_recording', 'speech'];
  return popupPermissions.includes(permission) ? 'popup' : 'settings';
}
```

---

## 3. 实施计划

### 3.1 Phase 1：UI 组件开发（Week 1-2）

#### Week 1：基础组件

| 任务 | 文件 | 工作量 | 依赖 |
|------|------|--------|------|
| 1.1 | `hooks/usePermission.ts` | 0.5天 | permissionsRust.ts |
| 1.2 | `hooks/usePermissionRequest.ts` | 0.5天 | usePermission |
| 1.3 | `components/permissions/PermissionGuard.tsx` | 1天 | usePermission |
| 1.4 | `components/permissions/PermissionStatusCard.tsx` | 1天 | usePermission |
| 1.5 | 测试 | 1天 | 以上全部 |

#### Week 2：高级组件

| 任务 | 文件 | 工作量 | 依赖 |
|------|------|--------|------|
| 2.1 | `components/permissions/PermissionRequest.tsx` | 1.5天 | usePermissionRequest |
| 2.2 | `pages/Settings/Permissions.tsx` | 1.5天 | PermissionStatusCard |
| 2.3 | 集成到 App.tsx | 1天 | PermissionsPage |
| 2.4 | 测试 | 1天 | 以上全部 |

### 3.2 Phase 2：持久化存储（Week 3）

| 任务 | 文件 | 工作量 | 依赖 |
|------|------|--------|------|
| 3.1 | 添加 tauri-plugin-store 依赖 | 0.5天 | Cargo.toml |
| 3.2 | `src-tauri/src/persistence.rs` | 1.5天 | Store API |
| 3.3 | 集成到 lib.rs | 1天 | PermissionsState |
| 3.4 | 前端持久化 API | 1天 | permissions.ts |
| 3.5 | 测试 | 1天 | 以上全部 |

### 3.3 Phase 3：策略引擎（Week 4）

| 任务 | 文件 | 工作量 | 依赖 |
|------|------|--------|------|
| 4.1 | `src-tauri/src/policy.rs` | 2天 | PolicyEngine |
| 4.2 | 添加策略命令 | 1天 | lib.rs |
| 4.3 | 前端策略配置 | 1天 | Settings 扩展 |
| 4.4 | 测试 | 1天 | 以上全部 |

### 3.4 Phase 4：审计日志（Week 5）

| 任务 | 文件 | 工作量 | 依赖 |
|------|------|--------|------|
| 5.1 | `src-tauri/src/audit.rs` | 1.5天 | AuditLogger |
| 5.2 | 集成到现有命令 | 1天 | check/request/open |
| 5.3 | 审计查看 UI | 1天 | Settings 扩展 |
| 5.4 | 测试 | 0.5天 | 以上全部 |

### 3.5 Phase 5：测试和文档（Week 6）

| 任务 | 文件 | 工作量 |
|------|------|--------|
| 5.1 | 单元测试（新增代码） | 2天 |
| 5.2 | 集成测试（三平台） | 2天 |
| 5.3 | 更新文档 | 1天 |
| 5.4 | 性能测试 | 1天 |

### 3.6 时间线

```
Week 1    Week 2    Week 3    Week 4    Week 5    Week 6
  ├──────────┬──────────┬──────────┬──────────┬──────────┤
  │UI组件    │UI组件    │持久化    │策略引擎  │审计日志  │测试文档 │
  └──────────┴──────────┴──────────┴──────────┴──────────┘
        ▲                                    ▲
        │                                    │
        └── 现有代码无需大改 ─────────────────┘
```

### 3.7 里程碑

| 里程碑 | 时间 | 验收标准 |
|--------|------|----------|
| M1: UI 组件完成 | Week 2 | 4 个组件 + Settings 页面可用 |
| M2: 持久化完成 | Week 3 | 权限状态持久化，5 秒缓存升级 |
| M3: 策略完成 | Week 4 | 策略引擎工作，可配置 |
| M4: 审计完成 | Week 5 | 审计日志可用 |
| M5: 发布准备 | Week 6 | 测试覆盖 > 80%，文档完整 |

---

## 4. 资源评估

### 4.1 代码量统计

| 模块 | 文件 | 新增行数 | 累计行数 |
|------|------|----------|----------|
| **现有代码** | - | - | **~1050 行** |
| Rust 后端新增 | 3 | 400 行 | 850 行 |
| 前端 Hooks | 2 | 100 行 | 550 行 |
| UI 组件 | 4 | 350 行 | 900 行 |
| 页面 | 1 | 150 行 | 1050 行 |
| 测试 | 10 | 400 行 | 1450 行 |
| **新增总计** | **20** | **1400 行** | **~2450 行** |

### 4.2 依赖项

```toml
# Cargo.toml 新增
[dependencies]
tauri-plugin-store = "2"

[dev-dependencies]
tempfile = "4.0"
```

```json
// package.json 无新增依赖
```

---

## 5. 风险与应对

| 风险 | 影响 | 可能性 | 应对措施 |
|------|------|--------|----------|
| 现有代码变更 | 兼容性问题 | 低 | 保持接口兼容，添加适配层 |
| Tauri Store 兼容性 | 持久化失败 | 低 | fallback 到内存缓存 |
| 测试覆盖不足 | 质量风险 | 中 | 优先测试新增代码 |

---

## 附录A：macOS 权限请求方式

### A.1 权限类型

| 类型 | 权限 | 用户体验 |
|------|------|----------|
| **系统弹窗** ✅ | 麦克风、相机、屏幕录制、语音识别 | 点击 → 系统弹窗 → 立即授权 |
| **手动设置** ⚠️ | Accessibility、键盘监控、文件读写 | 点击 → 打开系统设置 → 手动勾选 |

### A.2 现有代码中的处理

```typescript
// permissions.ts 中已有判断逻辑
export function getRequestType(permission: string): 'popup' | 'settings' {
  const popupPermissions = ['microphone', 'camera', 'screen_recording', 'speech'];
  return popupPermissions.includes(permission) ? 'popup' : 'settings';
}
```

---

## 附录B：UI 组件设计

### B.1 组件关系

```
┌─────────────────────────────────────────────────────────────┐
│                     PermissionsPage                         │
│  ┌─────────────────────────────────────────────────────┐   │
│  │  Tabs (core / input / storage / network)           │   │
│  │  ┌─────────────────────────────────────────────┐   │   │
│  │  │  Row                                        │   │   │
│  │  │  ┌─────────────────────────────────────┐    │   │   │
│  │  │  │ PermissionStatusCard               │    │   │   │
│  │  │  │ ┌───────────────────────────────┐   │   │   │   │
│  │  │  │ │ usePermission hook           │   │   │   │   │
│  │  │  │ └───────────────────────────────┘   │   │   │   │
│  │  │  └─────────────────────────────────────┘    │   │   │
│  │  └─────────────────────────────────────────────┘   │   │
│  └─────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────┘
```

### B.2 使用示例

```tsx
// 保护功能组件
<PermissionGuard permission="screen_recording">
  <ScreenCaptureComponent />
</PermissionGuard>

// 弹窗请求权限
<PermissionRequest
  permission="microphone"
  reason="需要麦克风进行语音输入"
  onSuccess={() => message.success('权限已授予')}
  onFail={() => message.warning('请前往系统设置')}
/>

// 展示权限状态
<PermissionStatusCard
  permission="accessibility"
  description="用于远程控制时模拟键盘鼠标输入"
/>
```

---

## 附录C：文件索引

### 现有文件（无需修改或小改）

| 文件 | 状态 | 说明 |
|------|------|------|
| `src-tauri/src/lib.rs` | 基础已就绪 | 新增 3 个 State + 2 个命令 |
| `src/services/permissionsRust.ts` | 已就绪 | 新增 3 个工具函数 |
| `src/services/permissions.ts` | 已就绪 | 新增 3 个工具函数 |
| `src/App.tsx` | 需集成 | 添加 PermissionsPage 入口 |

### 新增文件

| 文件 | Phase | 说明 |
|------|-------|------|
| `src/hooks/usePermission.ts` | Week 1 | 权限状态 Hook |
| `src/hooks/usePermissionRequest.ts` | Week 1 | 权限请求 Hook |
| `src/components/permissions/PermissionGuard.tsx` | Week 1 | 权限守卫 |
| `src/components/permissions/PermissionStatusCard.tsx` | Week 1 | 状态卡片 |
| `src/components/permissions/PermissionRequest.tsx` | Week 2 | 请求弹窗 |
| `src/pages/Settings/Permissions.tsx` | Week 2 | 设置页面 |
| `src-tauri/src/persistence.rs` | Week 3 | 持久化存储 |
| `src-tauri/src/policy.rs` | Week 4 | 策略引擎 |
| `src-tauri/src/audit.rs` | Week 5 | 审计日志 |

---

*文档创建时间：2026-02-03*  
*最后更新：2026-02-04*  
*版本：v3.0 (基于现有实现)*
