# NuWaClaw 0.13.18 提测清单

> 交付测试同学：按 **新增功能 / Bugfix / 优化重构** 分组验收。

| 项 | 内容 |
|----|------|
| 发布版本 | **0.13.18**（tag: `electron-v0.13.18`） |
| 起点 commit | `f0e4e9723aa83b63319aa06333cc6cab215b698d`（0.12.60） |
| 终点 commit | `bf62d28ff1266587d0846a8bf6f75735ae64ec8e`（0.13.18） |
| 时间跨度 | 2026-07-16 → 2026-08-06 |
| 有效提交 | 约 51 条（含 feat / fix / refactor / chore） |
| 依赖关注 | `@nuwax-ai/agent-kit@0.3.2`、`@nuwax-ai/mcp-proxy-ts@1.5.4`、`@nuwax-ai/nuwax-codex-acp-ts@1.2.8` |
| 相对 0.13.16 增量 | `bf62d28f`：升级 `nuwax-codex-acp-ts` 至 1.2.8（nuwax-codex 0.17.8） |

**建议优先级**：P0 必测 → P1 重点 → P2 回归 / 平台专项。

---

## 一、新增功能（Feature）

### 1. Codex 引擎迁移至 TS adapter（P0）

- **变更**：Codex 从原路径迁移到 `@nuwax-ai/nuwax-codex-acp-ts`；resolve / 依赖检测走 `@nuwax-ai/agent-kit` 与 TS adapter。
- **相关提交**：`70a1332e`、`68c46efe`、`d3bd32f1`、`224d4b0a` 及后续 `1.2.5`→`1.2.8` 升级（`bf62d28f`）。
- **测试要点**
  - [ ] 设置中可选择 / 检测到 Codex（TS adapter）依赖状态正常
  - [ ] 使用 Codex 新建会话、发送消息、流式回复正常
  - [ ] 模型列表同步正常（含旧版 codex 返回 Invalid params 时不崩溃）
  - [ ] 切换 Claude Code ↔ Codex 后会话与权限行为正常

### 2. 临时强制引擎开关 `NUWACLAW_FORCE_ENGINE`（P1）

- **变更**：支持通过环境变量临时强制引擎（便于测 codex-acp）。
- **相关提交**：`6b79fd9d`
- **测试要点**
  - [ ] 设置 `NUWACLAW_FORCE_ENGINE` 后实际启动引擎与预期一致
  - [ ] 未设置时行为与 UI 选择一致，无意外覆盖

### 3. file-server / lanproxy 真实启动健康检查（P0）

- **变更**：启动期接入真实健康检查（非占位逻辑）；后续健康谓词接入 agent-kit。
- **相关提交**：`f1427907`、`45c117b7`
- **测试要点**
  - [ ] 正常环境下 file-server、lanproxy 启动后健康状态为成功
  - [ ] 故意停掉 / 阻断进程后，健康检查能反映失败（日志/UI 可见）
  - [ ] 应用启动不被健康检查长时间卡死

### 4. 内置 OpenUI（nuwax-openui）走 Persistent Bridge（P0）

- **变更**：内置 OpenUI 接入 persistent bridge；后续升级为会话级 Artifact 持久化（随项目 cwd）。
- **相关提交**：`87eb203f`、`0c5918a2`、`3447405d`、`ea80cea6`、`cfc6dc5b` 等
- **测试要点**
  - [ ] 会话中可正常使用 OpenUI / Artifact
  - [ ] Artifact 按会话 / 项目 cwd 持久化，重启或重开会话后仍可访问
  - [ ] OpenUI MCP 能正常通过 npx 启动（无「找不到 bin」）

### 5. MCP 表单编辑器支持 stdio `env` 配置（P1）

- **变更**：MCP Server 编辑器可配置 stdio 环境变量。
- **相关提交**：`2d39dd7e`
- **测试要点**
  - [ ] 新增 / 编辑 MCP 时可填写 env（key-value）
  - [ ] 保存后配置持久化，MCP 进程能读到对应环境变量
  - [ ] 清空 / 删除 env 后行为正确

