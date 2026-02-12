# Tauri 应用内置 Node.js 运行时技术方案

## 概述

本文档描述了 Tauri 桌面应用如何实现「用户无需安装 Node.js即可运行」的技术方案。通过将 Node.js 运行时内置打包到应用安装包中，并配合平台特定的环境变量处理策略，实现零配置的用户体验。

## 技术架构

### 整体架构设计

```
┌─────────────────────────────────────────────────────────────────┐
│                    Tauri 桌面应用运行时架构                        │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  ┌───────────────────────────────────────────────────────────┐  │
│  │                      用户空间                              │  │
│  │                                                           │  │
│  │  ┌─────────────────────────────────────────────────────┐  │  │
│  │  │          前端层 (React + TypeScript + Vite)          │  │  │
│  │  │  • 静态资源文件 (HTML、CSS、JavaScript)              │  │  │
│  │  │  • 通过 WebView2 (Windows) / WebKit (macOS) 显示     │  │  │
│  │  │  • 与 Rust 后端通过 IPC 通信                         │  │  │
│  │  └─────────────────────────────────────────────────────┘  │  │
│  │                                                             │  │
│  │  ┌─────────────────────────────────────────────────────┐  │  │
│  │  │          Rust 后端层                                 │  │  │
│  │  │  • 系统原生 API 调用                                 │  │  │
│  │  │  • 插件系统管理                                      │  │  │
│  │  │  • 权限控制                                          │  │  │
│  │  │  • 子进程管理                                        │  │  │
│  │  └─────────────────────────────────────────────────────┘  │  │
│  │                                                             │  │
│  └───────────────────────────────────────────────────────────┘  │
│                                                                  │
│  ┌───────────────────────────────────────────────────────────┐  │
│  │                      资源层                                │  │
│  │                                                           │  │
│  │  ┌───────────────────────┐  ┌───────────────────────────┐│  │
│  │  │  内置 Node.js 运行时   │  │  应用数据目录             ││  │
│  │  │  (平台特定二进制文件)   │  │  (~/.local/share/应用名)  ││  │
│  │  │  • Windows: node.exe  │  │  • 配置文件               ││  │
│  │  │  • macOS: node        │  │  • 日志文件               ││  │
│  │  │  • Linux: node        │  │  • 缓存数据               ││  │
│  │  │  • npm、corepack       │  │  • 插件数据               ││  │
│  │  └───────────────────────┘  └───────────────────────────┘│  │
│  │                                                           │  │
│  └───────────────────────────────────────────────────────────┘  │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

### 打包结构

```
应用安装目录/
├── resources/
│   └── node/                    ← 内置 Node.js 运行时
│       ├── node.exe            ← Windows 可执行文件
│       ├── node                ← macOS/Linux 可执行文件
│       └── lib/
│           ├── node_modules/
│           │   ├── npm/
│           │   └── corepack/
│           └── *.dll / *.so    ← 平台动态链接库
│
├── 应用主程序                   ← Rust 编译的二进制文件 (~5-10MB)
├── 前端静态资源/                 ← Vite 打包的 HTML/JS/CSS
└── 配置文件/                     ← 应用配置
```

## 核心实现原理

### 1. 启动流程与 PATH 修复

Tauri 应用启动时，需要解决 Windows GUI 进程的特殊 PATH 问题。Windows 图形界面应用启动时，默认没有用户 shell（如 CMD、PowerShell）的环境变量，包括关键的 PATH 环境变量。

```rust:crates/agent-tauri-client/src-tauri/src/main.rs
fn main() {
    // 第一步：修复 Windows GUI 进程的 PATH 问题
    // Windows GUI 应用默认没有用户 shell 的 PATH
    // fix-path-env 库会读取注册表中的用户 PATH 设置
    #[cfg(not(any(target_os = "android", target_os = "ios")))]
    let _ = fix_path_env::fix();

    // 第二步：注入内置 Node.js 路径（跨平台统一处理）
    // 此函数会根据平台返回不同的 PATH 字符串
    #[cfg(not(any(target_os = "android", target_os = "ios")))]
    std::env::set_var("PATH", nuwax_agent_core::utils::build_node_path_env());

    // 启动 Tauri 应用主循环
    agent_tauri_client_lib::run()
}
```

### 2. 平台特定的 PATH 构建策略

PATH 环境变量的构建策略在不同平台有显著差异，这是由于各操作系统的应用生态和用户习惯不同所致。

```rust:crates/nuwax-agent-core/src/utils/path_env.rs
/// 构建供 spawn 子进程使用的 PATH 字符串.
///
/// 平台差异说明：
/// - **Windows**：直接返回系统 PATH，不做修改。Windows 用户习惯全局安装
///   Node.js 工具（通过 npm i -g），或者使用内置的 Node.js。
/// - **Unix (macOS/Linux)**：在现有 PATH 前追加 ~/.local/bin。这是因为
///   Unix 用户更倾向于本地安装工具（n、fnm、uv 等），这些工具会将 node
///   安装在用户目录下。
pub fn build_node_path_env() -> String {
    #[cfg(windows)]
    {
        // Windows：直接使用系统 PATH
        // 假设用户已全局安装必要的 Node.js 工具，或使用内置版本
        return std::env::var("PATH").unwrap_or_default();
    }

    #[cfg(not(windows))]
    {
        // Unix：在 PATH 前追加 ~/.local/bin
        // 便于使用本地安装的 node、npm、uv 等工具
        let bin = local_bin_dir();
        let current = std::env::var("PATH").unwrap_or_default();
        format!("{}:{}", bin.to_string_lossy(), current)
    }
}

