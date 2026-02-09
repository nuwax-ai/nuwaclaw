# 应用内依赖完全隔离方案

## 概述

所有 npm 包安装、命令查找、缓存目录全部走应用本地目录，与系统全局完全隔离。确保应用不污染用户系统环境，也不受系统环境影响。

## 核心机制

通过进程环境变量将 Tauri 侧计算的路径信息传递给 rcoder 和 nuwax-agent-core（它们无法访问 Tauri AppHandle）。

### 环境变量一览

| 环境变量 | 用途 | 示例值 |
|---------|------|--------|
| `NUWAX_LOCAL_PATH_ENV` | 自定义 PATH，优先本地 bin | `<bundled_node>/bin:<app_data>/uv/bin:<app_data>/node_modules/.bin:$PATH` |
| `NUWAX_LOCAL_NPM_PREFIX` | npm `--prefix` 目录 | `<app_data_dir>` |
| `NUWAX_BUNDLED_NPM_PATH` | 打包的 npm 可执行文件路径 | `<resource_dir>/node/bin/npm` |
| `NUWAX_NPM_CACHE_DIR` | npm 缓存目录 | `<app_data_dir>/npm-cache` |
| `NUWAX_UV_CACHE_DIR` | uv/uvx 缓存目录 | `<app_data_dir>/uv-cache` |

### 目录结构

```
<app_data_dir>/                          # ~/Library/Application Support/com.nuwax.agent-tauri-client (macOS)
├── package.json
├── node_modules/                        # npm --prefix 安装目标
│   └── .bin/                            # 可执行文件
│       ├── nuwaxcode
│       ├── nuwax-file-server
│       └── claude-code-acp
├── uv/
│   └── bin/
│       ├── uv                           # uv 可执行文件
│       └── uvx                          # uvx 可执行文件
├── uv-cache/                            # UV_CACHE_DIR
├── npm-cache/                           # NPM_CONFIG_CACHE
└── ...

<resource_dir>/                          # Tauri 打包资源目录（只读）
└── node/
    └── bin/
        ├── node                         # 打包的 Node.js
        └── npm                          # 打包的 npm
```

### PATH 优先级

`build_local_path_env()` 构建的 PATH 顺序（优先级从高到低）：

1. `<resource_dir>/node/bin` — 打包的 Node.js
2. `<app_data_dir>/uv/bin` — 本地安装的 uv/uvx
3. `<app_data_dir>/node_modules/.bin` — 本地 npm 包的可执行文件
4. 系统 PATH — 兜底

---

## 改动范围

### 1. Tauri 启动时设置环境变量

**文件**: `crates/agent-tauri-client/src-tauri/src/lib.rs`

- `build_local_path_env(app)` — 构建本地 PATH 字符串
- `setup_wizard()` — 设置所有 5 个 `NUWAX_*` 环境变量，创建 `npm-cache`、`uv-cache` 目录
- `uv_auto_install()` — 安装 uv 到 `<app_data_dir>/uv/bin/`，安装后更新 `NUWAX_LOCAL_PATH_ENV`

### 2. AgentInstaller trait 感知本地 PATH

**文件**: `vendors/rcoder/crates/agent_config/src/installer/traits.rs`

| 方法 | 改动 |
|------|------|
| `command_exists()` | `which::which()` → `which::which_in(command, NUWAX_LOCAL_PATH_ENV, ".")` |
| `run_command()` | 注入 `PATH=NUWAX_LOCAL_PATH_ENV` 和 `NPM_CONFIG_CACHE=NUWAX_NPM_CACHE_DIR` 到子进程 |

### 3. NpmInstaller 全部改为本地安装

**文件**: `vendors/rcoder/crates/agent_config/src/installer/npm_installer.rs`

| 方法 | Before | After |
|------|--------|-------|
| `get_npm_command()` | 系统 npm | 优先 `NUWAX_BUNDLED_NPM_PATH` |
| `install()` | `npm install -g <pkg>` | `npm install --prefix <NUWAX_LOCAL_NPM_PREFIX> <pkg>` |
| `validate()` | `npm list -g <pkg>` | `npm list --prefix <NUWAX_LOCAL_NPM_PREFIX> <pkg>` |
| `update()` | `npm update -g <pkg>` | `npm install --prefix <NUWAX_LOCAL_NPM_PREFIX> <pkg>@latest` |

### 4. AgentInstallationManager 感知本地 PATH

**文件**: `vendors/rcoder/crates/agent_config/src/installer/manager.rs`

| 方法 | 改动 |
|------|------|
| `is_command_available()` | `which::which()` → `which::which_in(command, NUWAX_LOCAL_PATH_ENV, ".")` |
| `run_validation_command()` | 注入 `PATH=NUWAX_LOCAL_PATH_ENV` 到验证命令子进程 |

### 5. NpmToolInstaller 全部改为本地安装

**文件**: `crates/nuwax-agent-core/src/dependency/npm_tools.rs`

| 方法 | 改动 |
|------|------|
| `detect_in_path()` | `which::which()` → `which::which_in()` |
| `get_npm_path()` | 优先 `NUWAX_BUNDLED_NPM_PATH` |
| `npm_command()` | 创建 Command 并注入 PATH + NPM_CONFIG_CACHE |
| `get_local_prefix()` | 读取 `NUWAX_LOCAL_NPM_PREFIX` |
| `install_tool()` | `npm install -g` → `npm install --prefix` |
| `uninstall_tool()` | `npm uninstall -g` → `npm uninstall --prefix` |
| `update_tool()` | `npm update -g` → `npm install --prefix <pkg>@latest` |
| `check_npm_local()` / `check_tool()` / `get_tool_version()` | `npm list -g` → `npm list --prefix` |

