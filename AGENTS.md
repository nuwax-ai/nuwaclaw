# Nuwaclaw 客户端 · Agent 速览

> 一页入口。详细开发指南（架构图/进程模型/IPC/引擎细节）见 **[docs/agent-development-guide.md](docs/agent-development-guide.md)**，需要时再读，不必全文加载。
> 本文件与 `AGENTS.md` 内容保持同步——改其中一份必须同步另一份；正文单源在 docs/。

## 项目一句话

多引擎 AI 助手桌面客户端（Electron）：主进程管窗口/SQLite/引擎管理（claude-code、nuwaxcode）/IM 网关，渲染进程 React 18 + Redux Toolkit 经 IPC 通信（context isolation 开启）。Rust 面只有 `windows-sandbox-helper`（Cargo）。

## 命令（pnpm@9.15.5 workspace + npm 混合，注意区分层级）

```bash
pnpm install                                   # 根安装（postinstall 会先构建 @nuwax-ai/agent-kit）
npm run test:electron                          # 全量测试（= 进 electron crate 跑 vitest run）
cd crates/agent-electron-client && npm run dev        # 本地开发（vite + electron 双进程）
cd crates/agent-electron-client && npm run build       # 生产构建（main esbuild + renderer vite）
cd crates/agent-electron-client && npm run test:run   # 仅测试
cd crates/windows-sandbox-helper && cargo check       # Rust 面检查
make sidecar-download-all                      # 外置依赖 sidecar（见 Makefile help）
```

## 目录地图

| 路径 | 是什么 |
|---|---|
| `crates/agent-electron-client` | 主客户端（业务主体）；测试与源码同目录 `src/**/*.test.ts` |
| `crates/agent-kit` / `chat-kit` / `agent-workbench` / `agent-gui-server` | TS 共享包与服务端 |
| `crates/windows-sandbox-helper` | 唯一 Rust crate |
| `nuwax/` | **git submodule**（pin bump 流程升级，见 git log chore(submodule)）；子模块内有未跟踪 `.env` |
| `plans/` `specs/` | 方案与规格工件——继续沿用此约定落文档 |
| `config/*.toml` `vcpkg.json` | 运行时配置模板 / C++ 依赖清单 |

## 工作纪律

- Claude **同一处错两次**，纠正写进本文件。
- 秘钥拦截由 `.claude/hooks/guard-paths.mjs` 强制（PreToolUse，exit 2 = 拒绝）：`.env*`（example 豁免）、`*.pem/key`、`*credential*` 等，含 Bash 打印类命令；openssl 构建树（`.ttyd-build/`）的测试证书已豁免防误报。
- ⚠️ 已知政策隐患：`crates/agent-electron-client/.env.production` 目前被 git 跟踪。动它前确认里面没有真实凭证，清理须走人工评审而非顺手提交。
- 规则文件自身（本文件/AGENTS.md/docs 指南）按代码评审流程改动即可，无额外锁。
