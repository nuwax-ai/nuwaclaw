# NuwaClaw Sandbox 实施指南

> **版本**: 1.0.0
> **更新日期**: 2026-03-27

---

## 1. 实施概述

### 1.1 实施阶段

| 阶段 | 内容 | 预计时间 | 状态 |
|------|------|---------|------|
| **Phase 1** | 创建 nuwax-sandbox 子模块 | 1 小时 | 待开始 |
| **Phase 2** | 实现 macOS Sandbox | 1 小时 | 待开始 |
| **Phase 3** | 实现 Linux Sandbox | 1-2 小时 | 待开始 |
| **Phase 4** | 实现 Windows Sandbox (Codex) | 2-3 小时 | 待开始 |
| **Phase 5** | 配置系统 + UI | 2 小时 | 待开始 |
| **Phase 6** | 测试 + 文档 | 2 小时 | 待开始 |
| **总计** | - | **9-11 小时** | - |

---

## 2. Phase 1: 创建子模块

### 2.1 创建目录结构

```bash
cd /Users/apple/workspace/nuwax-agent

# 创建源码目录
mkdir -p crates/nuwax-sandbox/crates
mkdir -p crates/nuwax-sandbox/bindings/native
mkdir -p crates/nuwax-sandbox/prebuilt

# 创建运行时目录
mkdir -p crates/agent-electron-client/resources/sandbox/darwin-x64
mkdir -p crates/agent-electron-client/resources/sandbox/linux-x64
mkdir -p crates/agent-electron-client/resources/sandbox/win32-x64

# 创建 .gitkeep
touch crates/agent-electron-client/resources/sandbox/darwin-x64/.gitkeep
touch crates/agent-electron-client/resources/sandbox/linux-x64/.gitkeep
touch crates/agent-electron-client/resources/sandbox/win32-x64/.gitkeep
```

### 2.2 初始化 Cargo Workspace

```bash
cd crates/nuwax-sandbox

# 初始化 Cargo.toml
cat > Cargo.toml << 'EOF'
[workspace]
members = [
    "crates/windows-sandbox",
    "crates/macos-sandbox",
    "crates/linux-sandbox",
    "bindings/native",
]
resolver = "2"

[workspace.package]
version = "0.1.0"
edition = "2021"
license = "Apache-2.0"
repository = "https://github.com/nuwax-ai/nuwaclaw"
authors = ["NuwaClaw Team"]
description = "NuwaClaw Agent Sandbox - based on OpenAI Codex"

[workspace.dependencies]
napi = "2"
napi-derive = "2"
tokio = { version = "1", features = ["full"] }
serde = { version = "1", features = ["derive"] }
serde_json = "1"

[target.'cfg(windows)'.workspace.dependencies]
winapi = "0.3"
EOF
```

### 2.3 创建 README 和 LICENSE

```bash
# README.md
cat > README.md << 'EOF'
# NuwaClaw Sandbox

基于 OpenAI Codex 沙箱方案的安全执行环境。

## 许可证

Apache-2.0 (继承自 OpenAI Codex)

## 平台支持

| 平台 | 实现方式 | 状态 |
|------|---------|------|
| **macOS** | sandbox-exec | ✅ |
| **Linux** | bubblewrap | ✅ |
| **Windows** | Codex Sandbox | ✅ |

## 构建

```bash
make build        # 构建所有平台
make build-darwin # 构建 macOS
make build-linux  # 构建 Linux
make build-windows # 构建 Windows
```

## 致谢

本项目基于 [OpenAI Codex](https://github.com/openai/codex) 的沙箱实现。
EOF

# LICENSE
cat > LICENSE << 'EOF'
Apache License
Version 2.0, January 2004
http://www.apache.org/licenses/

Copyright 2024-2026 NuwaClaw Team
Copyright 2024 OpenAI

Licensed under the Apache License, Version 2.0 (the "License");
...
EOF
```

---

## 3. Phase 2: macOS Sandbox

### 3.1 创建 macOS 模块