/// 返回 ~/.local/bin 目录路径（仅 Unix 系统）
fn local_bin_dir() -> PathBuf {
    dirs::home_dir()
        .unwrap_or_else(|| PathBuf::from("."))
        .join(".local")
        .join("bin")
}
```

### 3. 内置 Node.js 的调用方式

应用内部调用 Node.js 时，需要正确设置环境变量，确保子进程能够找到内置的 Node.js 可执行文件。

```rust
use std::process::{Command, Stdio};
use tokio::process::Command as AsyncCommand;

/// 在内置 Node.js 环境下执行命令
///
/// 此函数会：
/// 1. 获取内置 Node.js 的资源目录
/// 2. 构建包含内置 Node 的 PATH 环境变量
/// 3. 执行指定的命令
pub async fn execute_with_bundled_node(
    script: &str,
    args: &[&str],
) -> Result<CommandOutput, CommandError> {
    // 构建包含内置 Node.js 的 PATH
    let node_path = get_bundled_node_path();
    let custom_env = build_spawn_env(node_path);

    // 使用 tokio::process::Command 执行（异步版本）
    let output = AsyncCommand::new("node")
        .envs(custom_env)
        .args(&[script])
        .args(args)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true)
        .output()
        .await?;

    Ok(CommandOutput {
        stdout: String::from_utf8_lossy(&output.stdout).to_string(),
        stderr: String::from_utf8_lossy(&output.stderr).to_string(),
        status: output.status.code(),
    })
}

