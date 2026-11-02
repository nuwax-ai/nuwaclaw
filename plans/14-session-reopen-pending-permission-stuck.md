# 14 - 会话重新打开后权限申请 UI 无法展示

**状态**: 待处理
**优先级**: 高
**创建日期**: 2026-05-16

## 问题描述

用户在权限申请 UI 展示时关闭会话，重新打开后 UI 无法展示，会话卡在 pending 状态。

## 复现步骤

1. 用户发起需要权限的 tool call（如 bash / Read / Edit 等）
2. 权限申请 UI 展示期间，用户关闭会话/应用窗口
3. 用户重新打开或创建新会话
4. 权限申请 UI 无法重新展示，会话一直卡在 pending

## 根本原因

- `approvalInterventionService.ts` 中 `DEFAULT_TIMEOUT_MS` 为 `undefined`，无自动超时
- 窗口关闭时 pending permission 没有被清理
- 重新打包会话时，旧 pending 状态残留导致新 UI 无法展示

## 期望行为

1. 用户关闭会话/应用时，所有 pending permission 应立即 cancel
2. 重新打包会话时，能正常展示权限申请 UI
3. Pending 有上限，防止内存泄漏

## 建议方案

| 优先级 | 方案 | 说明 |
|--------|------|------|
| 短期 | 启用默认超时机制 | `DEFAULT_TIMEOUT_MS` 改为 120s |
| 中期 | 窗口关闭时清理 pending | webview 关闭 → `cancelByAppSession()` |
| 长期 | 定期清理 stale pending | 清理超过 5 分钟的孤立 pending |

## 相关文件

- `crates/agent-electron-client/src/main/services/intervention/approvalInterventionService.ts`
- `crates/agent-electron-client/src/renderer/components/pages/SessionsPage.tsx`

## 关联

- 设计文档：`docs/permission-request-handler-design.md`
- 相关计划：`plans/20260514-permission-request-handler-adaptation.md`