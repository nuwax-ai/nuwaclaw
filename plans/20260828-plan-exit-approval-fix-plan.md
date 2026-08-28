# 实施计划：退出 plan 审批链两根因修复

- 对应需求：用户实测报告——plan 会话中「审批卡看不到 plan 文档」且第二次 ExitPlanMode 未经人工批准直接开工（会话 881850d4，日志 2026-08-28 17:33–17:38）
- 状态：已接受（用户选定修复方向）
- 日期：2026-08-28

## 根因与方案

### ① yolo 档位同步拆除 plan 审批保护（主仓 permissionCoordinator）

日志实锤链：plan 会话第一次 ExitPlanMode 人工审批被拒 → 用户留言触发新一轮 chat → `syncSessionModeForChat` 把 webview 会话框档位（yolo）刷进协调器 → 第二次 ExitPlanMode 落入 ④ yolo 自动放行 → 自动选中首个 allow_always（恰为 bypassPermissions）→ 4ms 批准、引擎切 bypass、无感开工。

**修复（用户选定）**：`permissionCoordinator.decide()` 在 ④ 之前加 switch_mode 强制人工分支——`kind === "switch_mode" && effectiveMode === "yolo" && ruleAction !== "ask"` 时返回 `{kind:"ask"}`。显式 tool_approval_rules 的 allow（③）不受限（平台级有意配置）。

### ② 审批卡 plan 文档空白（nuwax 侧，待查）

第一次审批的 request_permission 数据完整（content[0].text 全文 plan + rawInput.plan + planFilePath），但 UI 审批卡上未渲染。待定位 AcpPermissionCard/MarkdownCustomPlanDoc 的数据形状对接。

## 改动文件清单

| # | 文件 | 动作 | 说明 |
|---|---|---|---|
| 1 | crates/.../acp/permission/permissionCoordinator.ts | 改 | ④ 前 switch_mode 强制人工分支 + 注释（含实测案例引用） |
| 2 | crates/.../acp/permission/permissionCoordinator.test.ts（若无则新增到邻近测试） | 改/增 | 用例：yolo + switch_mode → ask；yolo + 非 switch_mode → 放行（不回归） |
| 3 | nuwax 侧审批卡渲染（根因②定位后补） | 改 | 待定 |

## 证明成立的测试

- 主仓：permissionCoordinator 单测新增 2 用例 + 既有 acpEngine 相关测试不回归（`npm run test:electron` 范围，预存 32 失败除外）
- nuwax：根因②修复后 `npm run test:conversation` 全绿
- 手动：dev 起 plan 会话 → yolo 档下发消息触发 ExitPlanMode → 必须弹审批卡

## 风险与回退

- switch_mode 强制人工后，真正希望 yolo 全自动跳过 plan 确认的场景会多一次点击——语义上正确（档位跃迁需人工），若要平台级自动化应走显式 tool_approval_rules allow
- 回退：revert 单提交

## 偏离记录

（实现中偏离原计划逐条补记）
