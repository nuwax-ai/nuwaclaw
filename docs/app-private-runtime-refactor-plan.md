# 应用内依赖安装与进程变量隔离重构方案（macOS / Windows / Linux）

## 背景与问题

当前依赖安装路径主要落在用户级通用目录（如 `~/.local`），会带来以下问题：

- 与用户已有工具链（node/python/uv 等）共享目录，容易互相污染。
- 版本切换和回滚成本高，难以做到应用级可控。
- 卸载应用后残留难清理，问题排查边界不清晰。
- 多平台路径与环境变量策略分散，行为不一致。

本次重构目标是：将运行时依赖收敛到应用私有目录，并将环境变量影响范围控制在应用进程树内。

## 目标与范围

- 目标：
  - 依赖仅安装到应用私有 `runtime` 目录，不再写入 `~/.local` 等全局位置。
  - 环境变量只对应用子进程生效，不修改用户 shell 配置和全局 PATH。
  - 支持 macOS / Windows / Linux 一致的安装、升级、回滚与卸载行为。
- 范围：
  - 依赖目录规划、运行时版本管理、子进程环境变量注入、旧数据迁移。
  - 适配现有 `DependencyManager` 与进程启动逻辑。
- 不在范围：
  - 变更业务协议与远程连接逻辑。
  - 引入系统级服务安装器（如全局 daemon）作为必需路径。

## 设计原则

- 应用私有：依赖目录与用户全局工具链隔离。
- 最小影响：不写 `.bashrc` / `.zshrc` / 系统注册表全局 PATH。
- 低冲击改造：优先复用现有模块与调用链，避免一次性重写。
- 可回滚：版本目录隔离，切换应具备原子性。
- 可观测：安装、迁移、失败原因有结构化日志。
- 可恢复：失败后保留上一个可用版本并支持重试。

## 低冲击改造策略（重点）

目标是在不大改现有代码结构的前提下完成重构，优先做“路径与注入策略替换”，而不是“架构重写”。

- 保留现有 `DependencyManager` 入口与状态机，仅替换安装目标目录解析逻辑。
- 保留现有依赖检测流程（node/uv/python 检测逻辑），只调整“安装后可执行路径”的返回值。
- 保留现有进程启动调用点，只在公共 spawn 封装里追加 `EnvBuilder` 注入。
- 保留现有日志、事件名称与前端状态，新增字段尽量向后兼容。
- 迁移逻辑独立为 `MigrationManager`，通过启动时一次性检查接入，不侵入日常安装路径。

兼容开关建议：

- 增加配置开关 `runtime.mode`：
  - `legacy`：继续使用旧路径（应急回退）。
  - `app_private`：使用新方案（默认逐步灰度）。
- 增加 `runtime.migration.enabled` 控制是否执行旧路径迁移。
- 出现严重问题时可通过配置立即回退到 `legacy`，避免紧急发版改代码。

配置读取约束（已确认）：

- `runtime.mode` 与 `runtime.migration.enabled` 仅在应用启动时读取一次，运行中不热切换。
- 模式读取入口保持单一，避免 tauri/core 多处各自判定。

## mcp-proxy 专项方案（低冲击优先）

本方案将 `mcp-proxy` 作为第一优先级对象，原因是它既是被启动服务，又会再启动下游 MCP 命令（如 `npx`、`uvx`），对 PATH 与 env 非常敏感。

已对齐的现状（当前仓库）：

- 启动入口在 `crates/nuwax-agent-core/src/service/mod.rs` 的 `mcp_proxy_start_with_config`。
- 当前通过 `--config <json>` 传入 `mcpServers`，并在启动时注入 `PATH`。
- 就绪检查通过 `mcp-proxy health` 子命令执行。
- Tauri 侧通过 `crates/agent-tauri-client/src-tauri/src/lib.rs` 的 `get_mcp_proxy_bin_path` 获取可执行路径。

参考实现（`/Users/apple/workspace/mcp-proxy`）约束：

- `mcp-proxy proxy` 支持 `--config` 与 `--config-file` 两种输入（见 `mcp-proxy/src/client/proxy_server.rs`）。
- `mcpServers` 中的 `env` 会透传给下游命令（见 `mcp-proxy/src/client/core/command.rs` 与 `mcp-proxy/src/server/task/mcp_start_task.rs`）。
- `health` 是独立子命令（见 `mcp-proxy/src/client/cli_impl/health.rs`），当前调用方式兼容。

