# NuwaClaw Agent 沙箱架构设计

> **版本**: 1.0.1
> **更新日期**: 2026-04-10
> **状态**: 设计完成，待实施

---

## 1. 概述

### 1.1 目标

为 NuwaClaw Agent Electron 客户端提供一个**安全、可配置、开箱即用**的沙箱执行环境。

### 1.2 设计原则

| 原则 | 说明 | 实现方式 |
|------|------|---------|
| **多平台支持** | macOS / Linux / Windows | 各平台独立实现 |
| **可配置** | 用户可控制是否启用 | 四种模式配置 |
| **开箱即用** | 无需手动安装依赖 | 预编译 + 系统内置 |
| **渐进增强** | 自动选择最优方案 | 平台检测 + 降级 |
| **安全隔离** | 保护用户系统安全 | 系统级沙箱 |

---

## 2. 架构设计

### 2.1 整体架构

```
┌─────────────────────────────────────────────────────────────┐
│                    NuwaClaw 沙箱架构                          │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  Layer 1: 配置管理 (SandboxConfig)                           │
│  ├─ 模式: off / on-demand / non-main / all                  │
│  ├─ 存储: electron-store                                    │
│  └─ UI: 设置界面 + 首次引导                                  │
│                                                              │
│  Layer 2: 平台检测 (PlatformDetector)                        │
│  ├─ 检测操作系统                                             │
│  ├─ 检测可用沙箱技术                                         │
│  └─ 选择最优实现                                             │
│                                                              │
│  Layer 3: 沙箱实现 (SandboxInterface)                        │
│  ├─ macOS: sandbox-exec (系统内置)                          │
│  ├─ Linux: bubblewrap (系统可用)                            │
│  ├─ Windows: Codex Sandbox (预编译二进制)                   │
│  └─ None: 无沙箱 (关闭模式)                                 │
│                                                              │
│  Layer 4: 权限管理 (PermissionManager)                       │
│  ├─ 权限检查                                                 │
│  ├─ 用户审批                                                 │
│  └─ 审计日志                                                 │
│                                                              │
└─────────────────────────────────────────────────────────────┘
```

### 2.2 目录结构

```
nuwax-agent/
├── crates/
│   ├── nuwax-sandbox/              # 沙箱源码（独立维护）
│   │   ├── Cargo.toml
│   │   ├── README.md
│   │   ├── LICENSE (Apache-2.0)
│   │   │
│   │   ├── crates/
│   │   │   ├── windows-sandbox/    # Windows 实现（基于 Codex）
│   │   │   │   ├── Cargo.toml
│   │   │   │   ├── src/
│   │   │   │   │   ├── lib.rs
│   │   │   │   │   ├── sandbox.rs
│   │   │   │   │   ├── process.rs
│   │   │   │   │   └── network.rs
│   │   │   │   └── tests/
│   │   │   │
│   │   │   ├── macos-sandbox/      # macOS 封装
│   │   │   └── linux-sandbox/      # Linux 封装
│   │   │
│   │   ├── bindings/               # Node.js 绑定
│   │   │   ├── package.json
│   │   │   ├── native/             # .gitignore
│   │   │   └── index.ts            # TypeScript 封装
│   │   │
│   │   └── prebuilt/               # 预编译产物（入库）
│   │       ├── darwin-x64/
│   │       ├── linux-x64/
│   │       └── win32-x64/
│   │           ├── index.node
│   │           └── nuwax-sandbox.exe
│   │
│   └── agent-electron-client/
│       ├── docs/sandbox/           # 沙箱文档
│       │   ├── ARCHITECTURE.md     # 本文档
│       │   ├── IMPLEMENTATION.md   # 实施指南
│       │   └── API.md              # API 文档
│       │
│       ├── scripts/
│       │   └── prepare-sandbox.ts  # 复制预编译产物
│       │
│       └── resources/
│           └── sandbox/            # 运行时产物（不入库）
│               ├── darwin-x64/
│               ├── linux-x64/
│               └── win32-x64/
│                   └── nuwax-sandbox.exe
```

---

## 3. 平台实现方案

### 3.1 macOS: sandbox-exec