/// 获取内置 Node.js 的资源目录
fn get_bundled_node_path() -> PathBuf {
    // Tauri 提供了 api::path::resource_dir() 获取资源目录
    // 或者使用 std::env::current_exe() 推算
    #[cfg(windows)]
    {
        // Windows: 从可执行文件路径推算 resources/node
        let exe_path = std::env::current_exe()
            .expect("Failed to get current executable path");
        let resource_dir = exe_path
            .parent()
            .expect("Failed to get parent directory")
            .join("resources")
            .join("node");
        resource_dir
    }

    #[cfg(target_os = "macos")]
    {
        // macOS: 应用在 .app bundle 中，路径结构不同
        let exe_path = std::env::current_exe()
            .expect("Failed to get current executable path");
        // Contents/Resources/resources/node
        let resource_dir = exe_path
            .parent()
            .expect("Failed to get parent directory")
            .parent()
            .expect("Failed to get Contents directory")
            .join("Resources")
            .join("resources")
            .join("node");
        resource_dir
    }

    #[cfg(target_os = "linux")]
    {
        // Linux: 通常在 /usr/share/应用名/resources/node
        let exe_path = std::env::current_exe()
            .expect("Failed to get current executable path");
        let resource_dir = exe_path
            .parent()
            .expect("Failed to get parent directory")
            .join("resources")
            .join("node");
        resource_dir
    }
}

/// 为子进程构建环境变量
fn build_spawn_env(node_path: PathBuf) -> Vec<(String, String)> {
    let mut env = Vec::new();

    // 添加 Node.js 相关路径到 PATH
    #[cfg(windows)]
    {
        let path = std::env::var("PATH").unwrap_or_default();
        env.push(("PATH", format!("{};{}", node_path.display(), path)));
    }
    #[cfg(not(windows))]
    {
        let path = std::env::var("PATH").unwrap_or_default();
        env.push(("PATH", format!("{}:{}", node_path.display(), path)));
    }

    // 设置 NODE_PATH 以便找到内置模块
    let node_modules = node_path.join("lib").join("node_modules");
    if node_modules.exists() {
        env.push(("NODE_PATH", node_modules.display().to_string()));
    }

    // 设置 npm 配置指向内置目录
    #[cfg(windows)]
    {
        env.push(("APPDATA", node_path.join("etc").display().to_string()));
    }

    env
}
```

## 平台特定实现细节

### 1. Windows 平台

Windows 平台的环境变量处理策略相对简单，因为 Windows 用户普遍使用全局安装的 Node.js 工具（通过 `npm i -g` 安装到系统目录）。

```rust
// Windows: 路径构建逻辑
#[cfg(windows)]
pub fn build_node_path_env() -> String {
    // Windows 直接使用系统 PATH
    // fix-path-env 已经修复了 GUI 进程的 PATH 问题
    std::env::var("PATH").unwrap_or_default()
}
```

**Windows 特有的处理机制：**

- **fix-path-env 修复原理**：Windows 注册表中存储了用户的环境变量，包括 PATH。GUI 进程启动时默认不加载这些设置。`fix-path-env` 库会从注册表读取用户 PATH，并设置到当前进程环境。
- **注册表路径**：`HKEY_CURRENT_USER\Environment\Path`
- **安装位置**：`resources/node/node.exe`

```rust
// Windows GUI 进程 PATH 修复的简化逻辑
#[cfg(windows)]
fn fix_windows_gui_path() {
    use winreg::RegKey;

    // 从注册表读取用户 PATH
    let hkcu = RegKey::predef(HKEY_CURRENT_USER);
    let env_key = hkcu.open_subkey(r"Environment").expect("Failed to open env key");
    let user_path: String = env_key.get_value("Path").expect("Failed to read Path");

    // 设置到当前进程
    std::env::set_var("PATH", user_path);
}
```

**Windows 安装目录结构：**

```
C:\Users\<用户名>\AppData\Local\Programs\NuWax\
├── resources/
│   └── node/
│       ├── node.exe
│       ├── npm/
│       └── npx/
├── NuWax.exe
└── resources/
    ├── app.asar          ← 前端静态资源
    └── node/             ← Node.js 运行时