低冲击改造原则（mcp-proxy）：

- 不改 `mcpServers` 配置结构，不改前端 store 数据格式。
- 不改 `mcp_proxy_start/mcp_proxy_stop/mcp_proxy_restart` 对外命令签名。
- 先只改“可执行文件路径解析 + 启动 env 注入”，保持调用链稳定。
- `--config` 先保留；仅在配置过大时自动落盘为 `--config-file`（避免 Windows 命令行长度风险）。

建议新增的 mcp-proxy 专项变量注入：

- `PATH=<RUNTIME_HOME>/current/bin + 原PATH`（必须）
- `APP_RUNTIME_HOME=<RUNTIME_HOME>`（诊断与一致性）
- `NPM_CONFIG_CACHE=<APP_HOME>/cache/npm`（避免污染全局 npm 缓存）
- `UV_CACHE_DIR=<APP_HOME>/cache/uv`（若下游服务依赖 uv/uvx）

关键兼容点：

- `mcp-proxy` 进程 env 必须与 `health` 检查命令完全同构（同一套 `EnvBuilder` 输出）。
- `mcpServers.env` 与应用注入 env 采用“应用基础 env + 服务自定义 env 覆盖”合并策略，避免破坏现有行为。
- Windows 继续保留 `APPDATA\\npm` 兜底逻辑，作为 `legacy` 模式兼容。
- 环境变量中的敏感信息不明文落盘，仅保存在进程/线程内存中。

## lanproxy 影响评估（边界说明）

结论：`lanproxy` 受本次重构影响较小，建议保持现有实现为主，只做最小兼容调整。

原因（基于当前代码）：

- `lanproxy` 使用的是独立二进制（Tauri bunded bin），不是 npm/uv 生态命令。
- 当前 `lanproxy_start_with_config` 直接按 `bin_path` 启动并传参数，不依赖 `mcpServers` 配置或额外 node PATH。
- 其核心风险主要是二进制路径解析与进程生命周期，不是依赖安装目录。

建议处理方式：

- 不把 `lanproxy` 纳入“runtime 依赖迁移”的首批范围，避免扩大改动面。
- 保留 `get_lanproxy_bin_path` 与现有启动参数（`-s/-p/-k/--ssl=true`）不变。
- 仅做一项兼容增强：在统一 `EnvBuilder` 接入后，给 `lanproxy` 传“最小环境变量集合”（可只保留系统 PATH，不强依赖 runtime PATH）。
- 保留现有残留进程清理和启动后存活检测逻辑，避免行为回归。

验收补充：

- 在 `runtime.mode=app_private` 下，`lanproxy` 启停、重启、状态查询行为与 `legacy` 一致。
- 不要求 `lanproxy` 改为从 `APP_HOME/runtime` 加载（除非后续其二进制发布方式变化）。

## 统一目录模型

定义：

- `APP_HOME`: 应用数据根目录。
- `RUNTIME_HOME`: `APP_HOME/runtime`，依赖安装根目录。

推荐目录结构：

```text
<APP_HOME>/
  runtime/
    versions/
      <dep-set-version>/
        bin/
        lib/
        share/
        meta.json
    current -> versions/<dep-set-version>
    locks/
    tmp/
  cache/
    downloads/
  state/
    install-state.json
  logs/
```

说明：

- `versions/<dep-set-version>`：按“依赖集合版本”隔离，避免覆盖式升级。
- `current`：当前生效版本指针。
  - Unix 使用符号链接。
  - Windows 优先符号链接；不满足权限时使用 `current.txt` 记录目标目录并由代码解析。
- `cache/downloads`：下载缓存，可按 TTL 清理。
- `locks`：并发安装锁文件。

## 跨平台路径策略

每用户路径建议：

- macOS：
  - `APP_HOME=~/Library/Application Support/<Vendor>/<App>`
- Linux：
  - `APP_HOME=${XDG_DATA_HOME:-~/.local/share}/<vendor>/<app>`
- Windows：
  - `APP_HOME=%LOCALAPPDATA%\<Vendor>\<App>`

要求：

