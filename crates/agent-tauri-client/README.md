# NuWax Agent Tauri 客户端

基于 Tauri 2.0 + React 18 + Ant Design 5 的跨平台桌面客户端应用。

## 快速开始

### 1. 安装必需工具

```bash
# 安装 Tauri CLI（Rust 版本）
cargo install tauri-cli

# 安装 pnpm（如果尚未安装）
npm install -g pnpm
```

### 2. 安装项目依赖

```bash
# 安装前端依赖
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
# 在项目根目录运行
unset CI && make tauri-bundle

# 打包产物位于
# target/release/bundle/macos/agent-tauri-client.app
# target/release/bundle/dmg/agent-tauri-client_0.1.0_aarch64.dmg
```

## 推荐 IDE 配置

- [VS Code](https://code.visualstudio.com/) + [Tauri](https://marketplace.visualstudio.com/items?itemName=tauri-apps.tauri-vscode) + [rust-analyzer](https://marketplace.visualstudio.com/items?itemName=rust-lang.rust-analyzer)

## Makefile 命令

| 命令 | 说明 |
|------|------|
| `make tauri-dev` | 开发模式运行（热重载） |
| `make tauri-bundle` | 打包当前平台应用 |
| `make tauri-bundle-all` | 打包所有平台应用 |

**注意**：运行前建议先执行 `unset CI` 避免环境变量冲突。