```

### 2. macOS 平台

macOS 平台采用 Unix 风格的处理方式，用户倾向于在本地目录（`~/.local/bin`）安装 Node.js 版本管理工具。

```rust
// macOS: 路径构建逻辑
#[cfg(target_os = "macos")]
pub fn build_node_path_env() -> String {
    // 获取 ~/.local/bin 目录
    let local_bin = dirs::home_dir()
        .unwrap_or_else(|| PathBuf::from("/usr/local"))
        .join(".local")
        .join("bin");

    // 获取当前 PATH
    let current_path = std::env::var("PATH").unwrap_or_default();

    // 将 ~/.local/bin 放在 PATH 最前面
    format!("{}:{}", local_bin.display(), current_path)
}
```

**macOS 特有的处理机制：**

- **应用沙盒**：macOS 应用通常在沙盒中运行，无法直接访问系统目录。Tauri 配置 `com.apple.security.app-sandbox` 后，应用只能访问特定的用户目录。
- **权限请求**：需要声明 `com.apple.security.network.client` 以进行网络请求。
- **hardened runtime**：需要关闭某些系统保护以允许加载动态库。

```json:crates/agent-tauri-client/src-tauri/capabilities/default.json
{
  "identifier": "default",
  "description": "Default capabilities for the main window",
  "windows": ["main"],
  "permissions": [
    {
      "identifier": "path:default",
      "allow": ["$RESOURCE/**"]
    },
    {
      "identifier": "shell:allow",
      "allow": [
        {
          "name": "open",
          "sidecar": false
        }
      ]
    }
  ]
}
```

**macOS 安装目录结构：**

```
/Applications/NuWax.app/
├── Contents/
│   ├── Info.plist
│   ├── MacOS/
│   │   └── NuWax              ← Rust 二进制可执行文件
│   ├── Resources/
│   │   ├── app.asar           ← 前端静态资源
│   │   └── node/              ← Node.js 运行时
│   │       ├── node           ← 可执行文件
│   │       ├── npm/
│   │       └── lib/
│   └── Frameworks/
│       └── WebKit.framework/
```

**macOS 用户辅助脚本：**

```bash
# ~/.local/bin/env (自动创建)
# 用户可以在终端执行 source ~/.local/bin/env
# 或者将此行加入 ~/.zshrc

export PATH="$HOME/.local/bin${PATH:+:$PATH}"
```

### 3. Linux 平台

Linux 平台与 macOS 类似，采用 Unix 风格的处理方式，但需要考虑更多发行版的差异。

```rust
// Linux: 路径构建逻辑
#[cfg(target_os = "linux")]
pub fn build_node_path_env() -> String {
    // 获取 ~/.local/bin 目录
    let local_bin = dirs::home_dir()
        .unwrap_or_else(|| PathBuf::from("/home").join(&whoami::username()))
        .join(".local")
        .join("bin");

    // 获取当前 PATH
    let current_path = std::env::var("PATH").unwrap_or_default();

    // 将 ~/.local/bin 放在 PATH 最前面
    format!("{}:{}", local_bin.display(), current_path)
}
```

**Linux 特有的处理机制：**

- **桌面环境集成**：支持 `.desktop` 文件注册到系统应用菜单。
- **图标处理**：需要 PNG 和 SVG 格式的图标。
- **AppImage 打包**：可选的跨发行版打包格式。
- **Snap/Flatpak**：可选的沙盒打包方式。

```bash
# Linux 安装目录结构
/usr/share/nuwax/
├── nuwax                     ← 二进制主程序
├── resources/
│   ├── app/                  ← 前端资源
│   │   ├── index.html
│   │   └── assets/
│   └── node/                 ← Node.js 运行时
│       ├── node              ← 可执行文件
│       ├── npm/
│       └── lib/
└── share/
    ├── applications/
    │   └── nuwax.desktop     ← 桌面菜单入口
    └── icons/
        └── hicolor/
            └── 512x512/
                └── nuwax.png
```

## 环境变量注入机制

### 1. 进程级环境变量注入

Tauri 应用中的环境变量注入主要通过 Rust 的 `std::env::set_var()` 和子进程的 `env()` 方法实现。

```rust
use std::process::{Command, Stdio};
use tokio::process::Command as AsyncCommand;