### 6. 消除 unsafe 指针转换

**文件**: `crates/nuwax-agent-core/src/dependency/detector.rs` + `manager.rs`

- 在 `ToolInstaller` trait 添加 `check_tool_with_fallback()` 默认方法
- `NpmToolInstaller` override 该方法实现 npm local 回退检查
- `DependencyManager::check_tool_with_fallback()` 直接调用 trait 方法，删除 unsafe 块

### 7. Agent 子进程注入隔离环境

**文件**: `vendors/rcoder/crates/agent_abstraction/src/launcher/claude_code_sacp.rs`

在 `launch()` 方法中，Agent 子进程启动时注入：

| 注入的环境变量 | 来源 |
|---------------|------|
| `PATH` | `start_config.local_path_env`（来自 `NUWAX_LOCAL_PATH_ENV`） |
| `NPM_CONFIG_CACHE` | `NUWAX_NPM_CACHE_DIR` |
| `UV_CACHE_DIR` | `NUWAX_UV_CACHE_DIR` |
| `NPM_CONFIG_PREFIX` | `NUWAX_LOCAL_NPM_PREFIX` |

### 8. MCP Server 子进程注入隔离环境

**文件**: `vendors/rcoder/crates/agent_abstraction/src/launcher/claude_code_sacp.rs`

在 `convert_context_servers_sacp()` 中，每个 MCP server 的 `McpServerStdio.env` 注入：

| 注入的环境变量 | 来源 | 作用 |
|---------------|------|------|
| `PATH` | `NUWAX_LOCAL_PATH_ENV` | `uvx`/`npx`/`pnpm` 等命令优先找本地 bin |
| `UV_CACHE_DIR` | `NUWAX_UV_CACHE_DIR` | uvx 缓存走本地 |
| `NPM_CONFIG_CACHE` | `NUWAX_NPM_CACHE_DIR` | npx/npm 缓存走本地 |
| `NPM_CONFIG_PREFIX` | `NUWAX_LOCAL_NPM_PREFIX` | npm 安装前缀走本地 |

用户配置中手动设置的同名变量不会被覆盖。

---

## 进程树环境传递链路

```
Tauri 主进程 (lib.rs)
  │  设置 NUWAX_* 环境变量
  │
  ├─► Agent 子进程 (nuwaxcode / claude-code-acp)
  │     PATH = NUWAX_LOCAL_PATH_ENV
  │     NPM_CONFIG_CACHE = NUWAX_NPM_CACHE_DIR
  │     UV_CACHE_DIR = NUWAX_UV_CACHE_DIR
  │     NPM_CONFIG_PREFIX = NUWAX_LOCAL_NPM_PREFIX
  │     │
  │     └─► MCP Server 子进程 (uvx/npx/pnpm 等)
  │           PATH = NUWAX_LOCAL_PATH_ENV        ← 通过 McpServerStdio.env 显式注入
  │           UV_CACHE_DIR = NUWAX_UV_CACHE_DIR
  │           NPM_CONFIG_CACHE = NUWAX_NPM_CACHE_DIR
  │           NPM_CONFIG_PREFIX = NUWAX_LOCAL_NPM_PREFIX
  │
  ├─► FileServer 子进程
  │     PATH = NUWAX_LOCAL_PATH_ENV
  │
  └─► 安装/验证命令 (npm install --prefix, npm list --prefix)
        PATH = NUWAX_LOCAL_PATH_ENV
        NPM_CONFIG_CACHE = NUWAX_NPM_CACHE_DIR
```

---

## 改动汇总表

| Before | After |
|--------|-------|
| `npm install -g` | `npm install --prefix <app_data_dir>` |
| `npm list -g` | `npm list --prefix <app_data_dir>` |
| `npm update -g` | `npm install --prefix <app_data_dir> <pkg>@latest` |
| `which::which(cmd)` | `which::which_in(cmd, NUWAX_LOCAL_PATH_ENV, ".")` |
| 系统 npm | 优先打包的 npm (`NUWAX_BUNDLED_NPM_PATH`) |
| 系统 PATH | 本地 PATH 优先 (`NUWAX_LOCAL_PATH_ENV`) |
| npm 全局缓存 `~/.npm` | `<app_data_dir>/npm-cache` |
| uv 默认缓存 `~/.cache/uv` | `<app_data_dir>/uv-cache` |
| MCP server 继承系统环境 | 显式注入隔离变量到 `McpServerStdio.env` |
| unsafe 指针转换 | trait 默认方法 `check_tool_with_fallback()` |

## 验证方式

1. `grep -rn '"-g"' --include="*.rs" vendors/rcoder/crates/agent_config/ crates/nuwax-agent-core/src/dependency/` — 应无结果
2. `grep -rn 'unsafe' crates/nuwax-agent-core/src/dependency/manager.rs` — 应无结果
3. 启动应用，日志中确认 5 个 `NUWAX_*` 环境变量均已设置
4. 日志中确认 Agent 二进制路径指向 `<app_data_dir>/node_modules/.bin/`
5. 日志中确认 MCP server 环境变量包含本地 PATH
6. `npm install --prefix <app_data_dir>` 执行成功
7. Agent 子进程日志中确认 `NPM_CONFIG_CACHE`、`UV_CACHE_DIR` 已注入