### 6. MCP 配置 JSON 支持宽松解析（P1）

- **变更**：MCP 配置 JSON 输入支持更宽松的解析（如容错格式）。
- **相关提交**：`c319e414`
- **测试要点**
  - [ ] 粘贴带尾逗号等「略不规范」但常见的 JSON 可成功解析
  - [ ] 真正非法 JSON 仍有明确错误提示，不会静默失败

---

## 二、Bugfix（缺陷修复）

### 1. 单日日志被 1MB 轮转拆成 `.log` + `.old.log`（P0）

- **相关提交**：`e818d805`
- **验证**
  - [ ] 当日日志保持单文件（或符合产品预期的按日策略），不被默认 1MB 拆成 `.old.log`
  - [ ] 长时间运行 / 日志量偏大时仍可正常写入与查看

### 2. SSE 流式中文乱码（chunk 边界切断多字节）（P0）

- **相关提交**：`c368930c`
- **验证**
  - [ ] 长中文回复流式输出无乱码、无半个汉字
  - [ ] 中英混排、标点、emoji 混合场景显示正常

### 3. Webview 输入框红色拼写波浪线（P1）

- **相关提交**：`348bcdfa`
- **验证**
  - [ ] 应用内网页输入框无红色拼写检查波浪线（session 级关闭拼写检查）

### 4. 打包后 MCP Proxy 无法解析 / Bridge 加载失败导致启动崩溃（P0）

- **相关提交**：`b67c5deb`、`d1901925`
- **验证**
  - [ ] **安装包**冷启动不崩溃
  - [ ] PersistentMcpBridge / `@nuwax-ai/mcp-proxy-ts/host` 可正常加载
  - [ ] MCP 列表加载与常用 MCP 启动正常

### 5. OpenUI / npx 启动失败与兼容性（P0）

- **相关提交**：`74cde7c5`、`5d2557a7`、`248f8ff7`、`4a1d7178` 等（最终依赖对齐至 openui-mcp 较新版本）
- **验证**
  - [ ] OpenUI 可通过标准包名 + `-p` 指定 bin 正常启动
  - [ ] 首次启动（需拉包）与二次启动均成功

### 6. ACP 权限干预 envelope 丢失（P0）

- **相关提交**：`8b901cfd`
- **验证**
  - [ ] Ask / 权限审批弹窗字段完整，批准 / 拒绝后链路正常
  - [ ] 干预结果能正确回传引擎，无「点了没反应 / 结构丢失」

### 7. ask-question ACP 更新归一化异常（P0）

- **相关提交**：`01888b8e`
- **验证**
  - [ ] MCP Ask Question 工具调用 UI 更新正常（进行中 / 完成 / 取消）
  - [ ] 与权限门控工具更新不互相干扰

### 8. Codex model sync 遇 Invalid params 崩溃 / 失败过严（P1）

- **相关提交**：`6213c29d`
- **验证**
  - [ ] 兼容旧 adapter（如 0.17.4）返回 Invalid params 时应用可容忍，不阻断主流程

### 9. 开发环境 `dev:electron` 因 native 依赖未构建失败（P2 / 研发）

- **相关提交**：`d1ecc57f`
- **验证**
  - [ ] 干净安装后 `dev:electron` 可启动（electron / better-sqlite3 等已列入 onlyBuiltDependencies）

### 10. agent-kit / esbuild / asar 打包崩溃（P0 · 安装包）

- **相关提交**：`f81bff28`、`1b8bd9f6`、`c0e8b0bc`
- **验证**
  - [ ] electron-builder 打包成功（asar 无 agent-kit 解析失败）
  - [ ] 安装包启动无 `fileURLToPath(import.meta.url)` / createRequire 相关崩溃

### 11. macOS / Windows 二进制签名与公证（P0 · 平台）

- **相关提交**：`19fa51cf`、`6fc9b2e5`、`bfa1acbf`、`127ceb94`
- **验证**
  - [ ] **macOS**：安装 / 首次打开无异常 Gatekeeper 弹窗；Resources 内相关二进制已签名；公证 ticket 已 staple
  - [ ] **Windows**：`nuwax-codex-acp-ts` 二进制已签名，SmartScreen / 报毒误报可控
  - [ ] **Linux arm64**：`nuwax-codex-acp-ts@1.2.8` 可运行（`5a89ebc4` / `67654c3e` / `bf62d28f`）

