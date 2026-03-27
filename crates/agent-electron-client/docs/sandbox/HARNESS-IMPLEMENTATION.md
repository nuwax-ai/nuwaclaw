# NuwaClaw Sandbox - Harness 实施方案

> **版本**: 2.0.0  
> **更新日期**: 2026-03-27  
> **基于**: Harness 架构 + CP 工作流

---

## 1. Harness 集成概述

### 1.1 目标

将 NuwaClaw Sandbox 开发集成到 **harness 工作流**中， 实现标准化的开发流程和质量门禁。

### 1.2 Harness 架构映射

```
┌─────────────────────────────────────────────────────────────┐
│              NuwaClaw Sandbox Harness 工作流                 │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│   CP1 ──→ CP2 ──→ CP3 ──→ CP4 ──→ CP5                      │
│   任务     规划     实现     验证     完成                   │
│   确认                                                   │
│                                                              │
│   Gates (质量门禁):                                          │
│   ├─ config-validate   - 配置验证                           │
│   ├─ platform-detect   - 平台检测                           │
│   ├─ sandbox-init      - 沙箱初始化                         │
│   ├─ execute-test       - 执行测试                          │
│   └─ integration-test   - 集成测试                          │
│                                                              │
└─────────────────────────────────────────────────────────────┘
```

---

## 2. Harness 目录结构

### 2.1 更新后的目录

```
crates/agent-electron-client/
├── harness/
│   ├── base/
│   │   ├── state.json                    # 更新：添加 sandbox 模块
│   │   └── tasks/
│   │       ├── sandbox-create.md         # 新增：沙箱创建任务
│   │       ├── sandbox-execute.md        # 新增：沙箱执行任务
│   │       └── sandbox-cleanup.md        # 新增：沙箱清理任务
│   │
│   ├── projects/
│   │   ├── darwin/
│   │   │   └── sandbox-config.md         # macOS 沙箱配置
│   │   ├── linux/
│   │   │   └── sandbox-config.md         # Linux 沙箱配置
│   │   └── win32/
│   │       └── sandbox-config.md         # Windows 沙箱配置
│   │
│   └── universal/
│       ├── sandbox-api.md                # 统一 API 规范
│       └── sandbox-security.md           # 安全策略
│
├── crates/nuwax-sandbox/                # Rust 源码（子模块）
│   ├── Cargo.toml
│   ├── crates/
│   │   ├── windows-sandbox/
│   │   ├── macos-sandbox/
│   │   └── linux-sandbox/
│   └── bindings/
│
└── resources/sandbox/                    # 编译产物
    ├── darwin-x64/
    ├── linux-x64/
    └── win32-x64/
```

---

## 3. CP 工作流定义

### 3.1 CP1: 任务确认

**触发**: 用户请求沙箱功能

**输入**:
- 用户需求描述
- 平台信息
- 资源限制

**输出**:
- 任务清单
- 技术方案
- 风险评估

**示例**:
```markdown
# 任务：实现 macOS sandbox-exec 集成

## 需求
- macOS 平台沙箱执行
- 网络访问控制
- 文件系统隔离

## 技术方案
- 使用 sandbox-exec (系统内置)
- Seatbelt 配置文件
- TypeScript 封装

## 风险评估
- ✅ 低风险（系统内置）
- ⚠️ 需要正确签名
```

---

### 3.2 CP2: 规划分解

**任务**: 将 CP1 的任务分解为子任务

**示例**:
```markdown
# CP2: macOS Sandbox 规划

## 子任务
1. [ ] 创建 MacSandbox.ts 类
2. [ ] 实现 generateProfile() 方法
3. [ ] 实现 execute() 方法
4. [ ] 添加错误处理
5. [ ] 编写单元测试

## 依赖
- Node.js child_process
- TypeScript 编译器

## 预计时间
- 1 小时
```

---

### 3.3 CP3: 执行实现

**任务**: 实现 CP2 的子任务

**流程**:
```
开始子任务
  ↓
编写代码
  ↓
本地测试
  ↓
代码审查
  ↓
完成子任务
```