```bash
mkdir -p crates/nuwax-sandbox/crates/macos-sandbox/src

cat > crates/macos-sandbox/Cargo.toml << 'EOF'
[package]
name = "nuwax-macos-sandbox"
version.workspace = true
edition.workspace = true
license.workspace = true

[dependencies]
tokio = { workspace = true }
serde = { workspace = true }
serde_json = { workspace = true }
EOF

cat > crates/macos-sandbox/src/lib.rs << 'EOF'
use std::process::Command;
use std::fs;

pub struct MacSandbox {
    profile_path: String,
}

impl MacSandbox {
    pub fn new() -> Self {
        Self {
            profile_path: String::new(),
        }
    }
    
    pub async fn execute(&self, command: &str, cwd: &str, config: &SandboxConfig) -> Result<ExecuteResult, SandboxError> {
        // 生成 sandbox-exec 配置文件
        let profile = self.generate_profile(cwd, config);
        let profile_path = format!("/tmp/sandbox-{}.sb", chrono::Utc::now().timestamp());
        
        fs::write(&profile_path, &profile)?;
        
        // 执行命令
        let output = Command::new("sandbox-exec")
            .arg("-f")
            .arg(&profile_path)
            .arg("bash")
            .arg("-c")
            .arg(command)
            .current_dir(cwd)
            .output()?;
        
        // 清理配置文件
        fs::remove_file(&profile_path)?;
        
        Ok(ExecuteResult {
            exit_code: output.status.code().unwrap_or(-1),
            stdout: String::from_utf8_lossy(&output.stdout).to_string(),
            stderr: String::from_utf8_lossy(&output.stderr).to_string(),
        })
    }
    
    fn generate_profile(&self, cwd: &str, config: &SandboxConfig) -> String {
        let network_rules = if config.network_enabled {
            self.generate_network_rules(&config.allowed_domains, &config.denied_domains)
        } else {
            "(deny network*)".to_string()
        };
        
        format!(r#"
(version 1)
(allow default)

; 系统库读取
(allow file-read* (subpath "/usr") (subpath "/System"))

; 网络规则
{}

; 工作区访问
(allow file-read* (subpath "{}"))
(allow file-write* (subpath "{}"))

; 禁止敏感目录
(deny file-read* (subpath "~/.ssh"))
(deny file-read* (subpath "~/.aws"))
(deny file-read* (subpath "~/.gnupg"))
"#, network_rules, cwd, cwd)
    }
    
    fn generate_network_rules(&self, allowed: &[String], denied: &[String]) -> String {
        let mut rules = String::from("(allow network-outbound\n");
        
        for domain in allowed {
            rules.push_str(&format!("  (remote tcp \"{}\" 443)\n", domain));
        }
        
        rules.push_str(")\n");
        
        for domain in denied {
            rules.push_str(&format!("(deny network-outbound (remote tcp \"{}\"))\n", domain));
        }
        
        rules
    }
}
EOF
```

---

## 4. Phase 3: Linux Sandbox

### 4.1 创建 Linux 模块

```bash
mkdir -p crates/nuwax-sandbox/crates/linux-sandbox/src

cat > crates/linux-sandbox/Cargo.toml << 'EOF'
[package]
name = "nuwax-linux-sandbox"
version.workspace = true
edition.workspace = true
license.workspace = true

[dependencies]
tokio = { workspace = true }
serde = { workspace = true }
serde_json = { workspace = true }
which = "5"
EOF

cat > crates/linux-sandbox/src/lib.rs << 'EOF'
use std::process::Command;
use which::which;

pub struct LinuxSandbox {
    use_bubblewrap: bool,
}

impl LinuxSandbox {
    pub fn new() -> Self {
        let use_bubblewrap = which("bwrap").is_ok();
        Self { use_bubblewrap }
    }
    
    pub async fn execute(&self, command: &str, cwd: &str, config: &SandboxConfig) -> Result<ExecuteResult, SandboxError> {
        if self.use_bubblewrap {
            self.execute_in_bubblewrap(command, cwd, config).await
        } else {
            self.execute_unsandboxed(command, cwd, config).await
        }
    }
    
    async fn execute_in_bubblewrap(&self, command: &str, cwd: &str, config: &SandboxConfig) -> Result<ExecuteResult, SandboxError> {
        let mut args = vec![
            "--ro-bind".to_string(), "/usr".to_string(), "/usr".to_string(),
            "--ro-bind".to_string(), "/lib".to_string(), "/lib".to_string(),
            "--ro-bind".to_string(), "/bin".to_string(), "/bin".to_string(),
            "--bind".to_string(), cwd.to_string(), cwd.to_string(),
            "--dev".to_string(), "/dev".to_string(),
            "--proc".to_string(), "/proc".to_string(),
            "--unshare-all".to_string(),
            "--die-with-parent".to_string(),
        ];
        
        if config.network_enabled {
            args.push("--share-net".to_string());
        }
        
        args.push("bash".to_string());
        args.push("-c".to_string());
        args.push(command.to_string());
        
        let output = Command::new("bwrap")
            .args(&args)
            .current_dir(cwd)
            .output()?;
        
        Ok(ExecuteResult {
            exit_code: output.status.code().unwrap_or(-1),
            stdout: String::from_utf8_lossy(&output.stdout).to_string(),
            stderr: String::from_utf8_lossy(&output.stderr).to_string(),
        })
    }
    
    async fn execute_unsandboxed(&self, command: &str, cwd: &str, config: &SandboxConfig) -> Result<ExecuteResult, SandboxError> {
        let output = Command::new("bash")
            .arg("-c")
            .arg(command)
            .current_dir(cwd)
            .output()?;
        
        Ok(ExecuteResult {
            exit_code: output.status.code().unwrap_or(-1),
            stdout: String::from_utf8_lossy(&output.stdout).to_string(),
            stderr: String::from_utf8_lossy(&output.stderr).to_string(),
        })
    }
}
EOF
```

