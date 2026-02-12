# Nuwax Agent Tauri 客户端

基于 Tauri 2.0 + React 18 + Ant Design 5 的跨平台桌面客户端应用。

## 快速开始

以下涉及 `make` 的命令均在 **nuwax-agent 仓库根目录** 执行（即包含 `crates/agent-tauri-client` 的上级目录）。

### 1. 安装必需工具

```bash
# 安装 Tauri CLI（Rust 版本）
cargo install tauri-cli

# 安装 pnpm（如果尚未安装）
npm install -g pnpm
```

### 2. 安装项目依赖

```bash
# 在仓库根目录下，进入本 crate 安装前端依赖
cd crates/agent-tauri-client
pnpm install
```

### 3. 运行开发模式

```bash
# 在项目根目录运行（自动进入 src-tauri 目录）
unset CI && make tauri-dev

# 或手动进入目录运行
cd crates/agent-tauri-client/src-tauri
unset CI && cargo tauri dev
```

### 4. 打包发布

```bash
# 在仓库根目录运行
unset CI && make tauri-bundle

# 打包产物位于 target/release/bundle/，例如：
# - macos/agent-tauri-client.app
# - dmg/agent-tauri-client_<version>_aarch64.dmg（Apple Silicon）或 _x64.dmg（Intel）
```

发布到 GitHub Releases 后，需在 **docs 项目** 执行 `make update-release` 并部署，用户端才能检测到新版本（见下方「自动更新与版本检查」）。

## 推荐 IDE 配置

- [VS Code](https://code.visualstudio.com/) + [Tauri](https://marketplace.visualstudio.com/items?itemName=tauri-apps.tauri-vscode) + [rust-analyzer](https://marketplace.visualstudio.com/items?itemName=rust-lang.rust-analyzer)

## Makefile 命令

在 **nuwax-agent 仓库根目录** 执行：

| 命令 | 说明 |
|------|------|
| `make tauri-dev` | 开发模式运行（热重载） |
| `make tauri-bundle` | 打包当前平台应用（默认生产环境） |
| `make tauri-bundle-test` | 打包当前平台（测试环境） |
| `make tauri-bundle-prod` | 打包当前平台（生产环境） |
| `make tauri-bundle-all` | 打包所有平台（macOS/Windows/Linux） |

**注意**：运行前建议先执行 `unset CI` 避免环境变量冲突。

## 自动更新与版本检查

客户端通过 Tauri 插件检查更新，配置在 `src-tauri/tauri.conf.json` 的 `plugins.updater.endpoints`，当前指向：

- **当前使用**：`https://nuwax.com/releases/latest/download/latest.json`

该文件并非由 nuwax.com 自动生成，而是**从 GitHub 手动同步**的。

### 原始数据源

- **来源地址**：<https://github.com/nuwax-ai/nuwax-agent-client/releases/latest/download/latest.json>
- 每次在 GitHub 发布新版本后，需把上述 `latest.json` 同步到对外域名，客户端才能检测到新版本。

### 如何同步

同步通过 **docs 项目** 的 Makefile 完成（例如项目路径：`git_work/docs`）：

```bash
cd /path/to/docs   # 如 ~/git_work/docs
make update-release
```

该命令会：

1. 从 GitHub 下载 `latest.json` 到 `public/releases/latest/download/latest.json`
2. 部署 docs 后，即可通过 `https://nuwax.com/releases/latest/download/latest.json` 访问

因此发布新版本后，在 docs 项目里执行一次 `make update-release` 并完成部署，用户端才能收到更新提示。