**技术**: Seatbelt (sandbox-exec)

**优势**:
- ✅ 系统内置（macOS 10.5+）
- ✅ 零依赖
- ✅ 性能最优（~5% 开销）

**配置示例**:
```scheme
(version 1)
(allow default)

; 允许网络访问（白名单）
(allow network-outbound
  (remote tcp "github.com" 443)
  (remote tcp "npmjs.org" 443)
)

; 工作区读写
(allow file-read* (subpath "/Users/.../workspace"))
(allow file-write* (subpath "/Users/.../workspace"))

; 禁止敏感目录
(deny file-read* (subpath "~/.ssh"))
(deny file-read* (subpath "~/.aws"))
```

**开箱即用**: ⭐⭐⭐⭐⭐

---

### 3.2 Linux: bubblewrap

**技术**: bubblewrap (bwrap)

**优势**:
- ✅ 主流发行版可用
- ✅ 轻量级（~5% 开销）
- ✅ 命名空间隔离

**依赖安装**:
```bash
# Debian/Ubuntu
sudo apt install bubblewrap socat ripgrep

# Fedora
sudo dnf install bubblewrap socat ripgrep

# Arch Linux
sudo pacman -S bubblewrap socat ripgrep
```

**执行示例**:
```bash
bwrap \
  --ro-bind /usr /usr \
  --bind /workspace /workspace \
  --unshare-all \
  --die-with-parent \
  bash -c "command"
```

**开箱即用**: ⭐⭐⭐⭐

---

### 3.3 Windows: Codex Sandbox

**技术**: Rust + Windows API

**来源**: OpenAI Codex (Apache-2.0)

**优势**:
- ✅ 完整复用 Codex 实现
- ✅ 预编译二进制
- ✅ Windows 原生 API

**实现特性**:
- Job Objects (进程管理)
- Restricted Tokens (权限限制)
- Network Proxy (网络过滤)
- Seccomp-like (系统调用过滤)

**开箱即用**: ⭐⭐⭐⭐⭐ (预编译提供)

---

## 4. 配置系统

### 4.1 沙箱模式

#### 启用/禁用（SandboxPolicy）

| 模式 | 主会话 | 其他会话 | 安全性 | 便利性 | 适用场景 |
|------|--------|---------|--------|--------|---------|
| **off** | 无沙箱 | 无沙箱 | ⭐ | ⭐⭐⭐⭐⭐ | 完全信任环境 |
| **on-demand** | 询问 | 询问 | ⭐⭐⭐⭐ | ⭐⭐⭐⭐ | 混合场景 |
| **non-main** ⭐ | 无沙箱 | 有沙箱 | ⭐⭐⭐⭐ | ⭐⭐⭐⭐⭐ | **推荐默认** |
| **all** | 有沙箱 | 有沙箱 | ⭐⭐⭐⭐⭐ | ⭐⭐⭐ | 高安全需求 |

#### 严格度模式（SandboxMode）

> v0.10+ 新增，跨平台统一接口，各平台实现语义有差异。

| Mode | 说明 | 默认 |
|------|------|------|
| **compat** | 兼容优先，平衡安全与可用性 | ✅ 默认 |
| **strict** | 最小权限，最大限制 | |
| **permissive** | 宽松模式，仅排障用途 | |

**各平台实现差异**：

| 平台 | strict | compat | permissive |
|------|--------|--------|-----------|
| Linux (bwrap) | 最小 ro-bind：仅 `/usr` `/bin` `/sbin` `/lib` `/lib64` `/etc` `/opt` `/usr/local` | 全局 ro-bind `--ro-bind / /` | 完整 rw bind，无 namespace 隔离 |
| macOS (seatbelt) | exec allowlist 仅命令本身 | exec allowlist 含启动链 | 全局 file-write + unrestricted process-exec |
| Windows (helper) | `writable_roots` 仅项目 workspace | 全部 `writable_roots` | 全部 `writable_roots` + `--no-write-restricted`（仅 run 子命令） |

