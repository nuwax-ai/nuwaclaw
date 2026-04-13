# Electron 相关方案留存（2026-03）

本文档固化若干**已落地或评审通过**的设计与修复，便于后续合并分支、排查回归时对照。实现位置以 `nuwax-agent` 主仓库为准；独立 worktree 中的实验以「附录」说明。

---

## 1. FirstTokenTrace 请求级采样（均匀分布）

### 问题

按 `requestId` 的 MD5 前 8 个十六进制字符得到 32 位无符号整数，若除以 `0xFFFFFFFF`（即 \(2^{32}-1\)），则最大哈希对应比值为 **1.0**，严格说不属于半开区间 \([0, 1)\)，且与「将 \(2^{32}\) 个整点均匀映射到单位区间」的常规定义不一致，在 `sampleRate` 接近 1 时会产生可观测偏差。

### 方案

- 除数使用 **\(2^{32}\)**，即十六进制字面量 `0x100000000`（或等价 `2 ** 32`）。
- 判定仍为 `v < sampleRate`，其中 `v ∈ [0, 1)`。

### 代码位置

- `src/main/services/engines/perf/firstTokenTrace.ts` → `shouldSample()`

### 与性能报告的关系

首条消息/首 token 相关分析见 `docs/optimization/MACOS-FIRST-MESSAGE-PERF-REPORT-2026-03-31.md` 等；采样用于控制磁盘与日志量，不影响功能正确性，但影响统计代表性。

---

## 2. `sync-oss.sh` 与 GitHub Actions 运行记录

### 背景

脚本在**本机**通过 `gh` 触发 **目标仓库**（默认 `nuwax-ai/nuwaclaw`）的 `sync-electron-to-oss.yml`，此前存在两类风险：

1. **`gh run list --limit 1`**：取的是「列表中最新一条」，并发或他人刚触发的 run 会导致**跟错 run**。
2. **未指定 `--repo`**：`gh` 默认指向当前 checkout 的仓库；若在 `nuwax-agent` 目录执行而实际 dispatch 到 `nuwaclaw`，会列到**错误仓库**的 run。

### 方案

1. 在发起 `workflow_dispatch` 的 HTTP 请求**之前**，记录 `START_EPOCH`（当前 UTC 时间戳减约 10 秒，抵消客户端与 GitHub 时钟差）。
2. 触发成功后轮询 `gh run list --repo "$REPO" --workflow=sync-electron-to-oss.yml`，在结果中筛选：
   - `event == "workflow_dispatch"`；
   - `createdAt` 解析为 epoch 后 **≥ `START_EPOCH`**；
   - 取其中按时间**最新**一条的 `databaseId`。
3. 所有 `gh run view` / 输出日志 URL 均带 **`--repo "$REPO"`**。
4. 若在超时轮询内仍无法解析 run，脚本失败并提示用户用 `gh run list --repo "$REPO"` 人工核对。

### 残余边界

同一秒内对**同一仓库**多次 `workflow_dispatch`，仍可能歧义；若未来需要，可在 workflow `inputs` 中增加显式关联 ID。

### 相关文档

- `docs/NUWACLAW-WORKFLOW-DISPATCH.md`：在 nuwaclaw 侧启用 workflow、Secrets、一次性复制路径说明。

---

## 3. CI 中版本号校验：POSIX `grep` 与 `ripgrep`

### 问题

在 `ubuntu-latest` 上若使用 `rg -q` 做 `x.y.z` 校验，**默认镜像未必安装 ripgrep**，校验步骤可能静默失败或整条 step 失败，与「MVP 仅允许纯数字三段版本」的意图不符。

### 方案

在 shell 中使用 **`grep -Eq '^[0-9]+\.[0-9]+\.[0-9]+$'`**，依赖 POSIX 环境即可，与 `sync-electron-to-oss.yml` / `release-electron.yml` 中生成 `latest.json` 的版本字段策略一致。

### 落地说明

带 `channel`（stable/beta）与上述校验的 workflow 变更可能位于独立分支或 worktree；合并到主分支后，**nuwax-agent 与 nuwaclaw 两侧 workflow 文件应保持同步**（以实际执行 release/OSS 的仓库为准）。

---

## 4. 附录：stable / beta 更新通道（规划/分支）

目标与 OSS 路径约定（先 beta 再 stable、beta 不写 `latest/latest.json` 等）见独立说明文档草案；若已合入主仓库，路径为：

- `docs/RELEASE-CHANNELS.md`（若不存在，可参考 worktree `feat/stable-beta-update-channel` 内同名文件）

客户端侧要点（实现以合入后的代码为准）：

- SQLite `update_channel` 决定拉取的 `latest.json` URL（stable 与 beta 不同路径）。
- 旧版客户端仅读 `latest/`，行为保持不变。

---

## 5. 文档索引

| 主题 | 路径 |
|------|------|
| OSS 仅同步 workflow 启用说明 | [../NUWACLAW-WORKFLOW-DISPATCH.md](../NUWACLAW-WORKFLOW-DISPATCH.md) |
| 自动更新架构 | [../architecture/auto-update.md](../architecture/auto-update.md) |
| nuwaxcode 二进制签名说明 | [../NUWAXCODE-BINARY-SIGNING-2026-03-28.md](../NUWAXCODE-BINARY-SIGNING-2026-03-28.md) |
| macOS 首条消息性能报告 | [../optimization/MACOS-FIRST-MESSAGE-PERF-REPORT-2026-03-31.md](../optimization/MACOS-FIRST-MESSAGE-PERF-REPORT-2026-03-31.md) |

---

*文档状态：留存归档；若实现迁移或策略变更，请在本文件顶部更新「最后修订」并保留变更摘要。*

**最后修订：2026-03-31**
