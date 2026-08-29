# Nuwaclaw 客户端 · Agent 速览

> 一页入口。详细开发指南（架构图/进程模型/IPC/引擎细节）见 **[docs/agent-development-guide.md](docs/agent-development-guide.md)**，需要时再读，不必全文加载。
> 单一事实源：**本文件是正文**；根 `CLAUDE.md` 仅一行 `@AGENTS.md` 导入。改规则只动这里+docs/，勿再复制出第二份。

## 项目一句话

多引擎 AI 助手桌面客户端（Electron）：主进程管窗口/SQLite/引擎管理（claude-code、nuwaxcode）/IM 网关，渲染进程 React 18 + Redux Toolkit 经 IPC 通信（context isolation 开启）。Rust 面只有 `windows-sandbox-helper`（Cargo）。

## 命令（pnpm@9.15.5 workspace + npm 混合，注意区分层级）

```bash
pnpm install                                   # 根安装（postinstall 会先构建 @nuwax-ai/agent-kit）
npm run test:electron                          # 全量测试（= 进 electron crate 跑 vitest run）
make electron-dev                              # ⭐ 本地调试启动（自动 electron-prepare + prepare:all + 清 vite 缓存——调试别绕过它直接 npm run dev）
cd crates/agent-electron-client && npm run build       # 生产构建（main esbuild + renderer vite）
cd crates/windows-sandbox-helper && cargo check       # Rust 面检查
make help                                      # 其余目标速查（sidecar-* 等）
```

## 发布（打 tag 即打包，GitHub Actions 全平台）

```bash
git tag prerelease-v{x.y.z} && git push origin prerelease-v{x.y.z}   # beta：Draft Release → 同步阿里云 OSS → 更新 beta/latest.json
git tag electron-v{x.y.z}  && git push origin electron-v{x.y.z}      # stable：正式版 GitHub Release
```

- **beta 前置两件事缺一不发**：nuwaxcode GitHub Release 已就绪（如 v1.2.1）、`release-notes/prerelease-v{x.y.z}.md` 备好。
- **tag 空间隔离**：Electron 客户端独占 `electron-v*` / `prerelease-v*`，不与 Tauri 客户端共用裸 `v*`（见 release-electron.yml 头注）。

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
- 需求→规格→计划走 skills 链：`requirement-analysis`（产出 `templates/intent.md` → `plans/*-intent.md`）→ `grill-with-docs`（→ `specs/<slug>.md`）→ Plan mode（→ `plans/*-plan.md`）才动 src；PR 评审对照根目录 `REVIEW.md` 五遍清单。
- 源码首改会被 `.claude/hooks/plan-gate.mjs` 追问一次计划工件（同会话只问一次；`NUWACLAW_SKIP_PLAN_GATE=1` 可停用）。
- 秘钥拦截由 `.claude/hooks/guard-paths.mjs` 强制（PreToolUse，exit 2 = 拒绝）：`.env*`（example 豁免）、`*.pem/key`、`*credential*` 等，含 Bash 打印类命令；openssl 构建树（`.ttyd-build/`）的测试证书已豁免防误报。
- ⚠️ 已知政策隐患：`crates/agent-electron-client/.env.production` 目前被 git 跟踪。动它前确认里面没有真实凭证，清理须走人工评审而非顺手提交。
- 规则文件自身（本文件 = 唯一正文，`CLAUDE.md` 只是 @ 指针，docs/ 指南为详细层）按代码评审流程改动即可，无额外锁。

### 非 Claude Code agent 兼容

- 本文件、`templates/`、`REVIEW.md`、skills 正文全是纯 markdown：codex / opencode / cursor 等**直接读即可**；需要某条流程时让 agent `cat .claude/skills/<name>/SKILL.md` 照做。
- 强制机制差异：PreToolUse hooks（guard-paths / plan-gate）仅 Claude Code 执行；但本仓地板层在三仓里最厚——husky pre-commit 全量 electron 套件 + pr.yml CI 对所有 agent 一视同仁，护栏下沉时优先扩这两处而非另起炉灶。
- verifier 等价物：任何 agent 跑 `npm run test:electron` 按 verifier 的报告格式贴结论即可，不必有子代理机制。

<!-- nuwa-sdlc-kit:begin v1（安装器托管区间，勿手工增删行；本节外的 AGENTS.md 内容归仓库所有） -->

## AI SDLC 规则层

- 需求→规格→计划链：skills `requirement-analysis` → `plans/*-intent.md`、`grill-with-docs` → `specs/<slug>.md` → Plan mode 产物 `plans/*-plan.md`（模板在 `templates/`）。
- 源码首改会被 `.claude/hooks/plan-gate.mjs` 追问一次计划工件（同会话只问一次；`NUWACLAW_SKIP_PLAN_GATE=1` 停用）；秘钥由 `.claude/hooks/guard-paths.mjs` 拦截（`.env*`/证书/credential 类拒读写，example 豁免）。
- PR 评审对照根目录 `REVIEW.md` 五遍清单（nit≤5；writer 不自批）。
- **单一事实源**：本文件是正文（根 CLAUDE.md 已存在，建议人工收敛为单行 `@AGENTS.md` 指针）；勿复制出第二份。

### 非 Claude Code agent 兼容

- 本文件、`templates/`、`REVIEW.md`、skills 正文全是纯 markdown：codex / opencode / cursor 等**直接读即可**；需要某条流程时让 agent `cat .claude/skills/<name>/SKILL.md` 照做。
- 强制机制差异：PreToolUse hooks 仅 Claude Code 执行；其他 agent 的兜底 = 提交前按同一规则自查，非协商护栏建议下沉 git pre-commit / CI（agent 无关的强制地板）。
- verifier 等价物：任何 agent 跑 `pnpm --filter @nuwax-ai/nuwaclaw run test:run` 按报告格式贴结论即可，不必有子代理机制。

<!-- nuwa-sdlc-kit:end -->
