---
version: 2.0
last-updated: 2026-03-09
status: design
---

# NuwaClaw V2 — 完整体服务方案

> 将 NuwaClaw 升级为**完整体智能服务平台**，
> 与 Nuwax 服务端（如 `https://testagent.xspaceagi.com`）深度整合，
> 实现配置同步、技能同步、会话同步、多渠道接入和自我进化。

---

## 文档索引

| #   | 文档                                                        | 描述                                                | 优先级 |
| --- | ----------------------------------------------------------- | --------------------------------------------------- | ------ |
| 01  | [总体架构](./01-ARCHITECTURE.md)                            | 分层架构、与服务器的协同模型、组件关系图            | P0     |
| 02  | [模型配置](./02-MODEL-CONFIG.md)                            | BaseURL / API Key / 多 Provider / 与服务器同步      | P0     |
| 03  | [Skills & MCP 工具管理](./03-SKILLS-MCP.md)                 | MCP 协议整合、技能 CRUD、冷启动优化、统一工具层     | P0     |
| 04  | [会话管理与 Chat 流程](./04-SESSION-CHAT.md)                | 会话引擎、历史会话管理、与服务器同步                | P0     |
| 05  | [Channel 多渠道接入](./05-CHANNELS.md)                      | 飞书 / 钉钉 / Telegram 等渠道网关                   | P1     |
| 06  | [Agent 自我进化架构](./06-SELF-EVOLUTION.md)                | Memory、EvoMap、Soul.md 在完整体系中的落地          | P1     |
| 07  | [知识库 · 工作流 · 插件](./07-KNOWLEDGE-WORKFLOW-PLUGIN.md) | Knowledge/RAG 同步、Workflow 编排同步、Plugin 同步  | P0     |
| 08  | [Heartbeat 与 Cron 定时任务](./08-SCHEDULER.md)             | 心跳检查、定时任务调度、与服务器同步                | P1     |
| 09  | [GUI Agent 实现](./09-GUI-AGENT-IMPLEMENTATION.md)          | 独立 GUI Agent 方案、MCP 集成、跨平台实现           | P0     |

---

## 核心理念

> **配置的域名本身就是一个完整的服务。**
>
> 例如 `https://testagent.xspaceagi.com` 是一个已经运行的 Nuwax Agent 服务，
> 拥有完整的 API 体系（模型管理、技能管理、MCP、知识库、工作流、插件、会话、Agent 配置等）。
> NuwaClaw（Electron 客户端）是这个服务的**桌面增强体**——不是替代，而是**协同**。

### Space（空间）概念

Nuwax 服务以 **Space（空间）** 为核心组织单元。一个 Space 下包含：

- 智能体 (Agent)、技能 (Skill)、MCP 服务、知识库 (Knowledge)、工作流 (Workflow)、插件 (Plugin)
- 客户端需要在初始化时确定当前操作的 `spaceId`，后续所有同步以此为上下文

### 设计原则

1. **服务器为源** — 模型配置、技能、MCP、知识库、工作流等核心数据以服务器为权威来源
2. **双向同步** — 客户端可离线使用，上线后自动与服务器同步
3. **桌面增强** — 客户端提供引擎管理、本地代码执行、IM Channel 等服务器不具备的能力
4. **插件化** — Provider / Channel / Skill 均为可插拔模块

---

## 与 V1 的关系

```
V1 (当前)                          V2 (目标)
─────────────────────              ─────────────────────
Java 后端 + lanproxy  ──────→     直连 Nuwax Service（服务器同步）
ACP SDK 单一引擎      ──────→     多 Provider + 服务器模型管理
MCP Proxy (桥接)      ──────→     MCP 原生集成 + 服务器 MCP 同步 + 冷启动优化
独立的会话管理         ──────→     与服务器会话双向同步
无 IM 集成            ──────→     多 Channel 网关
设计阶段的进化架构     ──────→     可落地的进化引擎
无知识库/工作流/插件   ──────→     与服务器 Knowledge/Workflow/Plugin 同步
无定时任务            ──────→     Heartbeat 心跳 + Cron 定时任务 + 服务器同步
```

---

## 与 Nuwax Server 的 API 对接总览

| 模块       | 服务器 API                                                                    | 客户端行为                                         |
| ---------- | ----------------------------------------------------------------------------- | -------------------------------------------------- |
| 模型配置   | `/api/model/save` · `/api/model/list` · `/api/model/test-connectivity`        | 从服务器拉取模型列表，客户端可新增并推送           |
| 技能管理   | `/api/skill/update` · `/api/skill/import` · `/api/skill/export`               | 同步技能清单，Agent 学到的技能推送到服务器         |
| MCP 管理   | `/api/mcp/create` · `/api/mcp/update` · `/api/mcp/list/{spaceId}`             | 拉取 MCP 配置并在本地启动，新增 MCP 同步到服务器   |
| 知识库     | `/api/knowledge/*` · `/api/knowledge/document/*`                              | 拉取知识库配置与文档，支持 RAG 查询同步            |
| 工作流     | `/api/workflow/*` · `/api/workflow/node/*`                                    | 拉取工作流定义，本地可视化编辑与同步               |
| 插件管理   | `/api/plugin/*` · `/api/plugin/http/update` · `/api/plugin/code/update`       | 拉取插件列表，HTTP/Code 插件本地调试与同步         |
| Agent 配置 | `/api/agent/config/{id}` · `/api/agent/component/*`                           | 拉取 Agent 完整配置（模型/技能/MCP/工作流/知识库） |
| 会话管理   | `/api/agent/conversation/*` · `/api/computer/chat` · `/api/computer/progress` | 会话和消息双向同步，Chat 直接转发                  |
| 定时任务   | `/api/agent/task/*` · `/api/task/cron/list`                              | 任务定义双向同步，执行结果推送                     |

---

## Agent 编排能力（服务器侧）

Agent 在服务器上的配置包含 **7 大 Tab**，客户端需同步和增强：

| Tab  | 说明                              | V2 对应文档        |
| ---- | --------------------------------- | ------------------ |
| 规划 | 系统提示词 / 用户提示词 / AI 优化 | 04-SESSION         |
| 工具 | 插件 / 工作流 / MCP 三大子分类    | 03-SKILLS / 07-KWP |
| 技能 | 独立技能组件绑定                  | 03-SKILLS          |
| 知识 | 知识库 (RAG) 绑定                 | 07-KWP             |
| 记忆 | 记忆配置                          | 06-EVOLUTION       |
| 对话 | 预览与调试                        | 04-SESSION         |
| 界面 | Agent 页面配置                    | -                  |

---

## 阅读顺序

1. **[总体架构](./01-ARCHITECTURE.md)** — 先了解全局分层与服务器协同模型
2. **[模型配置](./02-MODEL-CONFIG.md)** — 理解 Provider 抽象与服务器同步
3. **[Skills & MCP](./03-SKILLS-MCP.md)** — 工具层设计、冷启动优化与服务器同步
4. **[知识库 · 工作流 · 插件](./07-KNOWLEDGE-WORKFLOW-PLUGIN.md)** — 补充工具层
5. **[会话管理](./04-SESSION-CHAT.md)** — Chat 核心循环与服务器同步
6. **[Channel](./05-CHANNELS.md)** — 多渠道接入
7. **[Heartbeat 与 Cron](./08-SCHEDULER.md)** — 心跳检查与定时任务
8. **[自我进化](./06-SELF-EVOLUTION.md)** — 高阶能力

---

_本文档由架构维护者负责更新 · 2026-03-09_