### 12. OPENCODE MCP 双路径注入导致 session/new 偏慢（见优化）（P1）

- **相关提交**：`874557f2`（fix，同时带来加速）
- **验证**：见下方「优化」对应项。

---

## 三、优化 / 重构（Optimize & Refactor）

### 1. MCP 代理改为 npm 包 + 启动期 npx 缓存预热（P0）

- **变更**：移除仓内 `nuwax-mcp-stdio-proxy`；切换 `@nuwax-ai/mcp-proxy-ts` / `@nuwax-ai/mcp-stdio-proxy`；启动期预热 npx 缓存。
- **相关提交**：`4c6ead61`、`f6acaaef`、`91a8ce87`、`514c22a9`
- **测试要点**
  - [ ] 安装包 / 开发包 MCP 代理链路可用
  - [ ] 二次启动 MCP 相关冷启动时间可接受（预热生效）
  - [ ] 默认代理配置中不再错误注入已移除的 ask-question / openui 默认项（`fb72c0e4`）

### 2. 关闭 OPENCODE MCP 双路径注入，加速 session/new（P1）

- **相关提交**：`874557f2`
- **测试要点**
  - [ ] OpenCode / 相关引擎新建会话耗时优于改前（主观或打点）
  - [ ] MCP 能力未因关闭双路径而缺失

### 3. agent-kit 迁入 workspace 并接入权限核心（P1）

- **相关提交**：`86f97ca5` 及后续 npm 化 / 0.3.x 修复
- **测试要点**
  - [ ] 权限审批、Ask Question、工具门控与改前一致或更好
  - [ ] 安装包不依赖本地 workspace 构建即可运行（agent-kit 走 npm）

### 4. lanproxy 健康检查骨架接入 agent-kit（P1）

- **相关提交**：`45c117b7`
- **测试要点**
  - [ ] 与「真实健康检查」功能联合回归：启动、失败、恢复场景

### 5. Claude Code session warmup 调整（P2）

- **相关提交**：`0a0ce7ae`
- **测试要点**
  - [ ] Claude Code 首条消息 / 会话预热行为正常，无异常延迟或失败

### 6. 依赖与版本对齐（P2 · 回归）

- **相关提交**：`77bccefe`、`b1055663`（Revert nuwaxcode 1.17.6）、mcp-proxy / openui / codex-acp-ts 多次 bump
- **测试要点**
  - [ ] 当前交付包依赖版本与发版说明一致
  - [ ] 无「半升级」导致的引擎 / MCP 启动失败

---

## 四、建议测试矩阵（速查）

| 场景 | 类型 | 优先级 | 平台 |
|------|------|--------|------|
| 安装包冷启动 | Bugfix / 打包 | P0 | macOS / Windows（+ Linux 有条件） |
| Claude Code 对话（含中文长流式） | Bugfix | P0 | 全平台 |
| Codex 对话 + 模型同步 | Feature | P0 | 全平台 |
| 权限审批 / Ask Question | Bugfix | P0 | 全平台 |
| OpenUI Artifact 持久化 | Feature | P0 | 全平台 |
| MCP 增删改 + env + 宽松 JSON | Feature | P1 | 全平台 |
| file-server / lanproxy 健康检查 | Feature | P0 | 全平台 |
| 单日日志文件形态 | Bugfix | P0 | 全平台 |
| 签名 / Gatekeeper / SmartScreen | Bugfix | P0 | macOS / Windows |
| session/new 耗时（OpenCode） | Optimize | P1 | 抽样 |
| Webview 无拼写红线 | Bugfix | P1 | 全平台 |
| `NUWACLAW_FORCE_ENGINE` | Feature | P1 | 开发 / 专项 |

---

## 五、附录：完整提交按类型归类

### Feature

