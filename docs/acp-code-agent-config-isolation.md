# ACP 方案中 Code Agent 全局配置冲突的隔离与实现计划

## 目的
通过 ACP 方案在客户端侧（项目中的 tauri-client）调用 nuwaxcode / claude (code) 等 CLI code agent 时，这些工具会读取用户全局配置（如 .claude、.opencode、.nuwaxcode），与 ACP 注入配置冲突。本文提供包含代码与落地步骤的完整实现计划。

## 目标与边界
目标：确保 ACP 注入配置优先或成为唯一配置来源；支持多项目/多实例并行运行；CI 环境稳定可复现。  
非目标：不修改第三方工具内部逻辑，仅通过运行时隔离与启动策略控制。

## 方案概览（分层隔离）
1. 配置路径重定向（环境变量）  
2. 显式配置参数（CLI 参数）  
3. HOME 与 XDG 隔离  
4. 统一 Wrapper  
5. 容器化 / 沙箱  

## 实施步骤（含代码，客户端为 tauri-client）

### Step 1：确认工具能力（参数与环境变量）
产出：每个工具的“配置入口清单”。  
执行方式：查官方文档或源码确认参数与环境变量名。

模板记录（示例，仅为假设，需以实际文档/源码为准）：
```
tool: nuwaxcode
config_arg: --config
config_env: NUWAXCODE_CONFIG_DIR
xdg_supported: yes
```

### Step 2：定义隔离目录规范
目标：为每次 ACP 运行生成独立目录，避免并发冲突。  
目录结构建议：
```
<base>/
  runs/<run_id>/
    config/
    data/
    cache/
    logs/
```

### Step 3：运行时注入规则（tauri-client 侧）
目的：由 tauri-client 在启动子进程时注入隔离目录与配置参数。

#### 3.1 环境变量重定向（优先）
示例（以 bash 为例）：
```bash
export ACP_RUN_DIR="/tmp/acp-runs/$RUN_ID"
export XDG_CONFIG_HOME="$ACP_RUN_DIR/config"
export XDG_DATA_HOME="$ACP_RUN_DIR/data"
export XDG_CACHE_HOME="$ACP_RUN_DIR/cache"
```

如果工具提供专用环境变量：
```bash
export NUWAXCODE_CONFIG_DIR="$ACP_RUN_DIR/config"
export CLAUDE_CONFIG_DIR="$ACP_RUN_DIR/config"
```

#### 3.2 CLI 参数指定配置
示例：
```bash
nuwaxcode --config "$ACP_RUN_DIR/config/nuwaxcode.yaml" ...
claude --config "$ACP_RUN_DIR/config/claude.json" ...
```

### Step 4：Wrapper 统一入口（可选，tauri-client 侧）
目标：在 tauri-client 中统一处理隔离目录与环境变量。

示例伪代码（Node.js）：
```js
import { spawn } from "child_process";
import { mkdtempSync } from "fs";
import { tmpdir } from "os";
import path from "path";

const runId = process.env.ACP_RUN_ID || Date.now().toString();
const base = mkdtempSync(path.join(tmpdir(), "acp-runs-"));
const runDir = path.join(base, runId);

const env = {
  ...process.env,
  XDG_CONFIG_HOME: path.join(runDir, "config"),
  XDG_DATA_HOME: path.join(runDir, "data"),
  XDG_CACHE_HOME: path.join(runDir, "cache"),
  NUWAXCODE_CONFIG_DIR: path.join(runDir, "config"),
};

const args = ["--config", path.join(runDir, "config/nuwaxcode.yaml")];
spawn("nuwaxcode", args, { env, stdio: "inherit" });
```

### Step 5：清理策略
目的：确保隔离目录不会污染用户环境。  
示例（bash）：
```bash
rm -rf "$ACP_RUN_DIR"
```

## tauri-client 集成点（明确落点）
以下落点均在 tauri-client 侧，可作为实现注入与隔离的“挂载点”。

1. 进程启动入口  
文件：/Users/apple/workspace/nuwax-agent_diff/crates/agent-tauri-client/src-tauri/src/lib.rs  
位置：`tauri::command` 各类服务启动函数，例如 `file_server_start`、`lanproxy_start`、`rcoder_start`。  
方案：在调用 ServiceManager 之前构建隔离目录与环境变量，并将其传递给下层。

示例（tauri 命令层注入）：
```rust
let run_dir = build_isolated_run_dir();
let env = build_isolated_env(&run_dir);
manager.file_server_start_with_config_and_env(config, env).await?;
```

2. ServiceManager 初始化与生命周期  
文件：/Users/apple/workspace/nuwax-agent_diff/crates/agent-tauri-client/src-tauri/src/lib.rs  
位置：`ServiceManagerState::default` 与 `ServiceManager::new` 的调用处。  
方案：在创建 ServiceManager 时注入“默认隔离策略”，确保后续所有启动路径统一受控。

示例（构造注入）：
```rust
let manager = ServiceManager::new_with_isolation(isolation_policy);
```

3. 实际进程 spawn 点（下沉到 core）  
文件：/Users/apple/workspace/nuwax-agent_diff/crates/nuwax-agent-core/src/service/mod.rs  
位置：`file_server_start_with_config` 等使用 `process_wrap::tokio::CommandWrap` 的地方。  
方案：在 CommandWrap 构建阶段追加 env 与工作目录，保证隔离目录生效。

示例（CommandWrap 注入）：
```rust
let mut cmd = process_wrap::tokio::CommandWrap::with_new(bin, |cmd| {
    cmd.envs(isolated_env).current_dir(run_dir);
});
```

4. macOS PATH 修复与隔离并行  
文件：/Users/apple/workspace/nuwax-agent_diff/crates/agent-tauri-client/src-tauri/src/lib.rs  
位置：`fix_macos_path_env`。  
方案：保持 PATH 修复不变，但在此之后叠加隔离目录注入，避免覆盖。

## 责任边界
tauri-client：注入隔离环境、维护配置目录生命周期、管理日志与缓存隔离。  
CLI 工具侧：遵循参数/环境变量读取指定配置；不保证处理未声明的私有路径。  
平台/基础设施：提供可写临时目录与权限，容器模式时提供运行环境。

## 风险评估
- 配置入口不一致：隔离策略失效导致读取全局配置。  
缓解：先完成工具能力确认与验证。  
- 隐式路径写入：token、history、cache 写入用户 HOME。  
缓解：验证阶段检查写入痕迹并补充隔离目录。  
- 多实例竞争：并发运行时覆盖配置或缓存。  
缓解：每次运行生成唯一隔离目录。  
- 性能与启动开销：隔离目录创建与初始化耗时增加。  
缓解：控制目录层级与复用策略。  
- 排障复杂：隔离层级增加定位成本。  
缓解：规范日志与诊断输出路径。

## 验收标准
1. 工具在隔离模式下不读取用户全局配置。  
2. 多实例并发运行时互不污染。  
3. 启动、运行、退出后不在用户 HOME 目录产生新文件。  
4. 日志与缓存均落在隔离目录内。  
5. 在 CI 环境可稳定复现。

## 验证方法
1. 对比隔离前后读取配置路径的差异。  
2. 检查隔离目录与用户 HOME 目录的写入痕迹。  
3. 并发运行至少两组实例，确认目录与配置完全隔离。  
4. 清理隔离目录后再次运行，确认不依赖全局配置。

## 输出物
1. 本方案文档（含代码实现计划）。  
2. 工具能力确认清单。  
3. 运行时注入规则说明。  
4. 验证记录与验收结论。