/// 设置应用级环境变量
fn setup_app_environment() {
    // 设置当前进程的环境变量（影响所有子进程）
    let bundled_node_path = get_bundled_node_path();

    // 添加内置 Node.js 到 PATH
    #[cfg(windows)]
    {
        let current_path = std::env::var("PATH").unwrap_or_default();
        std::env::set_var("PATH", format!("{};{}", bundled_node_path.display(), current_path));
    }
    #[cfg(not(windows))]
    {
        let current_path = std::env::var("PATH").unwrap_or_default();
        std::env::set_var("PATH", format!("{}:{}", bundled_node_path.display(), current_path));
    }

    // 设置 npm 相关配置
    std::env::set_var("NPM_CONFIG_PREFIX", bundled_node_path.join("npm-global").display().to_string());

    // 设置 NODE_OPTIONS 以优化 Node.js 行为
    std::env::set_var("NODE_OPTIONS", "--no-warnings");
}

/// 在子进程中执行命令时注入环境变量
async fn spawn_subprocess_with_env() -> Result<(), std::io::Error> {
    let bundled_node_path = get_bundled_node_path();

    // 方式一：使用 env() 方法注入单个环境变量
    let output = AsyncCommand::new("npm")
        .env("PATH", format!("{}:$PATH", bundled_node_path.display()))
        .arg("install")
        .arg("-g")
        .arg("some-package")
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .output()
        .await?;

    // 方式二：使用 envs() 方法注入多个环境变量
    let env_vars = vec![
        ("PATH".to_string(), format!("{}:$PATH", bundled_node_path.display())),
        ("NODE_ENV".to_string(), "production".to_string()),
        ("NPM_CONFIG_LOGLEVEL".to_string(), "error".to_string()),
    ];

    let output = AsyncCommand::new("node")
        .envs(env_vars)
        .arg("script.js")
        .output()
        .await?;

    Ok(())
}
```

### 2. Tauri IPC 通信中的环境变量传递

Tauri 应用中，前端 JavaScript 通过 `invoke` 调用 Rust 后端时，环境变量的传递需要特殊处理。

```rust:crates/agent-tauri-client/src-tauri/src/lib.rs
use tauri::{AppHandle, Manager};

// 在 Tauri 命令中访问环境变量
#[tauri::command]
async fn execute_node_script(
    app: AppHandle,
    script_path: String,
    args: Vec<String>,
) -> Result<CommandOutput, String> {
    // 获取内置 Node.js 路径
    let bundled_node_path = get_bundled_node_path(&app);

    // 构建环境变量
    let mut env = std::collections::HashMap::new();
    let current_path = std::env::var("PATH").unwrap_or_default();

    #[cfg(windows)]
    {
        env.insert("PATH".to_string(), format!("{};{}", bundled_node_path.display(), current_path));
    }
    #[cfg(not(windows))]
    {
        env.insert("PATH".to_string(), format!("{}:{}", bundled_node_path.display(), current_path));
    }

    // 设置 Node.js 相关环境变量
    env.insert("NODE_PATH".to_string(), bundled_node_path.join("lib").join("node_modules").display().to_string());
    env.insert("NPM_CONFIG_PREFIX".to_string(), bundled_node_path.join("npm-global").display().to_string());

    // 执行 Node.js 脚本
    let output = tokio::process::Command::new("node")
        .current_dir(get_app_data_dir(&app))
        .envs(&env)
        .args(&args)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .output()
        .await
        .map_err(|e| e.to_string())?;

    Ok(CommandOutput {
        stdout: String::from_utf8_lossy(&output.stdout).to_string(),
        stderr: String::from_utf8_lossy(&output.stderr).to_string(),
        status: output.status.code(),
    })
}