> `nuwaxcode` 在 strict 模式下还包含 ACP 权限层的二次写入门控（`strictPermissionGuard`）：
> 写入路径必须位于 `workspace/temp/appData`，路径缺失时 fail-closed，写入权限仅 `allow_once`。
>
> `nuwaxcode` warmup 复用同样受 sandbox policy 约束：warmup 会记录 policy 指纹，
> 当用户修改 sandbox mode/policy 后，若指纹不一致则立即放弃复用并冷启动新引擎。

### 4.2 配置结构

```typescript
interface SandboxConfig {
  // 沙箱类型
  type: SandboxType;
  // 运行平台
  platform: Platform;
  // 是否启用
  enabled: boolean;
  // 工作区根目录
  workspaceRoot: string;
  // 沙箱严格度模式（v0.10+）
  mode?: "strict" | "compat" | "permissive";

  // 网络策略
  networkEnabled?: boolean;

  // 资源限制
  memoryLimit?: string;
  cpuLimit?: number;
  diskQuota?: string;
}
```

### 4.3 默认配置

```typescript
const DEFAULT_SANDBOX_CONFIG: SandboxConfig = {
  mode: "non-main",
  
  platform: {
    darwin: { enabled: true, type: "seatbelt" },
    linux: { enabled: true, type: "bubblewrap" },
    win32: { enabled: true, type: "codex" },
  },
  
  network: {
    enabled: true,
    allowedDomains: [
      "github.com",
      "*.github.com",
      "npmjs.org",
      "registry.npmjs.org",
      "pypi.org",
    ],
    deniedDomains: [],
  },
  
  filesystem: {
    allowRead: ["."],
    denyRead: ["~/.ssh", "~/.aws", "~/.gnupg"],
    allowWrite: [".", "/tmp"],
    denyWrite: [".env", "*.pem", "*.key"],
  },
  
  resources: {
    memory: "2g",
    cpu: 2,
    timeout: 300,
  },
  
  preferences: {
    showNotifications: true,
    askForDangerousOps: true,
    auditLogging: true,
  },
};
```

---

## 5. 统一 API

### 5.1 SandboxInterface

```typescript
interface SandboxInterface {
  // 初始化沙箱
  initialize(config: SandboxConfig): Promise<void>;
  
  // 执行命令
  execute(
    command: string,
    cwd: string,
    options?: ExecuteOptions
  ): Promise<ExecuteResult>;
  
  // 文件操作
  readFile(sessionId: string, path: string): Promise<string>;
  writeFile(sessionId: string, path: string, content: string): Promise<void>;
  
  // 状态查询
  isAvailable(): Promise<boolean>;
  getStatus(): SandboxStatus;
  
  // 生命周期
  cleanup(): Promise<void>;
}

interface ExecuteOptions {
  timeout?: number;
  signal?: AbortSignal;
  onOutput?: (data: string) => void;
}

interface ExecuteResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

interface SandboxStatus {
  available: boolean;
  type: "seatbelt" | "bubblewrap" | "codex" | "none";
  platform: string;
  version?: string;
}
```

### 5.2 自动选择实现

```typescript
class AutoSandbox implements SandboxInterface {
  private sandbox: SandboxInterface;
  
  async initialize(config: SandboxConfig): Promise<void> {
    const platform = os.platform();
    
    switch (platform) {
      case "darwin":
        this.sandbox = new MacSandbox();
        break;
      case "linux":
        this.sandbox = new LinuxSandbox();
        break;
      case "win32":
        this.sandbox = new WindowsSandbox();
        break;
      default:
        this.sandbox = new NoneSandbox();
    }
    
    await this.sandbox.initialize(config);
  }
  
  // 代理所有接口方法...
}
```

---

## 6. 构建和发布

### 6.1 构建流程

```bash
# 1. 构建 Rust 沙箱（所有平台）
cd crates/nuwax-sandbox
make build

# 或构建特定平台
make build-darwin
make build-linux
make build-windows

# 2. 复制到预编译目录
make prebuilt

# 3. 准备 Electron 资源
cd ../agent-electron-client
npm run prepare:sandbox
```

### 6.2 Makefile

