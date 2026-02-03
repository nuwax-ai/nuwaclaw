# nuwax-agent: agent-tauri-client 权限管理系统实施方案

> 创建日期：2026-02-04  
> 版本：v1.0  
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

### 1.2 现有代码结构

```
crates/agent-tauri-client/
├── src-tauri/src/lib.rs              # ✅ Rust 后端 (450行)
├── src/services/
│   ├── permissionsRust.ts            # ✅ Rust 桥接 (200行)
│   └── permissions.ts                # ✅ 前端服务 (400行)
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
│  ┌─────────────────────────────────────────────────────────┐   │
│  │  UI 层 (待开发)                                         │   │
│  │  ┌──────────────┐ ┌──────────────┐ ┌──────────────┐   │   │
│  │  │PermissionGuard│ │PermissionRequest│ │SettingsPage│   │   │
│  └─────────┬──────────────┬──────────────┬─────────────┘   │
│            │                │                │                │
│  ┌─────────┼────────────────┼────────────────┼───────────┐   │
│  │  Hooks  │                │                │           │   │
│  │  usePermission.ts        │                │           │   │
│  │  usePermissionRequest.ts │                │           │   │
│  └─────────┼────────────────┼────────────────┼───────────┘   │
│            │                │                │                │
│  ┌─────────▼────────────────▼────────────────▼───────────┐   │
│  │  Services 层 (现有代码，无需大改)                       │   │
│  │  permissions.ts (400行) + permissionsRust.ts (200行)  │   │
│  └────────────────────────────────────────────────────────┘   │
│                          │                                    │
│  ┌──────────────────────────────────────────────────────────┐ │
│  │  Rust 后端                                               │ │
│  │  lib.rs (现有 450行)  +  persistence.rs/policy.rs/audit.rs│ │
│  └──────────────────────────────────────────────────────────┘ │
│                          │                                    │
│         ┌────────────────┼────────────────┐                   │
│         ▼                ▼                ▼                   │
│  ┌───────────┐    ┌───────────┐    ┌───────────┐           │
│  │  macOS    │    │  Windows  │    │   Linux   │           │
│  │  (TCC)    │    │  (UAC)    │    │  (AT-SPI) │           │
│  └───────────┘    └───────────┘    └───────────┘           │
└─────────────────────────────────────────────────────────────────┘
```

### 2.2 新增文件设计

#### Rust 后端新增

**persistence.rs**

```rust
// src-tauri/src/persistence.rs
use tauri_plugin_store::Store;
use std::sync::Mutex;

pub struct PermissionStorage {
    store: Mutex<Store>,
}
```

**policy.rs**

```rust
// src-tauri/src/policy.rs
pub struct PolicyEngine {
    policies: Vec<PermissionPolicy>,
    current_policy: String,
}
```

**audit.rs**

```rust
// src-tauri/src/audit.rs
pub struct AuditLogger {
    entries: VecDeque<AuditEntry>,
    max_entries: usize,
}
```

#### 前端新增

**hooks/usePermission.ts**

```typescript
// src/hooks/usePermission.ts
export function usePermission(permissionId: string) {
  const [state, setState] = useState<PermissionState | null>(null);
  const [loading, setLoading] = useState(true);
  // ...
}
```

**components/permissions/PermissionGuard.tsx**

```typescript
// src/components/permissions/PermissionGuard.tsx
export function PermissionGuard({ permission, children, fallback }: PermissionGuardProps) {
  const { state, loading, request } = usePermission(permission);
  // ...
}
```

**components/permissions/PermissionStatusCard.tsx**

```typescript
// src/components/permissions/PermissionStatusCard.tsx
export function PermissionStatusCard({ permission, description }: PermissionStatusCardProps) {
  // ...
}
```

**components/permissions/PermissionRequest.tsx**

```typescript
// src/components/permissions/PermissionRequest.tsx
export function PermissionRequest({ permission, reason, onSuccess, onFail }: PermissionRequestProps) {
  // ...
}
```