**示例**:
```typescript
// src/main/services/sandbox/MacSandbox.ts

import { spawn } from "child_process";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";

export class MacSandbox {
  async execute(command: string, cwd: string, config: SandboxConfig): Promise<ExecuteResult> {
    const profile = this.generateProfile(cwd, config);
    const profilePath = path.join(os.tmpdir(), `sandbox-${Date.now()}.sb`);
    
    await fs.promises.writeFile(profilePath, profile);
    
    return new Promise((resolve, reject) => {
      const proc = spawn("sandbox-exec", ["-f", profilePath, "bash", "-c", command], { cwd });
      
      let stdout = "";
      let stderr = "";
      
      proc.stdout?.on("data", (data) => stdout += data);
      proc.stderr?.on("data", (data) => stderr += data);
      
      proc.on("close", (code) => {
        fs.unlinkSync(profilePath);
        resolve({ exitCode: code ?? -1, stdout, stderr });
      });
      
      proc.on("error", reject);
    });
  }
  
  private generateProfile(cwd: string, config: SandboxConfig): string {
    // 生成 Seatbelt 配置
    return `
(version 1)
(allow default)
(allow file-read* (subpath "${cwd}"))
(allow file-write* (subpath "${cwd}"))
(deny file-read* (subpath "~/.ssh"))
    `.trim();
  }
}
```

---

### 3.4 CP4: 质量门禁

**Gate 定义**:

#### Gate 1: config-validate
```typescript
// 检查配置是否有效
async function gate_configValidate(config: SandboxConfig): Promise<GateResult> {
  if (!config.mode) {
    return { passed: false, reason: "Missing mode" };
  }
  
  if (!["off", "on-demand", "non-main", "all"].includes(config.mode)) {
    return { passed: false, reason: "Invalid mode" };
  }
  
  return { passed: true };
}
```

#### Gate 2: platform-detect
```typescript
// 检查平台支持
async function gate_platformDetect(): Promise<GateResult> {
  const platform = os.platform();
  
  if (!["darwin", "linux", "win32"].includes(platform)) {
    return { passed: false, reason: `Unsupported platform: ${platform}` };
  }
  
  return { passed: true, data: { platform } };
}
```

#### Gate 3: sandbox-init
```typescript
// 检查沙箱是否初始化
async function gate_sandboxInit(sandbox: SandboxInterface): Promise<GateResult> {
  if (!await sandbox.isAvailable()) {
    return { passed: false, reason: "Sandbox not available" };
  }
  
  return { passed: true };
}
```

#### Gate 4: execute-test
```typescript
// 执行测试
async function gate_executeTest(sandbox: SandboxInterface): Promise<GateResult> {
  try {
    const result = await sandbox.execute("echo test", "/tmp");
    
    if (result.exitCode !== 0) {
      return { passed: false, reason: `Test failed: ${result.stderr}` };
    }
    
    return { passed: true };
  } catch (error) {
    return { passed: false, reason: error.message };
  }
}
```

#### Gate 5: integration-test
```typescript
// 集成测试
async function gate_integrationTest(): Promise<GateResult> {
  // 运行完整的端到端测试
  const tests = [
    testBasicExecution(),
    testNetworkIsolation(),
    testFilesystemIsolation(),
    testResourceLimits(),
  ];
  
  for (const test of tests) {
    const result = await test();
    if (!result.passed) {
      return result;
    }
  }
  
  return { passed: true };
}
```

---

### 3.5 CP5: 审查完成

**审查清单**:
- [ ] 所有 CP4 gates 通过
- [ ] 代码审查完成
- [ ] 文档更新完成
- [ ] 测试覆盖率达到 80%+
- [ ] 性能基准测试完成

---

## 4. Harness 任务定义

### 4.1 sandbox-create.md

```markdown
# 任务：创建沙箱实例

## 描述
根据配置创建沙箱实例，支持多平台

## 输入
- config: SandboxConfig

## 输出
- sandbox: SandboxInterface

## 前置条件
- [ ] platform-detect gate passed
- [ ] config-validate gate passed

## 实现步骤
1. 检测平台
2. 选择对应实现
3. 初始化沙箱
4. 返回实例

## 示例
```typescript
const sandbox = await createSandbox({
  mode: "non-main",
  network: { enabled: true }
});
```

## 验证
- [ ] 返回有效的沙箱实例
- [ ] 平台匹配正确
```

---

### 4.2 sandbox-execute.md