/// 获取应用数据目录（平台特定）
fn get_app_data_dir(app: &AppHandle) -> PathBuf {
    #[cfg(windows)]
    {
        // Windows: %APPDATA%\NuWax
        app.path().app_data_dir().unwrap()
    }
    #[cfg(target_os = "macos")]
    {
        // macOS: ~/Library/Application Support/NuWax
        app.path().app_data_dir().unwrap()
    }
    #[cfg(target_os = "linux")]
    {
        // Linux: ~/.local/share/NuWax
        app.path().app_data_dir().unwrap()
    }
}
```

### 3. 前端 JavaScript 中的环境变量访问

前端代码无法直接访问系统环境变量，但可以通过 Rust 后端获取必要的信息。

```typescript
// 前端通过 invoke 调用 Rust 获取环境变量
import { invoke } from '@tauri-apps/api/core';

// 获取 Node.js 版本信息
async function getNodeVersion(): Promise<string> {
  try {
    const result = await invoke<string>('get_node_version');
    return result;
  } catch (error) {
    console.error('Failed to get Node version:', error);
    return 'unknown';
  }
}

// 在 Rust 后端实现
// #[tauri::command]
// fn get_node_version() -> String {
//     let output = std::process::Command::new("node")
//         .arg("--version")
//         .output()
//         .expect("Failed to execute node --version");
//     String::from_utf8_lossy(&output.stdout).trim().to_string()
// }
```

## 构建与打包配置

### 1. Tauri 资源配置

在 `tauri.conf.json` 中配置需要打包的资源文件：

```json:crates/agent-tauri-client/src-tauri/tauri.conf.json
{
  "bundle": {
    "active": true,
    "targets": "all",
    "identifier": "com.nuwax.agent",
    "icon": [
      "icons/32x32.png",
      "icons/128x128.png",
      "icons/128x128@2x.png",
      "icons/icon.icns",
      "icons/icon.ico"
    ],
    "resources": [
      "resources/node/**/*",
      "resources/lanproxy/**/*"
    ],
    "externalBin": [
      "binaries/nuwax-lanproxy-*"
    ],
    "windows": {
      "webviewInstallMode": {
        "type": "embedBootstrapper"
      },
      "directoryMove": "self"
    },
    "macOS": {
      "entitlements": "entitlements.plist",
      "providerShortName": null,
      "frameworks": [],
      "minimumSystemVersion": "11.0"
    },
    "linux": {
      "desktop": {
        "Name": "Nuwax Agent",
        "Comment": "AI Agent Desktop Application",
        "Keywords": "AI;Agent;Development",
        "Categories": "Development;Utility;"
      }
    }
  }
}
```

### 2. 构建脚本处理资源

```rust:crates/agent-tauri-client/src-tauri/build.rs
fn main() {
    // 运行 Tauri 构建脚本
    tauri_build::build();

    // 可以在这里添加自定义的资源复制逻辑
    // 例如：下载特定版本的 Node.js 到 resources/node/
    println!("cargo:rerun-if-changed=build.rs");
}
```

### 3. 前端构建配置

```typescript:crates/agent-tauri-client/vite.config.ts
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  build: {
    // 输出目录（相对于 vite.config.ts）
    outDir: '../src-tauri/resources/app',
    emptyOutDir: true,
    rollupOptions: {
      output: {
        entryFileNames: 'assets/[name]-[hash].js',
        chunkFileNames: 'assets/[name]-[hash].js',
        assetFileNames: 'assets/[name]-[hash].[ext]',
      },
    },
  },
});
```

## 常见问题与解决方案

### 1. 子进程找不到 node 可执行文件

**症状**：执行 `node -v` 时提示「命令未找到」。

**解决方案**：确保 PATH 环境变量正确设置了内置 Node.js 目录。

```rust
fn verify_node_execution() -> bool {
    let node_path = get_bundled_node_path();
    let node_exe = node_path.join(if cfg!(windows) { "node.exe" } else { "node" });

    if !node_exe.exists() {
        eprintln!("Error: Node executable not found at {:?}", node_exe);
        return false;
    }

    // 验证 node 可执行
    let output = std::process::Command::new(&node_exe)
        .arg("--version")
        .output()
        .expect("Failed to run node --version");

    if !output.status.success() {
        eprintln!("Error: Node failed to execute");
        return false;
    }

    println!("Node version: {}", String::from_utf8_lossy(&output.stdout));
    true
}
```

### 2. Windows 控制台窗口闪烁

**症状**：Windows 上启动 Tauri 应用时会出现短暂的控制台窗口。

**解决方案**：在 `main.rs` 开头添加子系统配置。

```rust:crates/agent-tauri-client/src-tauri/src/main.rs
// Prevents additional console window on Windows in release, DO NOT REMOVE!!
// 在 release 模式下隐藏 Windows 控制台窗口
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    // 应用启动逻辑...
}
```

### 3. PATH 过长导致的问题

**症状**：Windows 上 PATH 环境变量超过 260 字符限制时出现问题。

**解决方案**：使用长路径模式或在注册表中启用长路径。

```rust
#[cfg(windows)]
fn enable_long_path() -> Result<(), std::io::Error> {
    use winreg::RegKey;

    let hkcu = RegKey::predef(HKEY_CURRENT_USER);
    let software = hkcu.open_subkey(r"Software\Microsoft\Windows\CurrentVersion\Explorer")?;
    let mut advanced = software.open_subkey("Advanced")?;

    advanced.set_value("LongPathsEnabled", &1u32)?;
    Ok(())
}
```

### 4. 权限问题

**症状**：macOS 上应用无法访问某些系统资源。

**解决方案**：在 `entitlements.plist` 中声明必要的权限。

```xml:crates/agent-tauri-client/src-tauri/entitlements.plist
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>com.apple.security.app-sandbox</key>
    <true/>
    <key>com.apple.security.files.user-selected.read-write</key>
    <true/>
    <key>com.apple.security.network.client</key>
    <true/>
