# macOS 平台首消息性能测试报告（连续新会话）

**报告日期**: 2026-03-31  
**测试平台**: macOS  
**引擎类型**: nuwaxcode  
**日志来源**: `/Users/apple/.nuwaclaw/logs/perf.2026-03-31.log`（00:17:30 ~ 00:20:39）  
**参考模板**: `docs/optimization/MACOS-FIRST-MESSAGE-PERF-REPORT-2026-03-24.md`

---

## 执行摘要

本报告针对“连续新开会话”的**首条消息首次响应性能**进行核对，口径为：

- 主要口径：`create-workspace -> sse.firstToken`
- 辅助口径：`/chat received -> 首 token`（`/chat` + `sendToFirstUpdate`）

本轮共观测到 6 次新会话尝试：
1. **5 次完整会话**（均包含 `sse.firstToken`）
2. **1 次中断会话**（仅 `create-workspace`，未进入 `/chat`）

### 关键发现

| 指标 | 本轮结果（5 次完整会话） | 说明 |
|-----|------------------|------|
| 首次响应（create-workspace -> firstToken） | **平均 9.307s**（8.063s ~ 10.928s） | 用户体感“首字出来”耗时 |
| `/chat` 总耗时 | **平均 2.955s**（2.060s ~ 3.697s） | 前置阶段 |
| `sendToFirstUpdate` | **平均 6.304s**（5.885s ~ 7.699s） | 首 token 等待阶段，主瓶颈 |
| `/chat` 内 `ensureEngine` | **平均 2.042s**（1.367s ~ 3.011s） | A 段内部主耗时 |
| 稳定性 | 5/5 完整会话成功 | 本时间窗内未见 `newSession/chat` 报错 |

---

## 一、测试会话数据

### 1.1 五次完整新会话（首消息）

| 会话 | project_id | rid | session_id | create-workspace | `/chat` | ensureEngine | sessionSetup | sse.connect | sse.firstToken | 首次响应（create->firstToken） |
|-----|------------|-----|------------|------------------|---------|--------------|--------------|-------------|----------------|-------------------------------|
| S1 | 1564329 | `0d3f44ba` | `ses_2c076bcb0ffeNfAHi2Yiu6tpru` | 00:17:30.613 | 3169ms | 1672ms | 1495ms | 00:17:33.851 | 00:17:39.723 | **9.110s** |
| S2 | 1564331 | `b2d8d26f` | `ses_2c075ef03ffeMiHTQKKR4h0FkZ` | 00:18:23.562 | 2652ms | 1982ms | 669ms | 00:18:26.284 | 00:18:32.234 | **8.672s** |
| S3 | 1564332 | `1b4b5eeb` | `ses_2c07552afffeFIQODrEZMYpydC` | 00:19:02.567 | 3697ms | 3011ms | 683ms | 00:19:06.309 | 00:19:12.328 | **9.761s** |
| S4 | 1564333 | `c00c4d52` | `ses_2c074e299ffe6qfg8LTgbN2lET` | 00:19:32.857 | 2060ms | 1367ms | 692ms | 00:19:35.003 | 00:19:40.920 | **8.063s** |
| S5 | 1564334 | `0d815846` | `ses_2c0742965ffebmYiW5e8JIydTk` | 00:20:19.169 | 3199ms | 2179ms | 1019ms | 00:20:22.411 | 00:20:30.097 | **10.928s** |

### 1.2 中断会话（仅创建工作区）

| 时间 | rid | 事件 |
|-----|-----|------|
| 00:18:08.206 | `5mia20hej` | 仅 `create-workspace`，未进入 `/chat`，不纳入首次响应统计 |

---

## 二、性能分析（首消息首次响应口径）

### 2.1 首次响应时间结构（均值）

```text
平均首次响应（create-workspace -> firstToken）: 9.307s
├── create-workspace -> /chat received: ~0.047s（0.5%）
├── A: /chat received -> /chat 返回: 2.955s（31.8%）
└── B: /chat 返回 -> firstToken: 6.304s（67.7%）
```

结论：
- 若目标是“新会话首条消息尽快出首字”，**B 段是主瓶颈**（约 2/3）。
- A 段次之；其中仍以 `ensureEngine` 为主，但总体占端到端首响仅约 22%。

### 2.2 A 段内部（/chat 阶段）分解

| 指标 | 平均耗时 | 占 A 段 |
|-----|---------|--------|
| ensureEngine | 2042ms | 69.1% |
| sessionSetup/chat 其余 | 912ms | 30.9% |

说明：
- A 段仍有优化空间，但不是首响的第一优先级。
- 本轮 A 段波动（2.060s~3.697s）主要来自 `ensureEngine` 与 `sessionSetup` 抖动。