```markdown
# 任务：执行沙箱命令

## 描述
在沙箱中安全执行命令

## 输入
- sandbox: SandboxInterface
- command: string
- cwd: string
- options?: ExecuteOptions

## 输出
- result: ExecuteResult

## 前置条件
- [ ] sandbox-init gate passed

## 安全策略
- 网络隔离检查
- 文件系统权限检查
- 资源限制检查

## 实现步骤
1. 验证命令安全性
2. 准备沙箱环境
3. 执行命令
4. 收集输出
5. 清理资源

## 示例
```typescript
const result = await executeInSandbox(
  sandbox,
  "npm install",
  "/Users/user/project",
  { timeout: 300 }
);
```

## 验证
- [ ] 命令在隔离环境执行
- [ ] 网络访问符合配置
- [ ] 文件访问符合配置
- [ ] 资源使用在限制内
```

---

### 4.3 sandbox-cleanup.md

```markdown
# 任务：清理沙箱资源

## 描述
清理沙箱占用的资源

## 输入
- sandbox: SandboxInterface

## 输出
- cleanupResult: CleanupResult

## 前置条件
- [ ] 沙箱实例存在

## 实现步骤
1. 停止所有运行中的命令
2. 清理临时文件
3. 释放资源
4. 记录清理日志

## 示例
```typescript
await cleanupSandbox(sandbox);
```

## 验证
- [ ] 所有资源已释放
- [ ] 临时文件已清理
- [ ] 日志已记录
```

---

## 5. state.json 更新

```json
{
  "_schema": "harness-feedback-v2",
  "project": "nuwaclaw-sandbox",
  "version": "2.0.0",
  "lastUpdated": "2026-03-27T06:00:00Z",
  
  "activeTask": "sandbox-integration",
  "taskStatus": "in-progress",
  
  "checkpoints": {
    "CP0_INIT": {
      "status": "completed",
      "timestamp": "2026-03-27T06:00:00Z",
      "duration": 0
    },
    "CP1_PLAN": {
      "status": "completed",
      "timestamp": "2026-03-27T06:00:00Z",
      "duration": 0,
      "tasks": [
        "macos-sandbox",
        "linux-sandbox",
        "windows-sandbox",
        "nodejs-bindings",
        "config-system",
        "ui-integration"
      ]
    },
    "CP2_EXEC": {
      "status": "in-progress",
      "timestamp": "2026-03-27T06:00:00Z",
      "duration": 0,
      "completedTasks": 0,
      "totalTasks": 6
    },
    "CP3_REVIEW": {
      "status": "pending"
    },
    "CP4_GATE": {
      "status": "pending"
    },
    "CP5_DONE": {
      "status": "pending"
    }
  },
  
  "gates": {
    "config-validate": {
      "status": "passed",
      "lastCheck": "2026-03-27T06:00:00Z"
    },
    "platform-detect": {
      "status": "passed",
      "lastCheck": "2026-03-27T06:00:00Z",
      "data": {
        "platforms": ["darwin", "linux", "win32"]
      }
    },
    "sandbox-init": {
      "status": "pending"
    },
    "execute-test": {
      "status": "pending"
    },
    "integration-test": {
      "status": "pending"
    }
  },
  
  "metrics": {
    "tasks": {
      "total": 6,
      "completed": 0,
      "failed": 0,
      "blocked": 0
    },
    "gates": {
      "total": 5,
      "passed": 2,
      "failed": 0
    }
  }
}
```

---

## 6. 实施流程

### 6.1 Phase 1: CP0-CP1 (规划阶段)

**时间**: 1 小时

**任务**:
```bash
# 1. 创建 harness 任务定义
cd crates/agent-electron-client/harness/base/tasks
touch sandbox-create.md
touch sandbox-execute.md
touch sandbox-cleanup.md

# 2. 创建平台配置
cd ../projects
mkdir -p darwin linux win32
touch darwin/sandbox-config.md
touch linux/sandbox-config.md
touch win32/sandbox-config.md

# 3. 创建通用规范
cd ../universal
touch sandbox-api.md
touch sandbox-security.md

# 4. 更新 state.json
# 标记 CP0_INIT 和 CP1_PLAN 为 completed
```

---

### 6.2 Phase 2: CP2 (执行阶段)

**时间**: 6-8 小时

**子任务**:

#### Task 1: macOS Sandbox
```bash
# 1. 创建 Rust 模块
cd crates/nuwax-sandbox/crates/macos-sandbox
# 实现 lib.rs

# 2. 创建 TypeScript 封装
cd ../../agent-electron-client/src/main/services/sandbox
touch MacSandbox.ts
# 实现类

# 3. 测试
npm run test:sandbox:macos
```