- 不再将依赖安装到 `~/.local/bin`、`~/.local/share`、系统 Program Files 等全局位置。
- 日志、状态、缓存与 runtime 分目录管理，避免互相覆盖。

## 进程环境变量策略

核心约束：

- 不改全局环境变量，不持久化写入用户 shell 启动脚本。
- 仅在启动子进程时组装并注入 `env`。

注入策略：

- 通用：
  - `APP_RUNTIME_HOME=<RUNTIME_HOME>`
  - `PATH=<RUNTIME_HOME>/current/bin + 原PATH`
- Node 相关：
  - `NPM_CONFIG_CACHE=<APP_HOME>/cache/npm`
  - `COREPACK_HOME=<APP_HOME>/cache/corepack`
- Python/uv 相关：
  - `UV_CACHE_DIR=<APP_HOME>/cache/uv`
  - `PIP_CACHE_DIR=<APP_HOME>/cache/pip`

动态库加载：

- Linux：按需注入 `LD_LIBRARY_PATH=<RUNTIME_HOME>/current/lib + 原值`。
- macOS：优先通过打包修正 `@rpath`，避免依赖 `DYLD_*`；必要时仅对子进程注入。
- Windows：通过子进程 `PATH` 前置 `runtime/bin` 解决 DLL 搜索路径。

## 版本管理与原子切换

安装流程：

1. 下载依赖包到 `cache/downloads`。
2. 校验完整性（checksum/signature）。
3. 解压到 `runtime/versions/<new-version>.staging`。
4. 结构校验（必需二进制、权限、元数据）。
5. 原子切换 `current` 到新版本。
6. 记录安装状态并清理 staging。

回滚机制：

- 切换后健康检查失败，自动回退到上一个 `current` 版本。
- 失败版本保留用于诊断，不立即删除。

并发控制：

- 使用锁文件防止并发安装与并发切换。
- 锁超时后允许恢复流程接管。

## 迁移方案（从旧 `~/.local` 方案）

迁移触发：

- 新版本首次启动时检测旧路径中的受管依赖。

迁移步骤：

1. 扫描旧目录并识别受管版本（基于标记文件或版本特征）。
2. 复制或重建到 `runtime/versions/<migrated-version>`。
3. 校验可执行性与版本匹配。
4. 切换 `current` 并执行健康检查。
5. 写入迁移完成标记。

清理策略：

- 迁移成功后不立即删除旧目录，进入延迟清理窗口（建议 7-30 天）。
- 提供手动“清理旧依赖”入口。

失败处理：

- 迁移失败不阻断应用启动，但回退为“按新路径重新安装依赖”。
- 记录错误并提示用户可执行恢复操作。

## 模块拆分建议

- `PathResolver`
  - 负责平台路径解析与目录创建。
- `RuntimeManager`
  - 负责下载、校验、解压、切换、回滚、清理。
- `EnvBuilder`
  - 负责按子进程类型生成隔离环境变量。
- `ProcessLauncher`
  - 统一 spawn 入口，强制使用 `EnvBuilder` 输出。
- `MigrationManager`
  - 负责旧路径探测、迁移与状态落盘。

低冲击落地方式：

- `PathResolver`：优先在现有路径工具模块中扩展函数，不新建过多跨 crate 依赖。
- `RuntimeManager`：先实现最小功能（目录准备 + 安装目标切换），下载/校验逻辑复用当前实现。
- `EnvBuilder`：先覆盖关键进程（node/uv/lanproxy），其余进程按风险逐步切换。
- `ProcessLauncher`：若当前已有统一命令封装，优先在该封装中注入，避免全仓替换 spawn。

## 最小改动清单（按当前仓库文件）

阶段 1（零行为变化，先接入能力）：

1. `crates/nuwax-agent-core/src/utils/path_env.rs`
   - 新增 `build_app_runtime_path_env(...)`，保留现有 `build_node_path_env()` 不删。
2. `crates/nuwax-agent-core/src/service/mod.rs`
   - 新增 `build_mcp_proxy_env(...)` 小函数，仅供 `mcp_proxy_start_with_config` 使用。
3. `crates/agent-tauri-client/src-tauri/src/lib.rs`
   - `get_mcp_proxy_bin_path` 增加 `runtime.mode=app_private` 分支解析，但默认仍走 legacy 逻辑。