| Commit | 说明 |
|--------|------|
| `2d39dd7e` | feat(mcp): 表单编辑器支持 stdio env 配置 |
| `87eb203f` | feat(mcp): 内置 nuwax-openui 走 persistent bridge |
| `f1427907` | feat(electron): 接入真实 file-server / lanproxy 启动健康检查 |
| `c319e414` | feat(mcp): MCP 配置 JSON 输入支持宽松解析 |
| `70a1332e` | feat(codex): 迁移 codex 到 `@nuwax-ai/nuwax-codex-acp-ts` TS adapter |
| `68c46efe` | feat(codex): codex resolve 用 `@nuwax-ai/agent-kit` |
| `d3bd32f1` | feat(codex): 检测反映 codex TS adapter |
| `6b79fd9d` | feat: `NUWACLAW_FORCE_ENGINE` env 开关 |

### Bugfix

| Commit | 说明 |
|--------|------|
| `74cde7c5` | fix(mcp): openui 用 `-p` 显式指定 bin |
| `5d2557a7` | fix(mcp): openui 改回标准 npx 包名启动 |
| `248f8ff7` / `4a1d7178` / `0c5918a2` / `3447405d` | fix(mcp): openui-mcp 版本与会话级 Artifact |
| `b67c5deb` | fix(mcp): 打包后 mcp-proxy-ts/host 无法解析导致启动崩溃 |
| `d1901925` | fix(mcp): PersistentMcpBridge 运行期加载失败（ESM） |
| `348bcdfa` | fix(webview): session 级关闭拼写检查 |
| `c368930c` | fix(agent-runner): SSE 流式解码修复 CJK 乱码 |
| `874557f2` | fix(mcp): 关闭 OPENCODE MCP 双路径注入 |
| `d1ecc57f` | fix: pnpm onlyBuiltDependencies（修 dev:electron） |
| `6213c29d` | fix(codex): model sync 容忍 Invalid params |
| `19fa51cf` | fix(prepare): codex-acp-ts macOS ad-hoc 签名 |
| `6fc9b2e5` / `bfa1acbf` / `127ceb94` | fix(signing): macOS / Windows 签名与 staple |
| `01888b8e` | fix(agent-kit): normalize ask-question ACP updates |
| `8b901cfd` | fix(acp): preserve permission intervention envelope |
| `f81bff28` / `1b8bd9f6` / `c0e8b0bc` | fix(build): agent-kit 打包 / bundle / import.meta 崩溃 |
| `67654c3e` | fix(lockfile): sync pnpm-lock to nuwax-codex-acp-ts 1.2.7 |
| `e818d805` | fix(log): 修正单日日志被默认 1MB 轮转拆分 |

### Optimize / Refactor / Chore（影响测试的）

| Commit | 说明 |
|--------|------|
| `0a0ce7ae` | refactor(acp): warmup 调整（Claude Code） |
| `fb72c0e4` | refactor(mcp): 移除默认配置中的 ask-question / openui |
| `4c6ead61` | refactor(mcp): 仓内 proxy 改为 npm 包 |
| `f6acaaef` | refactor(mcp): 切换 mcp-proxy-ts + npx 预热 |
| `86f97ca5` | refactor(agent-kit): 迁入 workspace 并接入权限核心 |
| `45c117b7` | refactor(health): lanproxy envelope 谓词接入 agent-kit |
| `77bccefe` 等 | chore(version/deps): 版本与依赖对齐 |
| `b1055663` | Revert nuwaxcode 1.17.6（注意最终依赖以交付包为准） |
| `5a89ebc4` / `08c1c86a` / `410f9f43` / `bf62d28f` | chore: lockfile / gitignore / linux arm64 / codex-acp-ts 1.2.8 |

---

## 六、测试反馈模板（可选）

```text
【版本】0.13.18
【平台】macOS / Windows / Linux + 架构
【类型】Feature / Bugfix / Optimize
【条目】（文档中的标题编号）
【结果】通过 / 失败 / 阻塞
【步骤】
【期望】
【实际】
【日志/截图】
```

---

*文档生成说明：基于 `f0e4e972..bf62d28f` git 历史整理；发布版本以 tag `electron-v0.13.18` 为准。*