</dict>
</plist>
```

## 性能优化建议

### 1. 延迟加载 Node.js

对于不需要立即使用 Node.js 的场景，可以采用延迟加载策略：

```rust
use once_cell::sync::Lazy;

static NODE_PATH: Lazy<Option<PathBuf>> = Lazy::new(|| {
    if should_use_bundled_node() {
        Some(get_bundled_node_path())
    } else {
        None
    }
});

async fn execute_node_lazy(script: &str) -> Result<(), std::io::Error> {
    if let Some(node_path) = NODE_PATH.as_ref() {
        // 使用内置 Node.js
        let output = AsyncCommand::new(node_path.join("node"))
            .arg(script)
            .output()
            .await?;
    } else {
        // 使用系统 Node.js
        let output = AsyncCommand::new("node")
            .arg(script)
            .output()
            .await?;
    }
    Ok(())
}
```

### 2. 环境变量缓存

避免频繁构建 PATH 环境变量：

```rust
use std::sync::Mutex;

lazy_static::lazy_static! {
    static ref CACHED_PATH: Mutex<Option<String>> = Mutex::new(None);
}

fn get_cached_node_path() -> String {
    let mut cached = CACHED_PATH.lock().unwrap();
    if let Some(path) = &cached {
        return path.clone();
    }

    let path = build_node_path_env();
    *cached = Some(path.clone());
    path
}
```

## 参考资料

- [Tauri 官方文档 - 资源管理](https://tauri.app/v1/guides/building/resources)
- [Tauri 官方文档 - 环境变量](https://tauri.app/v1/guides/building/environment-variables)
- [fix-path-env-rs 仓库](https://github.com/tauri-apps/fix-path-env-rs)
- [Node.js Windows 指南](https://github.com/microsoft/nodejs-guidelines/blob/master/windows-environment.md)
- [Rust 官方文档 - std::env](https://doc.rust-lang.org/std/env/index.html)