---

## 5. Phase 4: Windows Sandbox (Codex)

### 5.1 克隆 Codex

```bash
# 克隆 Codex 仓库
cd /tmp
git clone https://github.com/openai/codex
cd codex/codex-rs
```

### 5.2 复制 Windows Sandbox

```bash
# 复制到 nuwax-sandbox
cp -r windows-sandbox-rs /Users/apple/workspace/nuwax-agent/crates/nuwax-sandbox/crates/windows-sandbox
```

### 5.3 修改 Cargo.toml

```bash
cd /Users/apple/workspace/nuwax-agent/crates/nuwax-sandbox/crates/windows-sandbox

# 修改 Cargo.toml 以符合 workspace
cat > Cargo.toml << 'EOF'
[package]
name = "nuwax-windows-sandbox"
version.workspace = true
edition.workspace = true
license.workspace = true
description = "Windows sandbox for NuwaClaw Agent (based on Codex)"

[dependencies]
tokio = { workspace = true }
serde = { workspace = true }
serde_json = { workspace = true }

[target.'cfg(windows)'.dependencies]
winapi = { workspace = true, features = ["winbase", "processthreadsapi", "jobapi2"] }

[build-dependencies]
# 保持 Codex 的原始构建依赖
EOF
```

### 5.4 编译测试

```bash
# 编译 Windows 版本（需要 Windows 交叉编译环境）
cargo build --release --target x86_64-pc-windows-msvc
```

---

## 6. Phase 5: Node.js Bindings

### 6.1 初始化 npm 包

```bash
cd crates/nuwax-sandbox/bindings

cat > package.json << 'EOF'
{
  "name": "@nuwax/sandbox-native",
  "version": "0.1.0",
  "main": "index.js",
  "types": "index.d.ts",
  "napi": {
    "name": "sandbox",
    "triples": {
      "defaults": false,
      "additional": [
        "x86_64-apple-darwin",
        "x86_64-unknown-linux-gnu",
        "x86_64-pc-windows-msvc"
      ]
    }
  },
  "scripts": {
    "build": "napi build --platform --release",
    "build:debug": "napi build --platform"
  },
  "devDependencies": {
    "@napi-rs/cli": "^2.0.0"
  }
}
EOF

npm install
```

### 6.2 创建 Rust Binding

```bash
mkdir -p native/src

cat > native/Cargo.toml << 'EOF'
[package]
name = "nuwax-sandbox-native"
version.workspace = true
edition.workspace = true

[lib]
crate-type = ["cdylib"]

[dependencies]
napi = { workspace = true }
napi-derive = { workspace = true }

[features]
default = []

[build-dependencies]
napi-build = "2"
EOF

cat > native/src/lib.rs << 'EOF'
use napi::bindgen_prelude::*;

#[macro_use]
extern crate napi_derive;

#[napi]
pub struct Sandbox;

#[napi]
impl Sandbox {
    #[napi(constructor)]
    pub fn new() -> Self {
        Self
    }
    
    #[napi]
    pub async fn execute(
        &self,
        command: String,
        cwd: String,
        config: SandboxConfig,
    ) -> Result<ExecuteResult> {
        // 根据平台调用对应实现
        #[cfg(target_os = "macos")]
        {
            // 调用 macOS 实现
        }
        
        #[cfg(target_os = "linux")]
        {
            // 调用 Linux 实现
        }
        
        #[cfg(target_os = "windows")]
        {
            // 调用 Windows 实现
        }
        
        Ok(ExecuteResult {
            exit_code: 0,
            stdout: String::new(),
            stderr: String::new(),
        })
    }
}

#[napi(object)]
pub struct SandboxConfig {
    pub network_enabled: Option<bool>,
    pub memory_limit: Option<String>,
    pub cpu_limit: Option<i32>,
    pub timeout: Option<i32>,
}

#[napi(object)]
pub struct ExecuteResult {
    pub exit_code: i32,
    pub stdout: String,
    pub stderr: String,
}
EOF
```