#### Task 2: Linux Sandbox
```bash
# 类似 macOS 流程
```

#### Task 3: Windows Sandbox (Codex)
```bash
# 1. 复制 Codex 代码
cp -r /tmp/codex/codex-rs/windows-sandbox-rs crates/nuwax-sandbox/crates/windows-sandbox

# 2. 编译
cargo build --release --target x86_64-pc-windows-msvc

# 3. 集成测试
npm run test:sandbox:windows
```

#### Task 4: Node.js Bindings
```bash
# 1. 配置 napi-rs
cd crates/nuwax-sandbox/bindings
npm install

# 2. 编译
npm run build

# 3. 测试
npm test
```

#### Task 5: 配置系统
```bash
# 1. 实现 SandboxConfigManager
cd crates/agent-electron-client/src/main/services/sandbox
touch SandboxConfigManager.ts

# 2. 创建 UI
cd ../../../renderer/components/settings
touch SandboxSettings.tsx

# 3. 测试
npm run test:config
```

#### Task 6: UI 集成
```bash
# 1. 添加 IPC handlers
cd src/main/ipc
touch sandboxConfigHandlers.ts

# 2. 更新 UI
# 添加沙箱设置页面

# 3. 端到端测试
npm run test:e2e:sandbox
```

---

### 6.3 Phase 3: CP3 (验证阶段)

**时间**: 2 小时

**任务**:
- [ ] 代码审查
- [ ] 文档更新
- [ ] 测试覆盖率检查

---

### 6.4 Phase 4: CP4 (门禁阶段)

**时间**: 1 小时

**任务**:
- [ ] 运行所有 gates
- [ ] 修复失败的 gate
- [ ] 记录结果到 state.json

---

### 6.5 Phase 5: CP5 (完成阶段)

**时间**: 1 小时

**任务**:
- [ ] 最终审查
- [ ] 提交代码
- [ ] 更新文档
- [ ] 发布说明

---

## 7. Harness 命令

### 7.1 初始化任务

```bash
# 初始化沙箱集成任务
npm run harness:init -- --task sandbox-integration
```

### 7.2 执行 CP 工作流

```bash
# 执行 CP1: 规划
npm run harness:cp1 -- --task sandbox-integration

# 执行 CP2: 执行子任务
npm run harness:cp2 -- --task sandbox-integration --subtask macos-sandbox

# 执行 CP3: 验证
npm run harness:cp3 -- --task sandbox-integration

# 执行 CP4: 门禁
npm run harness:cp4 -- --task sandbox-integration

# 执行 CP5: 完成
npm run harness:cp5 -- --task sandbox-integration
```

### 7.3 运行 Gate

```bash
# 运行单个 gate
npm run harness:gate -- --gate config-validate

# 运行所有 gates
npm run harness:gates -- --all
```

### 7.4 查看状态

```bash
# 查看当前状态
npm run harness:status

# 查看 state.json
cat harness/feedback/state/state.json
```

---

## 8. 质量标准

### 8.1 代码质量

- [ ] TypeScript 严格模式
- [ ] ESLint 无错误
- [ ] 代码覆盖率 > 80%

### 8.2 功能质量

- [ ] 所有 gates 通过
- [ ] 跨平台测试通过
- [ ] 性能基准测试通过

### 8.3 文档质量

- [ ] API 文档完整
- [ ] 使用示例清晰
- [ ] 错误处理文档完整

---

## 9. 风险管理

### 9.1 技术风险

| 风险 | 影响 | 缓解措施 |
|------|------|---------|
| Codex 编译失败 | 高 | 提前测试编译环境 |
| 平台兼容性问题 | 中 | 逐平台测试 |
| 性能不达标 | 中 | 性能基准测试 |

### 9.2 时间风险

| 风险 | 影响 | 缓解措施 |
|------|------|---------|
| 子任务超时 | 中 | 增加缓冲时间 |
| 测试发现重大问题 | 高 | 预留修复时间 |

---

## 10. 总结

**Harness 模式优势**:
1. ✅ 标准化的工作流程
2. ✅ 清晰的质量门禁
3. ✅ 可追踪的任务状态
4. ✅ 自动化的质量检查
5. ✅ 完整的审计日志

**实施时间**: 11-13 小时（含缓冲）

---

**文档版本**: 2.0.0
**最后更新**: 2026-03-27
