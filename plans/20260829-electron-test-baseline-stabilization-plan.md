# 实施计划：Electron 全量测试基线收口

- 对应需求：接管 Plan Mode 相关跨仓工作后，将 `npm run test:electron` 的 32 个存量失败收口为可用发布基线
- 状态：已完成
- 日期：2026-08-29

## 已复现的失败簇

1. 测试 mock 与当前模块导出不一致：`agentInstaller.validation`、`computerServer`、`logConfig`、`dependencies`。
2. MCP 测试仍假设旧的单入口脚本，未覆盖新版 `dist/host/rewrite.js` host adapter。
3. Windows fixture 在 macOS 测试进程中被 POSIX `path`/分隔符规则解析，导致 Bash、PATH 识别错误。
4. sandbox matrix 基线定位到错误目录或生成物缺失。

## 改动文件清单

| # | 文件 | 动作 | 说明 |
|---|---|---|---|
| 1 | `crates/agent-electron-client/src/main/services/system/ttydBundledEnvExport.ts` | 改 | 按输入平台语义拆分 PATH，并统一 Windows 路径归一化 |
| 2 | `crates/agent-electron-client/src/main/services/system/windowsGitBashCommand.ts` | 改 | 使用 win32 basename/resolve 识别 Windows Bash 路径 |
| 3 | 相关 `*.test.ts` | 改 | 更新过期 mock、平台 fixture 与 MCP host adapter fixture |
| 4 | `tests/scripts/sandbox-matrix-consistency.test.ts` 或基线工件 | 改/增 | 修正 repo root 并恢复确定性基线校验 |

## 实施顺序

1. 每个失败簇独立运行，保持 0.5–3 秒反馈环。
2. 先修测试桩和 fixture，再修已由跨平台 fixture 证明的产品路径解析问题。
3. 每簇转绿后运行完整 `npm run test:electron`。
4. 检查无调试日志、无意外生成物、无用户改动被覆盖。

## 证明成立的测试

- 簇级：9 个当前失败测试文件分别全绿。
- 功能保护：`src/main/services/engines/acp/acpEngine.test.ts` 59/59。
- 全量：`npm run test:electron` 退出码 0。

## 风险与回退

| 风险 | 缓解 | 回退方式 |
|---|---|---|
| 修测试掩盖产品缺陷 | Windows 路径问题修产品实现，不改正确断言 | 按失败簇逐文件回退 |
| mock 过宽导致失去隔离 | 仅补当前生产依赖所需导出，优先 partial mock | 回退对应测试文件 |
| matrix 生成物产生噪声 | 只提交确定性基线，检查 diff | 删除新增基线并恢复路径修正 |

## 偏离记录

- MCP 失败需要把 packaged extraResource 的动态加载边界提取为 `mcpHostAdapterLoader.ts`，以便测试真实 host adapter，同时保持生产路径不使用 bare import。
- `logConfig` 中 5 项断言针对已移除的日志归档回调，删除过期测试，不恢复已废弃功能。

## 验证结果

- `npm run test:electron`：104 个文件通过、1 个文件按平台跳过；1273 项通过、17 项跳过。
- `npm run build`：主进程 esbuild 与渲染进程 Vite 生产构建通过。
- 变更源文件 ESLint 通过；`git diff --check` 通过。
- 补充运行 `tsc --noEmit` 未通过，错误覆盖大量未改文件和既有测试 mock；仓库未配置 typecheck script，本次不扩大范围清理历史类型债。