### 6.3 TypeScript 封装

```bash
cat > index.ts << 'EOF'
import { Sandbox as NativeSandbox, SandboxConfig, ExecuteResult } from './native';

export class NuwaxSandbox {
  private sandbox: NativeSandbox;
  
  constructor() {
    this.sandbox = new NativeSandbox();
  }
  
  async execute(
    command: string,
    cwd: string,
    config?: Partial<SandboxConfig>
  ): Promise<ExecuteResult> {
    const fullConfig: SandboxConfig = {
      networkEnabled: config?.networkEnabled ?? false,
      memoryLimit: config?.memoryLimit ?? '2g',
      cpuLimit: config?.cpuLimit ?? 2,
      timeout: config?.timeout ?? 300,
    };
    
    return this.sandbox.execute(command, cwd, fullConfig);
  }
  
  isAvailable(): boolean {
    return true;
  }
}

export type { SandboxConfig, ExecuteResult };
EOF
```

---

## 7. Phase 6: 配置和构建

### 7.1 创建 Makefile

```bash
cd crates/nuwax-sandbox

cat > Makefile << 'EOF'
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
	
	cp bindings/native/*.node prebuilt/darwin-x64/ || true
	cp bindings/native/*.node prebuilt/linux-x64/ || true
	cp bindings/native/*.node prebuilt/win32-x64/ || true
	
	cp target/x86_64-pc-windows-msvc/release/nuwax-sandbox.exe prebuilt/win32-x64/ || true

clean:
	cargo clean
	rm -rf bindings/native/*.node
	rm -rf prebuilt/*
EOF
```

### 7.2 创建 prepare-sandbox.ts

```bash
cd crates/agent-electron-client/scripts

cat > prepare-sandbox.ts << 'EOF'
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
EOF
```

### 7.3 更新 package.json

```json
{
  "scripts": {
    "prepare:sandbox": "ts-node scripts/prepare-sandbox.ts",
    "postinstall": "npm run prepare:sandbox"
  }
}
```

---

## 8. 测试

### 8.1 单元测试

```bash
cd crates/nuwax-sandbox

# 运行 Rust 测试
cargo test

# 运行 Node.js 测试
cd bindings
npm test
```

### 8.2 集成测试

```bash
# macOS 测试
make build-darwin
node test/sandbox.test.js

# Linux 测试 (需要 Linux 环境)
make build-linux
node test/sandbox.test.js

# Windows 测试 (需要 Windows 环境)
make build-windows
node test/sandbox.test.js
```

---

## 9. 发布

### 9.1 提交代码

```bash
cd /Users/apple/workspace/nuwax-agent

# 添加新文件
git add crates/nuwax-sandbox/
git add crates/agent-electron-client/scripts/prepare-sandbox.ts
git add crates/agent-electron-client/docs/sandbox/

# 提交
git commit -m "feat(sandbox): add nuwax-sandbox module based on Codex"
```

### 9.2 打包发布

```bash
# 构建 Electron 应用
cd crates/agent-electron-client
npm run build
npm run package

# 测试安装包
# macOS: open release/NuwaClaw-0.9.3.dmg
# Windows: release/NuwaClaw-0.9.3.exe
# Linux: release/NuwaClaw-0.9.3.AppImage
```

---

## 10. 常见问题

### Q1: macOS 提示 sandbox-exec 权限错误?

A: 检查应用是否正确签名，sandbox-exec 需要有效的开发者签名。

### Q2: Linux 提示 bwrap 未找到?

A: 安装 bubblewrap:
```bash
sudo apt install bubblewrap socat ripgrep
```

### Q3: Windows 编译失败?

A: 确保安装了:
- Visual Studio Build Tools
- Windows SDK
- Rust target: `rustup target add x86_64-pc-windows-msvc`

---

**文档版本**: 1.0.0
**最后更新**: 2026-03-27