```makefile
# crates/nuwax-sandbox/Makefile

.PHONY: build clean prebuilt

build:
	cargo build --release
	cd bindings && npm run build

build-darwin:
	cargo build --release --target x86_64-apple-darwin
	cd bindings && npm run build -- --target x86_64-apple-darwin

build-linux:
	cargo build --release --target x86_64-unknown-linux-gnu
	cd bindings && npm run build -- --target x86_64-unknown-linux-gnu

build-windows:
	cargo build --release --target x86_64-pc-windows-msvc
	cd bindings && npm run build -- --target x86_64-pc-windows-msvc

prebuilt: build
	mkdir -p prebuilt/darwin-x64
	mkdir -p prebuilt/linux-x64
	mkdir -p prebuilt/win32-x64
	
	cp target/release/nuwax-sandbox prebuilt/darwin-x64/ || true
	cp target/release/nuwax-sandbox prebuilt/linux-x64/ || true
	cp target/x86_64-pc-windows-msvc/release/nuwax-sandbox.exe prebuilt/win32-x64/ || true
	
	cp bindings/native/*.node prebuilt/darwin-x64/ || true
	cp bindings/native/*.node prebuilt/linux-x64/ || true
	cp bindings/native/*.node prebuilt/win32-x64/ || true

clean:
	cargo clean
	rm -rf bindings/native/*.node
	rm -rf prebuilt/*
```

### 6.3 prepare-sandbox.ts

```typescript
// scripts/prepare-sandbox.ts

import * as fs from "fs";
import * as path from "path";

const SANDBOX_SRC = path.join(__dirname, "..", "..", "nuwax-sandbox", "prebuilt");
const SANDBOX_DEST = path.join(__dirname, "..", "resources", "sandbox");

const PLATFORM = process.platform;
const ARCH = process.arch;

function prepareSandbox(): void {
  const sourceDir = path.join(SANDBOX_SRC, `${PLATFORM}-${ARCH}`);
  const targetDir = path.join(SANDBOX_DEST, `${PLATFORM}-${ARCH}`);
  
  fs.mkdirSync(targetDir, { recursive: true });
  
  if (fs.existsSync(sourceDir)) {
    const files = fs.readdirSync(sourceDir);
    files.forEach(file => {
      fs.copyFileSync(
        path.join(sourceDir, file),
        path.join(targetDir, file)
      );
    });
    console.log(`✅ Sandbox binaries copied for ${PLATFORM}-${ARCH}`);
  } else {
    console.log(`ℹ️ No sandbox binaries needed for ${PLATFORM}-${ARCH}`);
    fs.writeFileSync(path.join(targetDir, ".gitkeep"), "");
  }
}

prepareSandbox();
```

---

## 7. 许可证

### 7.1 许可证兼容性

| 项目 | 许可证 | 兼容性 |
|------|--------|--------|
| **Codex** | Apache-2.0 | ✅ |
| **NuwaClaw** | Apache-2.0 / MIT | ✅ |
| **nuwax-sandbox** | Apache-2.0 | ✅ |

### 7.2 版权声明

```
Copyright 2024-2026 NuwaClaw Team

Licensed under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License.
You may obtain a copy of the License at

    http://www.apache.org/licenses/LICENSE-2.0

---

This project includes code from OpenAI Codex:
https://github.com/openai/codex

Original copyright notice:
Copyright 2024 OpenAI

Licensed under the Apache License, Version 2.0
```

---

## 8. 致谢

本沙箱方案基于以下开源项目：

- **OpenAI Codex** - Windows Sandbox 实现
- **Anthropic** - @anthropic-ai/sandbox-runtime
- **LobsterAI** - QEMU 虚拟机沙箱参考
- **pi-mono** - 配置系统参考

---

## 9. 参考

- [OpenAI Codex](https://github.com/openai/codex)
- [Anthropic Sandbox Runtime](https://www.npmjs.com/package/@anthropic-ai/sandbox-runtime)
- [LobsterAI 本地源码](/Users/apple/workspace/LobsterAI)
- [pi-mono 本地源码](/Users/apple/workspace/pi-mono)
- [macOS Seatbelt](https://developer.apple.com/documentation/security/app_sandbox)
- [bubblewrap](https://github.com/containers/bubblewrap)

---

**文档版本**: 1.0.0
**最后更新**: 2026-03-27
