# macOS 平台首消息性能测试报告（重启后新会话）

**报告日期**: 2026-03-24  
**测试平台**: macOS  
**引擎类型**: claude-code  
**日志来源**: `/Users/apple/.nuwaclaw/logs/perf.2026-03-24.log`  
**参考模板**: `docs/optimization/WINDOWS-FIRST-MESSAGE-PERF-REPORT-2026-03-23.md`

---

## 执行摘要

本报告针对“重启客户端后首个新会话”进行性能核对。前端显示为 **00:37**，后端 PERF 日志显示两段关键新会话数据：

1. **16:04 会话**：仅记录到 `sse.firstChunk`，缺少 `sse.end`，无法直接计算完整总时长。
2. **16:07 会话**：链路完整，可核算端到端耗时约 **30.163s**（`create-workspace -> sse.end`）。

### 关键发现

| 指标 | 16:04 首会话（重启后） | 16:07 完整会话 | 说明 |
|-----|------------------|---------------|------|
| create-workspace | 2730ms | 275ms | 16:07 工作区阶段明显更快（可能复用） |
| /chat 总耗时 | 148ms | 139ms | API 前置开销很小 |
| ensureEngine | 127ms | 121ms | 引擎准备并非瓶颈 |
| sse 首包延迟（connect->firstChunk） | 10.999s | 12.555s | 首包等待明显 |
| sse streaming | 缺失 | 17.333s | 仅 16:07 可核算 |
| 端到端（create-workspace->sse.end） | 缺失 | 30.163s | 前端 00:37 高于该值 |

---

## 一、测试会话数据

### 1.1 会话 A（重启后首个新会话，日志不完整）

| 时间 | session_id | create-workspace | /chat | ensureEngine | sse.connect | sse.firstChunk | sse.end |
|-----|-----------|------------------|-------|--------------|-------------|----------------|---------|
| 16:04:54 | `e418fa45-a2a5-4a77-8830-abe3449cbc9c` | 2730ms | 148ms | 127ms | 16:04:54.608 | 16:05:05.607 | 缺失 |

**可计算片段**:
- `create-workspace -> sse.firstChunk` = `16:04:54.256 -> 16:05:05.607` = **11.351s**
- `sse.connect -> sse.firstChunk` = **10.999s**

> 由于缺少 `sse.end`，无法直接验证该次会话是否对应前端显示的 00:37。

### 1.2 会话 B（后续完整新会话）

| 时间 | session_id | create-workspace | /chat | ensureEngine | sse.connect | sse.firstChunk | sse.end |
|-----|-----------|------------------|-------|--------------|-------------|----------------|---------|
| 16:07:19 | `13711f68-795e-4517-ab4c-f0284ddc3070` | 275ms | 139ms | 121ms | 16:07:20.000 | 16:07:32.555 | 16:07:49.888 |

**详细分解**:
- `create-workspace -> /chat` = `16:07:19.697 -> 16:07:19.962` = **0.265s**
- `sse.connect -> firstChunk` = **12.555s**
- `sse streaming` = **17.333s**（日志直接给出）
- `create-workspace -> sse.end` = `16:07:19.697 -> 16:07:49.888` = **30.163s**

---

## 二、性能分析

### 2.1 时间结构（基于完整会话 B）

```text
总耗时（create-workspace -> sse.end）: 30.163s
├── 前置阶段（workspace + chat + engine）: ~0.265s（<1%）
├── 首包等待（sse.connect -> firstChunk）: 12.555s（41.6%）
└── 流式输出（firstChunk -> end）: 17.333s（57.5%）
```

结论：
- 当前主要耗时不在 `ensureEngine`（约 0.12s），而在 **首包等待 + 流式输出阶段**。
- 与“历史首消息慢主要在引擎准备”的模式不同，本次瓶颈更偏向模型响应阶段。

### 2.2 与前端 00:37 的差异

- 日志可完整核算值：**30.163s**（会话 B）。
- 前端显示值：**37s**。
- 差异约：**6.8s**。

可能原因（按优先级）：
1. 前端计时起点早于 `create-workspace`（例如点击发送或会话初始化前的 UI 阶段）。
2. 16:04 首会话虽然日志缺 `sse.end`，但前端仍完成并纳入了完整计时。
3. 前端停止计时点晚于 `sse.end`（渲染收尾、状态同步后才停止）。

---

## 三、结论与建议

### 3.1 结论

1. 重启后首个新会话（16:04）链路不完整，无法直接从后端日志确认 37s。
2. 后续完整会话（16:07）总耗时约 **30.163s**，量级接近但低于前端 37s。
3. 当前瓶颈集中在 **SSE 首包与流式阶段**，`ensureEngine` 非主要问题。

### 3.2 建议

1. 统一前后端计时口径：明确起点/终点并关联同一 `rid/sessionId`。
2. 增加 `sse.end` 丢失兜底埋点（取消、断流、窗口关闭等路径也记录结束事件）。
3. 增补前端埋点字段：`frontend_timer_start_ts`、`frontend_timer_end_ts`，与后端 PERF 同屏输出便于核对。

---

## 附录：原始日志摘录

```text
[2026-03-24 16:04:54.256] [info]  [PERF] create-workspace: 2730ms  rid=[283ou9vg2]
[2026-03-24 16:04:54.569] [info]  [PERF] /chat: 148ms  rid=68d27799  (parseBody=8ms validate=1ms workspace=1ms engine=127ms chat=11ms)
[2026-03-24 16:04:54.608] [info]  [PERF] sse.connect  session=e418fa45-a2a5-4a77-8830-abe3449cbc9c
[2026-03-24 16:05:05.607] [info]  [PERF] sse.firstChunk  session=e418fa45-a2a5-4a77-8830-abe3449cbc9c

[2026-03-24 16:07:19.697] [info]  [PERF] create-workspace: 275ms  rid=[llrt9utmb]
[2026-03-24 16:07:19.962] [info]  [PERF] /chat: 139ms  rid=1107a1f7  (parseBody=7ms validate=1ms workspace=0ms engine=121ms chat=10ms)
[2026-03-24 16:07:20.000] [info]  [PERF] sse.connect  session=13711f68-795e-4517-ab4c-f0284ddc3070
[2026-03-24 16:07:32.555] [info]  [PERF] sse.firstChunk  session=13711f68-795e-4517-ab4c-f0284ddc3070
[2026-03-24 16:07:49.888] [info]  [PERF] sse.end: 17333ms streaming  session=13711f68-795e-4517-ab4c-f0284ddc3070
```

---

*报告生成时间: 2026-03-24*  
*备注: 本报告为 macOS 单平台分析，重点核对前端 00:37 与后端 PERF 的时间差。*