阶段 2（mcp-proxy 优先切换）：

1. `crates/nuwax-agent-core/src/service/mod.rs`
   - `mcp_proxy_start_with_config` 切换为使用 `build_mcp_proxy_env(...)` 注入 env。
   - 增加“配置体积阈值判断”：超过阈值仅落盘非敏感配置，敏感 env 保持内存注入。
2. `crates/nuwax-agent-core/src/service/mod.rs`
   - `wait_for_mcp_proxy_ready` 复用 `build_mcp_proxy_env(...)`，确保与启动命令 env 完全一致。

阶段 3（路径切换与迁移）：

1. `crates/agent-tauri-client/src-tauri/src/lib.rs`
   - `resolve_npm_global_bin_path` 保留，新增 `resolve_app_runtime_bin_path`，由模式开关决定优先级。
2. `crates/nuwax-agent-core/src/dependency/manager.rs`
   - 安装目标目录切到 `APP_HOME/runtime`，对外接口保持不变。
3. `crates/nuwax-agent-core/src/dependency/node.rs`
   - 保留安装流程，仅替换安装落点与返回 bin 路径。
4. `crates/nuwax-agent-core/src/dependency/uv.rs`
   - 保留安装流程，仅替换安装落点与 cache 路径。

阶段 4（灰度与回退）：

1. `config/default-config.toml`
   - 增加 `runtime.mode` 与 `runtime.migration.enabled` 默认值。
2. `crates/nuwax-agent-core/src/lib.rs`
   - 启动时一次性读取开关并缓存，失败时允许回退到 `legacy`。

阶段 5（依赖检测规则切换）：

1. `crates/agent-tauri-client/src-tauri/src/lib.rs`
   - 依赖检测顺序调整为：
   - `app_private` 模式：先检测 `APP_HOME/runtime/current/bin`，再决定是否走 legacy fallback。
   - `legacy` 模式：保持现有检测逻辑。
2. `crates/nuwax-agent-core/src/dependency/detector.rs`
   - 新增“来源标签”（app-runtime / legacy / system），用于日志与 UI 提示。
3. `crates/agent-tauri-client/src/services/dependencies.ts`
   - 在依赖状态展示中区分“应用内依赖”与“系统依赖”，避免用户误解检测结果。

## 日志与可观测性

建议新增事件：

- `runtime.install.start/success/fail`
- `runtime.switch.start/success/fail`
- `runtime.rollback.triggered/success/fail`
- `runtime.migration.start/success/fail`

日志要求：

- 记录版本号、平台、架构、错误码、耗时。
- 默认不输出敏感路径细节到 info；详细路径放 debug。

## 安全与权限

- 下载包必须校验校验和，推荐增加签名校验。
- 所有可执行文件写入后需设置最小必要权限。
- 避免从用户可写的非受控目录直接执行二进制。
- Windows 下注意路径空格与执行策略兼容。

## 测试与验收标准

测试维度：

- 全新安装：依赖仅落在 `APP_HOME/runtime`。
- 升级：旧版本可保留，新版本切换成功。
- 回滚：新版本健康检查失败可自动回退。
- 迁移：从 `~/.local` 迁移成功且可运行。
- 并发：重复触发安装时不会破坏目录结构。
- 三平台：macOS / Windows / Linux 结果一致。

验收标准：

1. 用户全局目录不再新增应用依赖安装产物。
2. 不修改用户 shell 启动脚本与全局 PATH。
3. 子进程在未改全局 PATH 的条件下可正常执行依赖。
4. 卸载应用后删除 `APP_HOME` 即可完成依赖清理。
5. 迁移失败时可自动降级为重装，不影响主流程可用性。

## 实施里程碑建议

1. 里程碑 1：新增 `PathResolver` 与配置开关，保持默认 `legacy`（零行为变化）。
2. 里程碑 2：在 `app_private` 模式下切换安装目录，新装场景先行。
3. 里程碑 3：在统一 spawn 封装接入 `EnvBuilder`，先覆盖核心依赖进程。
4. 里程碑 4：接入迁移与自动回滚，逐步灰度默认到 `app_private`。
5. 里程碑 5：稳定后下线 `legacy` 写路径，仅保留读取兼容窗口。