### 2.3 抖动观察

| 阶段 | 最小 | 最大 | 波动特征 |
|-----|------|------|---------|
| `/chat` | 2060ms | 3697ms | 中等波动 |
| `sendToFirstUpdate` | 5885ms | 7699ms | 中等偏高，S5 明显偏慢 |
| `firstToken->end_turn` | 8008ms | 25402ms | 该段波动极大（与“首响”无关，但影响整体完成时间） |

---

## 三、结论与建议

### 3.1 结论

1. 本轮“新会话首条消息首次响应”平均约 **9.3s**。  
2. 主要瓶颈不在 `/chat` 前置，而在 **`/chat` 返回后等待首 token（B 段）**。  
3. 本时间窗内 5 次完整会话均成功，未出现上一轮的 `newSession` 内部错误。  

### 3.2 建议（按首响收益排序）

1. 先优化 `sendToFirstUpdate`（目标先压到 <5s，再冲 <4s）。  
2. 再收敛 `ensureEngine` 抖动（优先把 3s 档位压回 2s 内）。  
3. 保留当前 `sse.firstToken` 埋点，后续把优化验收口径统一为 `create-workspace -> sse.firstToken`。  

---

## 附录：关键日志摘录

```text
[2026-03-31 00:17:30.613] [PERF] create-workspace: 66ms  rid=[j197gc94h]
[2026-03-31 00:17:33.838] [PERF] /chat: 3169ms  rid=0d3f44ba  (parseBody=0ms validate=1ms workspace=0ms engine=1672ms chat=1496ms)
[2026-03-31 00:17:39.723] [PERF] sse.firstToken  session=ses_2c076bcb0ffeNfAHi2Yiu6tpru
[2026-03-31 00:17:39.723] [PERF] acp.prompt.sendToFirstUpdate: 5885ms  sessionId=ses_2c076bcb0ffeNfAHi2Yiu6tpru

[2026-03-31 00:18:23.562] [PERF] create-workspace: 49ms  rid=[fg7ng07b6]
[2026-03-31 00:18:26.269] [PERF] /chat: 2652ms  rid=b2d8d26f  (parseBody=0ms validate=1ms workspace=0ms engine=1982ms chat=669ms)
[2026-03-31 00:18:32.234] [PERF] sse.firstToken  session=ses_2c075ef03ffeMiHTQKKR4h0FkZ
[2026-03-31 00:18:32.234] [PERF] acp.prompt.sendToFirstUpdate: 5965ms  sessionId=ses_2c075ef03ffeMiHTQKKR4h0FkZ

[2026-03-31 00:19:02.567] [PERF] create-workspace: 51ms  rid=[fy8f9owgd]
[2026-03-31 00:19:06.296] [PERF] /chat: 3697ms  rid=1b4b5eeb  (parseBody=1ms validate=0ms workspace=1ms engine=3011ms chat=684ms)
[2026-03-31 00:19:12.328] [PERF] sse.firstToken  session=ses_2c07552afffeFIQODrEZMYpydC
[2026-03-31 00:19:12.328] [PERF] acp.prompt.sendToFirstUpdate: 6033ms  sessionId=ses_2c07552afffeFIQODrEZMYpydC

[2026-03-31 00:19:32.857] [PERF] create-workspace: 72ms  rid=[2kfaik1wz]
[2026-03-31 00:19:34.980] [PERF] /chat: 2060ms  rid=c00c4d52  (parseBody=0ms validate=0ms workspace=1ms engine=1367ms chat=692ms)
[2026-03-31 00:19:40.920] [PERF] sse.firstToken  session=ses_2c074e299ffe6qfg8LTgbN2lET
[2026-03-31 00:19:40.920] [PERF] acp.prompt.sendToFirstUpdate: 5940ms  sessionId=ses_2c074e299ffe6qfg8LTgbN2lET

[2026-03-31 00:20:19.169] [PERF] create-workspace: 46ms  rid=[e6dtwydgo]
[2026-03-31 00:20:22.398] [PERF] /chat: 3199ms  rid=0d815846  (parseBody=0ms validate=1ms workspace=0ms engine=2179ms chat=1019ms)
[2026-03-31 00:20:30.097] [PERF] sse.firstToken  session=ses_2c0742965ffebmYiW5e8JIydTk
[2026-03-31 00:20:30.097] [PERF] acp.prompt.sendToFirstUpdate: 7699ms  sessionId=ses_2c0742965ffebmYiW5e8JIydTk
```

---

*报告生成时间: 2026-03-31*  
*备注: 本报告仅针对“新会话首条消息首次响应（first token）”口径，不包含完整回答结束耗时优化判断。*
