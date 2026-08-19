# docs 索引

> 整理日期：2026-08-17。过时文档一律移入 `_archive/`，不再留在根目录。

## 目录结构

| 目录 | 用途 |
|------|------|
| `design/` | 架构设计、协议契约、接口文档（长期有效的现行方案） |
| `requirements/` | 需求文档 / FRD |
| `qa/` | 当前进行中的提测清单、验收计划与手动验证步骤 |
| `sandbox/` | 沙箱方案、测试 prompts、白黑名单矩阵及生成物 |
| `_archive/` | 历史归档（见下） |

## design/

| 文档 | 说明 | 最后更新 |
|------|------|----------|
| `permission-request-handler-design.md` | Permission Request Handler 协议设计（**字段格式唯一权威来源**） | 2026-05-14 |
| `acp-permission-request-handler-adaptation.md` | NuwaClaw 侧对 RCoder permission 协议的适配边界 | 2026-05-26 |
| `permission-gated-tool-event-timing-sync.md` | Permission-Gated Tool 事件时序补丁说明 | 2026-06-04 |
| `mcp-ask-question-acp-toolcall-v1.md` | MCP Ask/Question over ACP ToolCall 契约 v1.1 | 2026-05-26 |
| `persistent-mcp-bridge-architecture.md` | 持久化 MCP Server Bridge 架构设计 | 2026-07-28 |
| `codex-acp-openai-compatible-routing.md` | codex-acp OpenAI-Compatible 路由契约（收口到 nuwax-codex-acp） | 2026-05-18 |
| `prefix-workspace-dir-variable.md` | `{PREFIX_WORKSPACE_DIR}` 路径变量替换规则 | 2026-06-25 |
| `ADMIN-SERVER-API.md` | Admin Server API（集成在 Computer Server 60006） | 2026-04-07 |
| `HARNESS-BUSINESS.md` | Harness 业务场景方案 v3.0 | 2026-03-23 |
| `HARNESS-UPGRADE.md` | Harness 方案升级计划 v2.0 | 2026-03-23 |

## requirements/

| 文档 | 说明 | 最后更新 |
|------|------|----------|
| `pc-webview-login-requirements.md` | PC 客户端 nuwax webview 登录统一 FRD（Phase 3 后端阻塞中） | 2026-08-12 |
| `chat-auto-install-agent.md` | Chat 接口自动安装 Agent 需求 | 2026-06-15 |

## qa/

| 文档 | 说明 | 最后更新 |
|------|------|----------|
| `qa-checklist-pc-webview-login.md` | webview 登录统一验收清单（配对 requirements/FRD） | 2026-08-13 |
| `acp-permission-ask-question-acceptance-plan.md` | ACP Permission 与 MCP Ask 提测验收计划 | 2026-05-27 |
| `acp-permission-manual-verification-steps.md` | ACP Permission / MCP Ask 手动验收步骤 | 2026-05-27 |

## sandbox/

| 文档 | 说明 |
|------|------|
| `sandbox-plan.md` | 沙箱多平台测试方案 |
| `sandbox-whitelist-blacklist-plan.md` | 白名单/黑名单矩阵与验证计划 |
| `sandbox-testing-prompts.md` | macOS 沙箱测试 prompts |
| `sandbox-matrix.generated.md` / `.json` | 矩阵生成物 |
| `TEST-PLAN.md` / `SANDBOX-1.2.0-INTEGRATION-REPORT.md` / `CODE-REVIEW.md` | 测试计划与集成报告 |

## _archive/ 归档原则

| 子目录 | 内容 |
|--------|------|
| `superseded-versions/` | 被新方案取代的旧版本文档（如 Tauri 时代的 `store-data-schema.md`，已被 Electron + SQLite 取代） |
| `completed-plans/` | 已落地完成的实现计划（如 `acp-code-agent-config-isolation.md`，配置隔离思想已落地到 `getAppEnv()`） |
| `historical-reports/` | 调研报告、评估快照、历史提测清单（0.12.60→0.13.18 版本线） |
| `completed-fixes-and-reviews/` | 已完成的修复与 code review 记录 |
| `specs-agent-client-tauri/` | Tauri 客户端时代的规格文档与供应商调研 |

> 归档不等于删除：git 历史永久保留；新归档时在文件顶部无需加标注，靠子目录语义即可。
