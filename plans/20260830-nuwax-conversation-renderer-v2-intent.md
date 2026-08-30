# 意图：Nuwax V2 可控会话渲染双线重构

- 日期：2026-08-30　发起人：用户（dongdada29）
- 状态：已接受（用户在 codex 会话 01a04e2c-3806-7ae0-b598-25bf048b13de Plan Mode 中逐项确认全部产品决策；交接给 zcode 实施并指定完整计划文本）

## 问题

上一版「普通会话工作轨迹折叠」（子模块 421150e9c，已 revert 为 941b3ca65）把整轮思考/工具/中间说明重新拼回一段 Markdown 再套一个大折叠，效果简陋、不像完整产品：

- 思考、上下文、工具、子智能体、中间说明没有稳定的视觉语义，展开后仍是旧工具卡与 Markdown 混排。
- 折叠头只有计数，没有可读的运行摘要；无法按类别控制"展示哪些内容、展到多深"。
- 现有三档「会话密度」只控制默认展开，无法控制类别可见性与详情深度。
- 投影靠 Markdown 正则重解析，流式更新、分页、重复调用、嵌套子调用下节点身份不稳定。
- 该实现与旧渲染逻辑耦合在同一条渲染链上，出问题只能整体回滚（事实上已整体 revert）。

## 预期结果

- 普通会话获得一套全新的 V2 渲染器：整轮过程投影为结构化节点（reasoning/context/narration/tool/subagent/plan/completed-interaction/unknown），两级渐进披露——外层一条轻量工作轨迹 disclosure，展开后按真实顺序显示单行节点，点击节点再看受限高度详情。
- 用户原始输入独立气泡；最终回答始终在轨迹下方以正常 Markdown 常显；待回答审批/提问卡独立置顶可见。
- V2 支持三档预设（focused/balanced/detailed）与逐类 hidden/summary/expanded 高级覆盖；隐藏项保留"另有 N 项已隐藏"恢复入口。
- V2 默认开启，可通过全局设置、会话覆盖或 URL 参数即时退回 V1；V2 投影异常时整份会话自动回退 V1，不白屏。
- 旧 ChatView + MarkdownRenderer 完全冻结，V1 行为与测试零变化。
- conversationRuntime 数据线（legacy/runtime）与渲染线（V1/V2）正交，形成 2×2 对照矩阵。
- AppDev、移动端、Electron IPC、后端协议不变。

## 受影响的用户与系统

- 用户：普通会话（桌面客户端内嵌 nuwax Web）使用者。
- 系统：nuwax 子模块（src/features/conversation/ 渲染与投影层、配置存储、mock/e2e 场景、生产 dist）；父仓仅新增 SDLC 工件与子模块 gitlink bump。
- 明确不受影响：agent-electron-client、agent-kit、windows-sandbox-helper、后端、AppDev 入口、移动端。

## 约束

- 从已还原基线（子模块 941b3ca65 = cacf6f44d 文件树）继续；父仓现有 Electron/MCP 脏修改保留、不 stash、不混入提交。
- 禁止 git add -A；不 push、不打 tag、不发布。
- 本期复用现有工具专属内容组件，不重做每种工具卡。
- DeepSeek Harness 仅作信息层级与 disclosure 交互参考，不复制实现。
- 已知基线：ChatView 8/8；MarkdownRenderer 3 个既存失败（2 LaTeX 换行 + 1 旧标签编码，不属本需求，不伪装成回归）。

## 开放问题

（无——全部产品决策已在 codex 会话中收敛：过程范围=全部过程内容、覆盖范围=仅普通会话、V2 默认开启且可即时回退、运行轮外层默认展开、终态 balanced 默认收起、消息计数口径、header 为"N 次工具调用 · M 条消息 · 已工作 T"。）
