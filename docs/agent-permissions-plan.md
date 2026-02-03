# nuwax-agent: agent-tauri-client 权限管理系统综合实施方案

> 创建日期：2026-02-03  
> 最后更新：2026-02-04  
> 项目：nuwax-agent (Tauri + React + Ant Design)  
> 目标：多端客户端（Windows / macOS / Linux）系统权限授权管理

---

## 📋 文档版本历史

| 版本 | 日期 | 更新内容 |
|------|------|----------|
| v1.0 | 2026-02-03 | 初始 plan（基于 agent-desktop 方案） |
| v1.1 | 2026-02-04 | 添加 macOS 权限类型和 UI 设计附录 |
| v2.0 | 2026-02-04 | **综合版本**：整合两个 plan + 当前实现 |

---

## 目录

- [1. 背景与目标](#1-背景与目标)
- [2. 当前实现分析](#2-当前实现分析)
- [3. 方案设计](#3-方案设计)
- [4. 实施计划](#4-实施计划)
- [5. 资源评估](#5-资源评估)
- [6. 风险与应对](#6-风险与应对)
- [附录A：macOS 权限请求方式详解](#附录a-macos-权限请求方式详解)
- [附录B：权限请求 UI 设计](#附录b-权限请求-ui-设计)
- [附录C：参考项目](#附录c-参考项目)

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

### 1.2 需求来源

| 来源 | 描述 |
|------|------|
| agent-desktop 方案 | 策略+审计模式 |
| 权限管理 plan (旧) | Phase 1-4 结构，侧重 Tauri 配置 |
| agent-permissions-plan (新) | 6 周结构，完整架构设计 |
| 当前代码实现 | 已完成核心功能，需补充 UI 和持久化 |

### 1.3 项目目标

| 目标 | 描述 | 优先级 |
|------|------|--------|
| P0 | 复用 system-permissions，实现跨平台权限检查和请求 | 必须 |
| P0 | 权限状态持久化（用户偏好） | 必须 |
| P1 | 权限请求 UI 组件（React + Ant Design） | 必须 |
| P1 | 权限审计日志 | 应该 |
| P2 | 权限策略配置（操作级权限） | 可以 |

---

## 2. 当前实现分析

### 2.1 已完成功能 ✅

| 功能 | 位置 | 状态 | 说明 |
|------|------|------|------|
| Rust 后端 | `src-tauri/src/lib.rs` | ✅ 8 个命令 | check, request, open_settings, get_all, monitor |
| 前端服务层 | `src/services/permissionsRust.ts` | ✅ 200+ 行 | Rust 桥接，权限映射 |
| 前端逻辑层 | `src/services/permissions.ts` | ✅ 350+ 行 | 缓存 5 秒，fallback 机制 |
| 权限监控 | `src/services/permissions.ts` | ✅ | Tauri 事件推送 |
| macOS 集成 | `system-permissions` | ✅ | TCC 权限，区分弹窗/手动 |

### 2.2 当前代码结构

```
crates/agent-tauri-client/
├── src-tauri/src/lib.rs              # Rust 后端（已完成）
│   ├── PermissionsState              # 延迟初始化
│   ├── MonitorState                  # 监控状态
│   └── 8 个 Tauri 命令               # ✅
├── src/services/
│   ├── permissionsRust.ts            # ✅ Rust 桥接
│   └── permissions.ts                # ✅ 前端服务
└── src/App.tsx                       # 集成权限检查
```

### 2.3 待完成功能 ⚠️

| 功能 | 优先级 | 工作量 | 说明 |
|------|--------|--------|------|
| UI 组件 | P0 | 3 天 | PermissionGuard, PermissionRequest, Settings |
| 持久化 | P1 | 2 天 | Tauri Store 插件 |
| 策略引擎 | P1 | 2 天 | 简化版 PermissionPolicy |
| 审计日志 | P2 | 1 天 | 操作记录 |
| 集成测试 | P1 | 2 天 | 三平台测试 |

### 2.4 与两个 Plan 的对比

| 维度 | 旧 Plan (permission-management) | 新 Plan (agent-permissions) | 当前实现 |
|------|--------------------------------|-----------------------------|----------|
| 架构 | Tauri capabilities + Rust 命令 | 完整 AgentPermissionManager 包装 | 直接使用 system-permissions |
| 持久化 | 未涉及 | Tauri Store | ❌ 仅内存缓存 |
| 策略引擎 | 未涉及 | PolicyEngine | ❌ 未实现 |
| UI 组件 | 基础 PermissionCheck | 6 个专用组件 | ⚠️ 服务层已就绪 |
| 监控 | 未涉及 | 可选功能 | ✅ 已实现 |
| 时间线 | Phase 1-4 (4 周) | 6 周 | 已完成核心 |

---

## 3. 方案设计

### 3.1 架构设计（综合版）

```
┌─────────────────────────────────────────────────────────────────┐
│                    agent-tauri-client                           │
├─────────────────────────────────────────────────────────────────┤
│  ┌─────────────────┐    ┌─────────────────────────────────┐   │
│  │   React UI      │    │  PermissionsPage (新建)         │   │
│  │  Components     │◄──►│  - PermissionGuard             │   │
│  │                 │    │  - PermissionRequest           │   │
│  └─────────────────┘    │  - PermissionStatusCard        │   │
│                         │  - PermissionSettingsGuide     │   │
│                         └─────────────────────────────────┘   │
│                                   │                            │
│  ┌───────────────────────────────▼──────────────────────────┐  │
│  │              Rust Core (Tauri)                          │  │
│  │  ┌─────────────┐  ┌─────────────────────────────────┐  │  │
│  │  │  System    │  │  现有命令 (无需改动)             │  │  │
│  │  │  Perms     │  │  - check_permission             │  │  │
│  │  │  (crates/) │  │  - request_permission           │  │  │
│  │  └─────┬─────┘  │  - open_settings                 │  │  │
│  │        │        │  - get_all_permissions           │  │  │
│  │        │        │  - start/stop_permission_monitor │  │  │
│  │        │        └─────────────────────────────────┘  │  │
│  │        │                                              │  │
│  │  ┌─────▼────────────┐                               │  │
│  │  │  新增:           │                               │  │
│  │  │  - persistence   │                               │  │
│  │  │  - policy_engine │                               │  │
│  │  │  - audit_log     │                               │  │
│  │  └─────────────────┘                               │  │
│  └───────────────────────────────────────────────────────┘  │
│                      │                                   │
│         ┌────────────┼────────────┐                      │
│         ▼            ▼            ▼                      │
│  ┌───────────┐  ┌───────────┐  ┌───────────┐          │
│  │  macOS    │  │  Windows  │  │   Linux   │          │
│  │  (TCC)    │  │  (UAC)    │  │  (AT-SPI) │          │
│  └───────────┘  └───────────┘  └───────────┘          │
└─────────────────────────────────────────────────────────────────┘
```

### 3.2 目录结构

```
crates/agent-tauri-client/
├── src-tauri/src/
│   ├── lib.rs                    # 现有（无需大改）
│   ├── persistence.rs            # 新增：持久化
│   ├── policy.rs                 # 新增：策略引擎
│   └── audit.rs                  # 新增：审计日志
├── src/
│   ├── components/permissions/   # 新增：UI 组件
│   │   ├── PermissionGuard.tsx
│   │   ├── PermissionRequest.tsx
│   │   ├── PermissionStatusCard.tsx
│   │   └── PermissionSettingsGuide.tsx
│   ├── hooks/
│   │   ├── usePermission.ts      # 新增：精简 Hook
│   │   └── usePermissionRequest.ts
│   ├── pages/
│   │   └── Settings/
│   │       └── Permissions.tsx   # 新增：权限设置页
│   └── services/
│       ├── permissions.ts        # 现有（需优化）
│       └── permissionsRust.ts    # 现有（无需改动）
└── docs/
    └── agent-permissions-plan.md # 本文档
```

### 3.3 权限管理模块设计

#### 3.3.1 持久化存储

```rust
// src-tauri/src/persistence.rs

use tauri_plugin_store::Store;
use std::sync::Mutex;

/// 权限持久化存储
pub struct PermissionStorage {
    store: Mutex<Store>,
}

impl PermissionStorage {
    pub fn new(store: Store) -> Self {
        Self {
            store: Mutex::new(store),
        }
    }

    /// 获取缓存的权限状态
    pub fn get_cached(&self, permission: &str) -> Option<CachedPermissionState> {
        let store = self.store.lock().unwrap();
        store.get(permission).and_then(|v| v.as_str())
            .and_then(|s| serde_json::from_str(s).ok())
    }

    /// 设置权限状态缓存
    pub fn set_cached(&self, permission: &str, state: &PermissionState) {
        let store = self.store.lock().unwrap();
        if let Ok(json) = serde_json::to_string(state) {
            store.insert(permission.to_string(), json.into());
        }
    }

    /// 获取用户权限偏好
    pub fn get_user_preference(&self, permission: &str) -> Option<UserPreference> {
        let key = format!("pref:{}", permission);
        let store = self.store.lock().unwrap();
        store.get(&key).and_then(|v| v.as_str())
            .and_then(|s| serde_json::from_str(s).ok())
    }

    /// 保存用户权限偏好
    pub fn set_user_preference(&self, permission: &str, pref: UserPreference) {
        let key = format!("pref:{}", permission);
        let store = self.store.lock().unwrap();
        if let Ok(json) = serde_json::to_string(&pref) {
            store.insert(key, json.into());
        }
    }
}
```

#### 3.3.2 策略引擎（简化版）

```rust
// src-tauri/src/policy.rs

use system_permissions::SystemPermission;

/// 权限策略配置
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct PermissionPolicy {
    pub name: String,
    pub rules: Vec<PermissionRule>,
    pub default_action: PolicyAction,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct PermissionRule {
    pub permission: String,
    pub action: PolicyAction,
    pub conditions: Vec<PermissionCondition>,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub enum PolicyAction {
    Allow,
    Deny,
    Confirm,
    Prompt,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub enum PermissionCondition {
    PathPrefix(Vec<String>),
    UserGroup(String),
    TimeRange { start: String, end: String },
}

/// 策略检查结果
pub enum PolicyCheckResult {
    Allowed,
    Denied(String),
    ConfirmationRequired,
    PromptRequired(String),
}

pub struct PolicyEngine {
    policies: Vec<PermissionPolicy>,
    current_policy: String,
}

impl PolicyEngine {
    pub fn new() -> Self {
        Self {
            policies: Self::default_policies(),
            current_policy: "default".to_string(),
        }
    }

    fn default_policies() -> Vec<PermissionPolicy> {
        vec![
            PermissionPolicy {
                name: "default".to_string(),
                rules: vec![],
                default_action: PolicyAction::Prompt,
            },
            PermissionPolicy {
                name: "strict".to_string(),
                rules: vec![
                    PermissionRule {
                        permission: "ScreenRecording".to_string(),
                        action: PolicyAction::Confirm,
                        conditions: vec![],
                    },
                ],
                default_action: PolicyAction::Deny,
            },
        ]
    }

    pub fn check(&self, permission: SystemPermission) -> PolicyCheckResult {
        let policy = self.policies.iter()
            .find(|p| p.name == self.current_policy)
            .unwrap_or(&self.policies[0]);

        for rule in &policy.rules {
            if rule.permission == format!("{:?}", permission) {
                return match rule.action {
                    PolicyAction::Allow => PolicyCheckResult::Allowed,
                    PolicyAction::Deny => PolicyCheckResult::Denied("Denied by policy".into()),
                    PolicyAction::ConfirmationRequired => PolicyCheckResult::ConfirmationRequired,
                    PolicyAction::PromptRequired => PolicyCheckResult::PromptRequired("User confirmation required".into()),
                };
            }
        }

        match policy.default_action {
            PolicyAction::Allow => PolicyCheckResult::Allowed,
            PolicyAction::Deny => PolicyCheckResult::Denied("Default policy denies".into()),
            PolicyAction::Confirm => PolicyCheckResult::ConfirmationRequired,
            PolicyAction::Prompt => PolicyCheckResult::PromptRequired("User confirmation required".into()),
        }
    }
}
```

#### 3.3.3 审计日志

```rust
// src-tauri/src/audit.rs

use chrono::{DateTime, Utc};
use std::collections::VecDeque;

/// 权限操作记录
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct AuditEntry {
    pub timestamp: DateTime<Utc>,
    pub permission: String,
    pub operation: AuditOperation,
    pub result: bool,
    pub details: Option<String>,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub enum AuditOperation {
    Check,
    Request,
    OpenSettings,
    PolicyApplied,
}

/// 审计日志管理器
pub struct AuditLogger {
    entries: VecDeque<AuditEntry>,
    max_entries: usize,
}

impl AuditLogger {
    pub fn new(max_entries: usize) -> Self {
        Self {
            entries: VecDeque::with_capacity(max_entries),
            max_entries,
        }
    }

    pub fn log(&mut self, entry: AuditEntry) {
        if self.entries.len() >= self.max_entries {
            self.entries.pop_front();
        }
        self.entries.push_back(entry);
    }

    pub fn get_entries(&self) -> Vec<AuditEntry> {
        self.entries.iter().cloned().collect()
    }

    pub fn clear(&mut self) {
        self.entries.clear();
    }
}
```

### 3.4 前端组件设计

#### 3.4.1 权限守卫组件

```tsx
// src/components/permissions/PermissionGuard.tsx

import { ReactNode } from 'react';
import { usePermission } from '../../hooks/usePermission';

interface PermissionGuardProps {
  permission: string;
  children: ReactNode;
  fallback?: ReactNode;
  onDeny?: () => void;
}

export function PermissionGuard({
  permission,
  children,
  fallback,
  onDeny,
}: PermissionGuardProps) {
  const { state, loading, request } = usePermission(permission);

  if (loading) {
    return <div className="permission-loading">检查权限中...</div>;
  }

  if (!state?.granted) {
    if (onDeny) {
      onDeny();
    }
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

#### 3.4.2 权限设置页面

```tsx
// src/pages/Settings/Permissions.tsx

import { Tabs, Row, Col, Alert, Button } from 'antd';
import { ReloadOutlined } from '@ant-design/icons';
import { usePermissions } from '../../hooks/usePermissions';
import { PermissionStatusCard } from '../../components/permissions/PermissionStatusCard';

export function PermissionsPage() {
  const { permissions, loading, refresh } = usePermissions();

  const tabItems = [
    {
      key: 'core',
      label: '核心权限',
      children: (
        <Row gutter={[16, 16]}>
          <Col xs={24} sm={12} md={8}>
            <PermissionStatusCard
              permission="accessibility"
              description="用于远程控制时模拟键盘鼠标输入"
            />
          </Col>
          <Col xs={24} sm={12} md={8}>
            <PermissionStatusCard
              permission="screen_recording"
              description="用于远程桌面实时画面传输"
            />
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
            <PermissionStatusCard
              permission="microphone"
              description="用于语音通话和音频输入"
            />
          </Col>
          <Col xs={24} sm={12} md={8}>
            <PermissionStatusCard
              permission="camera"
              description="用于视频通话功能"
            />
          </Col>
        </Row>
      ),
    },
  ];

  return (
    <div className="permissions-page">
      <div className="page-header">
        <h2>权限设置</h2>
        <Button icon={<ReloadOutlined />} onClick={refresh} loading={loading}>
          刷新状态
        </Button>
      </div>

      <Alert
        type="info"
        message="权限说明"
        description="部分权限需要您在系统设置中手动启用。"
        showIcon
        style={{ marginBottom: 24 }}
      />

      <Tabs items={tabItems} />
    </div>
  );
}
```

---

## 4. 实施计划

### 4.1 分阶段实施

#### Phase 1：完善 UI 组件（Week 1-2）

| 任务 | 内容 | 交付物 | 状态 |
|------|------|--------|------|
| 1.1 | 创建 PermissionGuard 组件 | components/PermissionGuard.tsx | 待开发 |
| 1.2 | 创建 PermissionRequest 组件 | components/PermissionRequest.tsx | 待开发 |
| 1.3 | 创建 PermissionStatusCard 组件 | components/PermissionStatusCard.tsx | 待开发 |
| 1.4 | 创建 PermissionsPage | pages/Settings/Permissions.tsx | 待开发 |
| 1.5 | 优化 usePermission Hook | hooks/usePermission.ts | 待开发 |

#### Phase 2：持久化存储（Week 3）

| 任务 | 内容 | 交付物 | 状态 |
|------|------|--------|------|
| 2.1 | 添加 tauri-plugin-store 依赖 | Cargo.toml | 待开发 |
| 2.2 | 实现 PermissionStorage | src-tauri/src/persistence.rs | 待开发 |
| 2.3 | 集成到 Rust 后端 | lib.rs | 待开发 |
| 2.4 | 持久化用户偏好 | 前端 Service | 待开发 |

#### Phase 3：策略引擎（Week 4）

| 任务 | 内容 | 交付物 | 状态 |
|------|------|--------|------|
| 3.1 | 实现 PolicyEngine | src-tauri/src/policy.rs | 待开发 |
| 3.2 | 实现 PolicyRule 解析 | policy.rs | 待开发 |
| 3.3 | 添加策略命令 | lib.rs | 待开发 |
| 3.4 | 前端策略配置 UI | Settings 扩展 | 待开发 |

#### Phase 4：审计日志（Week 5）

| 任务 | 内容 | 交付物 | 状态 |
|------|------|--------|------|
| 4.1 | 实现 AuditLogger | src-tauri/src/audit.rs | 待开发 |
| 4.2 | 集成权限操作审计 | lib.rs | 待开发 |
| 4.3 | 审计日志查看 UI | AuditLog 组件 | 待开发 |
| 4.4 | 导出审计日志 | CSV/JSON | 待开发 |

#### Phase 5：测试和文档（Week 6）

| 任务 | 内容 | 交付物 | 状态 |
|------|------|--------|------|
| 5.1 | 单元测试 | tests/unit/ | 待开发 |
| 5.2 | 集成测试（三平台） | tests/integration/ | 待开发 |
| 5.3 | 更新文档 | permission-guide.md | 待开发 |
| 5.4 | 性能测试 | benchmark | 待开发 |

### 4.2 时间线

```
Week 1    Week 2    Week 3    Week 4    Week 5    Week 6
  ├──────────┬──────────┬──────────┬──────────┬──────────┤
  │UI组件    │UI组件    │持久化    │策略引擎  │审计日志  │测试文档 │
  └──────────┴──────────┴──────────┴──────────┴──────────┘
        ▲                                            ▲
        │                                            │
        └──────────── 已完成核心功能 ─────────────────┘
```

### 4.3 里程碑

| 里程碑 | 时间 | 验收标准 |
|--------|------|----------|
| M1: UI 组件完成 | Week 2 | 所有权限组件可用 |
| M2: 持久化完成 | Week 3 | 权限状态持久化 |
| M3: 策略完成 | Week 4 | 策略引擎工作 |
| M4: 审计完成 | Week 5 | 审计日志可用 |
| M5: 发布准备 | Week 6 | 测试覆盖 > 80%，文档完整 |

---

## 5. 资源评估

### 5.1 代码量预估

| 模块 | 文件数 | 代码行数 |
|------|--------|----------|
| Rust 后端（新增） | 3 | 400+ |
| 前端组件 | 5 | 500+ |
| Hooks | 2 | 150+ |
| 测试 | 10 | 400+ |
| **新增总计** | **20** | **1450+** |
| 现有代码 | - | 1000+ |
| **项目总计** | - | **2450+** |

### 5.2 依赖项

```toml
# Cargo.toml 新增依赖
[dependencies]
tauri-plugin-store = "2"
serde_json = "1.0"

[dev-dependencies]
tempfile = "4.0"
```

```json
// package.json 新增依赖
{
  "devDependencies": {
    "@testing-library/react": "^14.0.0",
    "msw": "^2.0.0"
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
| Tauri Store 兼容性 | 持久化失败 | 低 | fallback 到 localStorage |
| 测试覆盖不足 | 质量风险 | 中 | 自动化测试，CI 集成 |

---

## 附录A：macOS 权限请求方式详解

### A.1 权限类型分类

macOS TCC (Transparency, Consent, and Control) 权限分为两类：

| 类型 | 说明 | 请求方式 | 权限列表 |
|------|------|----------|----------|
| **系统弹窗型** | 用户点击确认后立即授权 | `CGRequestScreenCaptureAccess()`<br>`AVCaptureDevice::request_access_for_media_type()` | 麦克风、相机、屏幕录制、语音识别 |
| **手动设置型** | 需用户去系统设置中手动开启 | 打开 `x-apple.systempreferences:` URL | Accessibility、键盘监控、文件读写、剪贴板 |

### A.2 详细对比

#### 系统弹窗型权限 ✅

```rust
// 麦克风 - 直接弹出系统对话框
async fn request_microphone(&self, options: RequestOptions) -> RequestResult {
    let granted = if options.interactive {
        unsafe { AVCaptureDevice::request_access_for_media_type(AVMediaType::AUDIO) }
    } else {
        false
    };
    
    RequestResult {
        permission: SystemPermission::Microphone,
        granted,
        status: if granted { PermissionStatus::Authorized } else { PermissionStatus::Denied },
        // ...
    }
}
```

**用户流程：**
1. 用户点击"授予权限"按钮
2. 弹出系统对话框
3. 用户点击"好"或"不允许"
4. 应用立即获知结果

#### 手动设置型权限 ⚠️

```rust
// Accessibility - 打开系统设置
async fn request_accessibility(&self, _options: RequestOptions) -> RequestResult {
    std::process::Command::new("open")
        .args(&["x-apple.systempreferences:com.apple.security.accessibility"])
        .spawn();
    
    RequestResult::denied(
        SystemPermission::Accessibility,
        "请在系统偏好设置中启用辅助功能权限",
        Some("系统偏好设置 > 安全性与隐私 > 隐私 > 辅助功能"),
    )
}
```

### A.3 完整权限请求矩阵

| 权限 | 类型 | API | 行为 |
|------|------|-----|------|
| Accessibility | 手动设置 | `AXIsProcessTrusted()` | 打开系统设置 |
| ScreenRecording | 系统弹窗 | `CGRequestScreenCaptureAccess()` | 弹出系统对话框 |
| Microphone | 系统弹窗 | `AVCaptureDevice::request_access_for_media_type()` | 弹出系统对话框 |
| Camera | 系统弹窗 | `AVCaptureDevice::request_access_for_media_type()` | 弹出系统对话框 |
| Notifications | 手动设置 | `UNUserNotificationCenter` | 需额外框架 |
| SpeechRecognition | 系统弹窗 | `SFSpeechRecognizer::request_authorization()` | 弹出系统对话框 |
| Location | 手动设置 | `CLLocationManager` | 需 CoreLocation |
| AppleScript | 手动设置 | 打开系统设置 | 打开 Automation |
| FileSystem Read/Write | 手动设置 | 打开系统设置 | 打开 Files and Folders |
| Clipboard | 手动设置 | 打开系统设置 | 打开 Accessibility |
| KeyboardMonitoring | 手动设置 | 打开系统设置 | 打开 Input Monitoring |
| Network | 自动允许 | - | 通常无需请求 |

---

## 附录B：权限请求 UI 设计

### B.1 权限请求流程图

```
┌─────────────────────────────────────────────────────────────────┐
│                    用户触发权限请求                              │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                 检查权限当前状态                                 │
│  ┌─────────────┐  NotDetermined  ┌─────────────┐               │
│  │  Authorized │ ◄────────────── │  Denied/    │               │
│  └─────────────┘                 │  Restricted │               │
│         │                        └─────────────┘               │
│         │                              │                       │
│         ▼                              ▼                       │
│  ┌─────────────┐              ┌─────────────────┐             │
│  │ 返回成功状态 │              │ 判断请求类型    │             │
│  │ 继续使用功能 │              └─────────────────┘             │
│  └─────────────┘                      │                       │
│                                      │                       │
│                    ┌─────────────────┼─────────────────┐     │
│                    ▼                 ▼                 ▼     │
│            ┌───────────┐    ┌───────────┐    ┌───────────┐  │
│            │ 系统弹窗型 │    │ 手动设置型 │    │  不支持   │  │
│            │ (Mic/Cam) │    │ (Accessibility) │  │          │  │
│            └─────┬─────┘    └─────┬─────┘    └─────┬─────┘  │
│                  │               │                │        │
│                  ▼               ▼                │        │
│          ┌───────────┐   ┌───────────────┐        │        │
│          │ 等待用户  │   │ 打开系统设置  │        │        │
│          │ 点击确认  │   │ 引导用户操作  │        │        │
│          └─────┬─────┘   └───────┬───────┘        │        │
│                │                 │                │        │
│                │           ┌─────┴─────┐          │        │
│                │           │ 用户完成  │          │        │
│                │           │ 返回应用  │          │        │
│                │           └─────┬─────┘          │        │
│                │                 │                │        │
│                └────────────┬────┴────┬───────────┘        │
│                             ▼         ▼                     │
│                    ┌─────────────────────────┐             │
│                    │   刷新权限状态并反馈    │             │
│                    └─────────────────────────┘             │
└─────────────────────────────────────────────────────────────────┘
```

### B.2 组件使用示例

```tsx
// 使用 PermissionGuard 保护功能
<PermissionGuard permission="screen_recording">
  <ScreenCaptureComponent />
</PermissionGuard>

// 使用 PermissionRequest 弹窗请求
<PermissionRequest
  permission="microphone"
  reason="需要麦克风进行语音输入"
  onSuccess={() => message.success('权限已授予')}
  onFail={() => message.warning('请前往系统设置手动授权')}
/>

// 使用 PermissionStatusCard 展示权限状态
<div className="permission-grid">
  <PermissionStatusCard
    permission="accessibility"
    description="用于远程控制时模拟键盘鼠标输入"
  />
  <PermissionStatusCard
    permission="screen_recording"
    description="用于远程桌面实时画面传输"
  />
</div>
```

---

## 附录C：参考项目

### C.1 workspace 中的项目

| 项目 | GitHub | 参考内容 |
|------|--------|----------|
| **nuwax-agent** | - | `system-permissions` crate，核心依赖 |
| **agent-desktop** | dongdada29/agent-desktop | `rustdesk-core/permission.rs` 策略模式 |

### C.2 已下载的开源项目

| 项目 | GitHub | 参考内容 |
|------|--------|----------|
| **untu-tip** | TencentCloudADP/youtu-tip | macOS 权限处理、pyautogui 截图 |
| **Agent-S** | simular-ai/Agent-S | Windows 自动化 (WAA) |
| **Open-AutoGLM** | zai-org/Open-AutoGLM | iOS/Android 自动化 |
| **UI-TARS-desktop** | bytedance/UI-TARS-desktop | 浏览器截图工具 |
| **OpenClaw** | openclaw/openclaw | TCC 权限管理文档 |

### C.3 外部参考资料

- [nuwax-agent system-permissions](file:///Users/louis/workspace/nuwax-agent/crates/system-permissions)
- [Tauri Capabilities](https://v2.tauri.dev/security/permissions)
- [Apple TCC Documentation](https://developer.apple.com/documentation/technologies/tcc)

---

## 附录D：术语表

| 术语 | 说明 |
|------|------|
| TCC | Transparency, Consent, and Control (macOS 权限系统) |
| UAC | User Account Control (Windows 权限系统) |
| AT-SPI | Assistive Technology Service Provider Interface (Linux) |
| capability | Tauri 权限配置单元 |
| policy | 权限策略规则集合 |

---

*文档创建时间：2026-02-03*  
*最后更新：2026-02-04*  
*版本：v2.0 (综合版)*