**pages/Settings/Permissions.tsx**

```typescript
// src/pages/Settings/Permissions.tsx
export function PermissionsPage() {
  // ...
}
```

---

## 3. 实施计划

### 3.1 Phase 1：UI 组件开发（Week 1-2）

| 周 | 任务 | 文件 | 工作量 |
|----|------|------|--------|
| Week 1 | Hooks + 基础组件 | `usePermission.ts`, `PermissionGuard.tsx`, `PermissionStatusCard.tsx` | 3天 |
| Week 2 | 高级组件 | `PermissionRequest.tsx`, `Permissions.tsx` | 4天 |

### 3.2 Phase 2：持久化存储（Week 3）

| 任务 | 文件 | 工作量 |
|------|------|--------|
| 添加 tauri-plugin-store | Cargo.toml | 0.5天 |
| 持久化模块 | `persistence.rs` | 1.5天 |
| 集成到 lib.rs | lib.rs | 1天 |
| 前端 API | permissions.ts | 1天 |

### 3.3 Phase 3：策略引擎（Week 4）

| 任务 | 文件 | 工作量 |
|------|------|--------|
| 策略引擎 | `policy.rs` | 2天 |
| 策略命令 | lib.rs | 1天 |
| 前端配置 | Settings 扩展 | 1天 |

### 3.4 Phase 4：审计日志（Week 5）

| 任务 | 文件 | 工作量 |
|------|------|--------|
| 审计日志 | `audit.rs` | 1.5天 |
| 集成到命令 | lib.rs | 1天 |
| 查看 UI | Settings 扩展 | 1天 |

### 3.5 Phase 5：测试和文档（Week 6）

| 任务 | 工作量 |
|------|--------|
| 单元测试 | 2天 |
| 集成测试 | 2天 |
| 文档更新 | 1天 |
| 性能测试 | 1天 |

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

---

## 4. 资源评估

### 4.1 代码量统计

| 模块 | 新增行数 | 累计行数 |
|------|----------|----------|
| **现有代码** | - | ~1050 行 |
| Rust 后端新增 | 400 行 | 850 行 |
| 前端 Hooks | 100 行 | 550 行 |
| UI 组件 | 350 行 | 900 行 |
| 页面 | 150 行 | 1050 行 |
| 测试 | 400 行 | 1450 行 |
| **新增总计** | **1400 行** | **~2450 行** |

---

## 附录A：macOS 权限请求方式

| 类型 | 权限 | 用户体验 |
|------|------|----------|
| **系统弹窗** ✅ | 麦克风、相机、屏幕录制、语音识别 | 点击 → 系统弹窗 → 立即授权 |
| **手动设置** ⚠️ | Accessibility、键盘监控、文件读写 | 点击 → 打开系统设置 → 手动勾选 |

---

## 附录B：UI 组件使用示例

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
/>

// 展示权限状态
<PermissionStatusCard
  permission="accessibility"
  description="用于远程控制时模拟键盘鼠标输入"
/>
```

---

## 附录C：文件索引

### 现有文件（无需修改）

| 文件 | 状态 |
|------|------|
| `src-tauri/src/lib.rs` | 已就绪 |
| `src/services/permissionsRust.ts` | 已就绪 |
| `src/services/permissions.ts` | 已就绪 |

### 新增文件

| 文件 | Phase |
|------|-------|
| `src/hooks/usePermission.ts` | Week 1 |
| `src/hooks/usePermissionRequest.ts` | Week 1 |
| `src/components/permissions/PermissionGuard.tsx` | Week 1 |
| `src/components/permissions/PermissionStatusCard.tsx` | Week 1 |
| `src/components/permissions/PermissionRequest.tsx` | Week 2 |
| `src/pages/Settings/Permissions.tsx` | Week 2 |
| `src-tauri/src/persistence.rs` | Week 3 |
| `src-tauri/src/policy.rs` | Week 4 |
| `src-tauri/src/audit.rs` | Week 5 |

---

*创建时间：2026-02-04*  
*版本：v1.0*
