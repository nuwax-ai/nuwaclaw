# Review：PATH 与安装地址相关改动

## 1. 改动总览

| 类别 | 改动 | 位置 |
|------|------|------|
| **Tauri 官方 PATH** | 启动时调用 `fix_path_env::fix()` | `main.rs` |
| **path_env 精简** | 模块缩至 ~52 行，保留 `build_node_path_env` + `ensure_local_bin_env` | `nuwax-agent-core/src/utils/path_env.rs` |
| **安装地址日志** | 可执行文件路径、Node/Uv 资源路径由 `info!` 改为 `debug!` | `lib.rs` |
| **无改动** | rcoder 子模块未改；子进程 PATH 注入仍仅在 nuwax 侧 | - |

---

## 2. PATH 体系（当前结构）

```
main.rs
  └── fix_path_env::fix()                    # Tauri 官方：GUI 进程继承 shell PATH

path_env.rs (nuwax-agent-core)
  ├── build_node_path_env()                  # spawn 时把 ~/.local/bin 放 PATH 前（兜底）
  └── ensure_local_bin_env()                # 写 ~/.local/bin/env，终端 source 后生效

调用关系：
  ensure_local_bin_env
    ├── node.rs  安装完成后
    ├── uv.rs    安装完成后
    └── lib.rs   dependency_local_env_init()
  build_node_path_env
    ├── lib.rs   spawn 相关（约 647, 2511, 2551, 2717, 2779）
    └── service/mod.rs  spawn 相关（60, 885, 1188）
```

- **fix-path-env**：修的是「当前进程 + 子进程继承」的 PATH，依赖用户已在 shell 里配好（如 source env）。
- **path_env.rs**：负责「安装后给终端用」的 env 脚本，以及 spawn 时显式带 `~/.local/bin` 的兜底。两者互补，无重复。

---

## 3. 发现：自定义 PATH 修复与 fix-path-env 重复

**位置**：`lib.rs` 约 3488–3533、3826–3918。

**现状**：

- `main.rs` 已在一开始执行 **fix_path_env::fix()**（Tauri 官方方案）。
- 在应用 setup 阶段又执行了 **fix_macos_path_env()** / **fix_linux_path_env()**：通过 `SHELL -l -c "echo $PATH"` 取 PATH 再 `set_var("PATH", ...)`，并带有 `println!`/`eprintln!`。

**结论**：逻辑与 fix-path-env 目标一致，且在其之后再次修 PATH，属于**重复实现**，并多出一块调试输出。

**建议**：

- **删除** `fix_macos_path_env()`、`fix_linux_path_env()` 以及调用它们的 `#[cfg(target_os = "macos")]` / `#[cfg(target_os = "linux")]` 块（含其中的 `println!`/`eprintln!`）。
- 统一只依赖 **fix_path_env::fix()**，减少维护成本和日志噪音。

若你希望保留「二次修复」作为兜底，至少建议去掉其中的 `println!`/`eprintln!`，改为 `debug!` 或删除，避免污染 stdout/stderr。

---

## 4. 安装地址相关日志

以下已由 `info!` 改为 `debug!`，默认不刷安装路径，需要时可用 debug 级别查看：

- `[Services]` file_server / lanproxy / mcp-proxy 可执行文件路径
- `[Lanproxy]` 可执行文件路径
- `[NodeInstall]` 开发模式/打包资源路径
- `[UvInstall]` 开发模式/打包资源路径

行为符合「不再强调安装地址」的目标，无需再改。

---

## 5. 其他检查

| 项 | 状态 |
|----|------|
| path_env.rs 与 fix-path-env 职责划分 | 清晰，互补 |
| ensure_local_bin_env 调用点（node/uv/依赖初始化） | 完整，失败仅 warn |
| build_node_path_env 在 spawn 前注入 | lib + service 多处使用，兜底有效 |
| nuwax-agent-core 只导出 path_env 两个 API | mod.rs 正确 |
| Cargo.toml 中 fix-path-env 依赖 | 已按 git 引用配置 |

---

## 6. 建议执行项（可选）

1. **删除 lib.rs 中的 fix_macos_path_env / fix_linux_path_env 及其调用**，仅保留 `fix_path_env::fix()`，避免重复与多余日志。
2. 若暂时不删，至少将这两处里的 **println! / eprintln!** 改为 **debug!** 或移除。

---

## 7. 让 path_env 对 rcoder 子进程生效（已做）

- **原因**：rcoder 在 `claude_code_sacp.rs` 里 spawn `claude-code-acp-ts` 时用 `cmd.envs(&merged_envs)`，未显式传 PATH，子进程只继承当前进程的 PATH。若从 Dock/Spotlight 启动，fix_path_env 可能未覆盖到，导致子进程找不到 node。
- **做法**：在 **main.rs** 里，在 `fix_path_env::fix()` 之后执行  
  `std::env::set_var("PATH", nuwax_agent_core::utils::build_node_path_env());`  
  这样整个 Tauri 进程（及所有子进程，含 rcoder 起的 ACP）的 PATH 都包含 `~/.local/bin`，path_env 逻辑即生效。

## 8. 未改动的相关点（备忘）

- **rcoder**：子模块内未改；无需在 rcoder 里再注入 PATH，因主进程已统一设置。
- **Pending 失败清理**：Chat 失败时清理 Pending 占位（避免 9010 一直挡请求）仍在建议阶段，未实现。
