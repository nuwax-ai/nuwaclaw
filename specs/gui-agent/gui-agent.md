# GUI Agent — Spec 规范文档

> **文档类型**: Spec（规范文档）— 描述"做什么"，定义功能范围与边界
>
> **状态**: Draft
>
> **日期**: 2026-03-17

---

## 1. 项目概述

### 1.1 是什么

一个以 **MCP Server** 形式运行的 GUI 桌面操作服务，供文本模型 Agent（如 claude-code、nuwaxcode）通过 MCP 协议调用，实现截图识别 + 键鼠模拟来自动操作桌面应用程序。

### 1.2 解决什么问题

- 文本模型 Agent 擅长代码/文件操作，但**无法操作图形界面**
- 需要一个标准化的 MCP 服务，让文本 Agent 可以**委托 GUI 操作任务**
- 文本 Agent 在工作中遇到 GUI 场景时（验证 UI、操作浏览器、填写表单等），能无缝调用

### 1.3 核心定位

```
用户
  │  自然语言对话
  ▼
文本 Agent (claude-code / nuwaxcode / 其他)     ← 决策者，理解用户意图
  │  MCP 协议调用
  ▼
GUI Agent MCP Server (本项目)                   ← 执行者，操作桌面
  │
  ├── 模式 A: 原子操作（截图/点击/输入）         ← 文本 Agent 自己编排步骤
  │
  └── 模式 B: 完整任务（自然语言 → Agent 循环）   ← GUI Agent 内部自主完成
```

**关键区分**：用户不直接与 GUI Agent 交互。文本 Agent 是"大脑"，GUI Agent 是"眼睛和手"。

---

## 2. 使用场景

### 2.1 典型场景

| 场景 | 文本 Agent 做什么 | GUI Agent 做什么 |
|------|------------------|-----------------|
| **验证 UI 效果** | 改完前端代码后，调 `gui_screenshot` 截图查看效果 | 截图返回 |
| **操作浏览器** | 调 `gui_execute_task("打开浏览器访问 http://localhost:3000 并截图首页")` | 自主完成：找到浏览器 → 输入 URL → 等待加载 → 截图返回 |
| **填写表单** | 逐步调 `gui_click` + `gui_type` 填写各字段 | 执行单次操作并返回 |
| **跨应用操作** | 调 `gui_execute_task("从 Excel 复制 A1:B10 的数据，粘贴到浏览器表单")` | 自主完成多步跨应用操作 |
| **安装软件** | 调 `gui_execute_task("双击桌面上的安装包，按默认选项完成安装")` | 自主完成安装向导的多步点击 |

### 2.2 调用方角色

- **主要**: 文本模型 Agent（claude-code、nuwaxcode 或任何支持 MCP 的 Agent）
- **次要**: NuwaClaw Electron 客户端（通过 SDK 嵌入方式集成）

### 2.3 GUI Agent 不面对的角色

- **终端用户** — 用户与文本 Agent 对话，不直接操作 GUI Agent
- 因此**不需要 CLI 交互模式**，不需要 TUI/Web UI

---

## 3. 功能需求

### 3.1 MCP 服务（核心功能）

GUI Agent 的**唯一入口**是 MCP 协议。暴露两类 Tool：

#### 3.1.1 原子操作工具（文本 Agent 自行编排）

文本 Agent 可以逐步调用这些工具，自己决定操作顺序：

| MCP Tool | 描述 | 入参 | 出参 |
|----------|------|------|------|
| `gui_screenshot` | 全屏截图 | `displayIndex?` | `{ image, mimeType, imageWidth, imageHeight, logicalWidth, logicalHeight, scaleFactor }` |
| `gui_click` | 鼠标单击 | `x`, `y`, `button?`, `coordinateMode?` | `{ success, elapsed }` |
| `gui_double_click` | 鼠标双击 | `x`, `y`, `button?`, `coordinateMode?` | `{ success, elapsed }` |
| `gui_move_mouse` | 移动鼠标 | `x`, `y`, `coordinateMode?` | `{ success }` |
| `gui_drag` | 鼠标拖拽 | `startX`, `startY`, `endX`, `endY`, `button?`, `coordinateMode?` | `{ success, elapsed }` |
| `gui_scroll` | 滚动 | `x`, `y`, `deltaY`, `deltaX?`, `coordinateMode?` | `{ success }` |
| `gui_type` | 输入文本 | `text` | `{ success, elapsed }` |
| `gui_press_key` | 按下单键 | `key` | `{ success }` |
| `gui_hotkey` | 组合键 | `keys[]` | `{ success }` |
| `gui_cursor_position` | 获取光标位置 | 无 | `{ x, y }` |
| `gui_list_displays` | 获取显示器列表 | 无 | `{ displays: [...] }` |
| `gui_find_image` | 在屏幕上查找图像 | `templateImage`, `confidence?` | `{ found, region?, confidence? }` |
| `gui_wait_for_image` | 等待图像出现 | `templateImage`, `timeout?`, `confidence?` | `{ found, region?, elapsed }` |

#### 3.1.2 完整任务工具（GUI Agent 自主执行）

文本 Agent 下发自然语言任务，GUI Agent 内部启动 Agent 循环自主完成：

| MCP Tool | 描述 | 入参 | 出参 |
|----------|------|------|------|
| `gui_execute_task` | 执行完整的 GUI 任务（同步阻塞） | `task: string`, `maxSteps?` | `{ success, result?, finalScreenshot?, steps[], error? }` |

**同步阻塞执行**：`gui_execute_task` 是标准的 MCP tool call，handler 内部 await Agent 循环完成后返回结果。利用 MCP SDK 原生机制：

| 能力 | MCP SDK 机制 | 说明 |
|------|-------------|------|
| **进度通知** | `notifications/progress` + `extra.sendNotification()` | 每步操作通过 progressToken 推送进度 |
| **请求取消** | `extra.signal`（AbortSignal） | 客户端可随时取消，handler 中监听 signal 终止 Agent 循环 |
| **连接断开** | Transport 关闭自动触发 AbortSignal | 无需手动管理 session 清理 |

**互斥执行**：桌面同一时间只能有一个 GUI 操作者。通过互斥锁（Mutex）确保同时只有一个 `gui_execute_task` 在执行，第二个调用等待锁释放后再执行。

#### 3.1.3 MCP Resources（信息暴露）

| Resource | 描述 |
|----------|------|
| `gui://status` | 服务状态（运行中、平台、权限） |
| `gui://permissions` | 当前平台权限状态 |
| `gui://audit-log` | 最近操作审计日志 |

#### 3.1.4 MCP 传输方式

| 传输 | 启动方式 | 适用场景 |
|------|---------|---------|
| **Streamable HTTP**（主模式） | `gui-agent --port 60008` | 持久化本地 HTTP 服务，多个 Agent 客户端通过 URL 连接 |
| **stdio**（备选） | `gui-agent --transport stdio` | 单个文本 Agent spawn 子进程，简单场景 |

**Streamable HTTP 主模式说明**：

参考 `nuwax-mcp-stdio-proxy` 的 proxy 模式，GUI Agent 作为**持久化本地 HTTP 服务**启动：

- 监听 `127.0.0.1:<port>`，长期运行
- 多个文本 Agent（claude-code、nuwaxcode 等）通过 MCP URL 连接，各自独立 session
- 每个客户端连接创建独立的 `StreamableHTTPServerTransport` + MCP Server 实例
- Session 通过 `mcp-session-id` HTTP header 跟踪，支持 session 清理
- 桌面是共享资源，`gui_execute_task` 通过互斥锁确保同时只有一个在执行（见 3.1.2）

---

### 3.2 Agent 循环（`gui_execute_task` 内部实现）

当文本 Agent 调用 `gui_execute_task` 时，GUI Agent 内部启动一个自主循环：

```
收到任务文本
  ↓
截取屏幕 → 缩放到模型目标分辨率 → 转 JPEG base64
  ↓
构造多模态消息（截图 + 任务描述 + 上下文）→ 调用 LLM
  ↓
LLM 分析 UI 并返回 tool call（含模型格式的坐标）
  ↓
CoordinateResolver: 模型坐标 → 归一化 → 逻辑坐标
  ↓
执行桌面操作（nut.js 使用逻辑坐标）
  ↓
再次截图验证操作结果
  ↓
循环直到：LLM 判断任务完成 / 达到 maxSteps / 被 abort
  ↓
返回结果给调用方（通过 MCP response）
```

**pi-mono 集成方式**：
- 使用 `@mariozechner/pi-ai` 作为 LLM 调用层（多 Provider 统一接口）
- 使用 `@mariozechner/pi-agent-core` 的 tool calling 循环
- 桌面操作工具通过 pi-mono 的 **extension/tool 注册机制**注入
- 利用 pi-mono 的 **context compaction** 处理长任务的 token 溢出

**借鉴 TuriX-CUA 的三层记忆管理**：
- **Summary**：更早步骤的高度压缩摘要（由 LLM 总结），超限时做"摘要的摘要"
- **Recent**：最近完成的步骤记录 + 评估结果
- **Pending**：当前正在执行的步骤，完成后移入 Recent
- **目的**：Agent 循环每步都带截图（base64 很大），历史截图如果不压缩会迅速撑爆 context window
- 当 Recent 超预算时触发 LLM 摘要压缩：总结文字 → 移入 Summary，丢弃旧截图 base64，保留文字描述
- 记忆摘要可使用独立的更便宜模型（通过 `GUI_AGENT_MEMORY_MODEL` 配置）

### 3.3 多模型 LLM 支持

- **必须支持**: Anthropic (Claude)、OpenAI 协议
- 支持任何 OpenAI 兼容端点（Azure OpenAI、本地 vLLM 等）
- 支持多模态输入（截图图片 + 文本）
- 支持 tool calling（LLM 返回要执行的桌面操作）
- 模型配置通过环境变量或配置文件传入

### 3.4 截图与坐标系统（核心难点）

#### 3.4.1 问题本质

GUI Agent 的核心循环是"截图 → 视觉模型分析 → 输出坐标 → 执行点击"。

**关键认知**：视觉模型输出的坐标格式是**训练数据决定的**，不是推理时可以改变的。不同模型的训练方式完全不同，坐标格式各异。**坐标转换必须由系统层完成**，绝不能让模型自己计算缩放——模型做数学运算误差极大。

#### 3.4.2 三层坐标空间

```
┌─────────────────────────────────────────────────────────┐
│  Layer 1: 物理分辨率 (Physical Pixels)                   │
│  macOS Retina 15": 2880 × 1800                          │
│  Windows 150% DPI: 2880 × 1620                          │
│  说明: 屏幕的实际像素数                                   │
├─────────────────────────────────────────────────────────┤
│  Layer 2: 逻辑分辨率 (Logical Points)                    │
│  macOS Retina 15": 1440 × 900  (scaleFactor = 2)        │
│  Windows 150% DPI: 1920 × 1080 (scaleFactor = 1.5)      │
│  说明: OS 报告的坐标空间，nut.js 操作使用此坐标            │
├─────────────────────────────────────────────────────────┤
│  Layer 3: 发送给模型的图片像素 (Image Pixels)             │
│  需要按模型要求缩放到特定尺寸再发送                       │
│  不同模型要求不同（见 3.4.3）                             │
└─────────────────────────────────────────────────────────┘
```

#### 3.4.3 各视觉模型的坐标格式（调研数据）

| 模型 | 坐标格式 | 坐标范围 | 推荐截图分辨率 | 说明 |
|------|---------|---------|---------------|------|
| **Claude computer_use** | 图片绝对像素 | (0, 0) ~ (imgW, imgH) | **1024×768** 或 **1280×800** | Anthropic 推荐缩放到 XGA/WXGA，模型输出该图片空间的绝对坐标。最大边不超过 1568px |
| **GPT-4o / GPT-5.4** | 图片绝对像素 | (0, 0) ~ (imgW, imgH) | 原始分辨率（最大 10.24M 像素） | OpenAI CUA 输出图片像素空间的绝对坐标 |
| **Gemini 2.5** | 归一化 0-999 | (0, 0) ~ (999, 999) | **1440×900** | Google 推荐；输出归一化网格坐标，与分辨率无关 |
| **UI-TARS** (ByteDance) | 归一化 0-1000 | (0, 0) ~ (1000, 1000) | 任意 | 输出千分比坐标，与图片实际尺寸无关 |
| **Qwen2.5-VL** | 图片绝对像素 | (0, 0) ~ (imgW, imgH) | 任意 | 输出 bbox 格式 [x1, y1, x2, y2] 的图片绝对坐标 |
| **CogAgent** | 图片绝对像素 | (0, 0) ~ (imgW, imgH) | ≤1120×1120 | 输出 box 格式的图片绝对坐标 |
| **SeeClick / ShowUI** | 归一化 0-1 | (0.0, 0.0) ~ (1.0, 1.0) | 任意 | 输出小数比例坐标，完全分辨率无关 |

**三大坐标家族**：

| 家族 | 代表模型 | 特征 |
|------|---------|------|
| **图片绝对像素** | Claude CU、GPT CUA、Qwen2.5-VL、CogAgent | 坐标与发送的图片尺寸强绑定，换图片大小坐标就变 |
| **归一化千分制** | UI-TARS、Gemini | 0-999 或 0-1000，与图片尺寸无关 |
| **归一化小数** | SeeClick、ShowUI | 0.0-1.0，与图片尺寸无关 |

#### 3.4.4 截图策略：统一分级缩放

**核心原则**：截图必须从物理分辨率缩放到逻辑分辨率（吸收 scaleFactor），否则坐标会偏移 scaleFactor 倍。逻辑分辨率过大时进一步等比缩放。

**统一分级缩放策略**（参考 TuriX-CUA，不按模型区分）：

不同模型的坐标转换都会经过归一化步骤（`modelX / imageWidth` 或 `modelX / 1000` 等），数学上与截图发送的分辨率无关。因此**不需要按模型匹配不同截图分辨率**。

```
屏幕 (逻辑 1440×900, 物理 2880×1800)
  │
  │  全屏截图 → 原始图片 (物理分辨率 2880×1800)
  │
  │  Step 1: 缩放到逻辑分辨率 (吸收 scaleFactor)
  │          2880×1800 → 1440×900
  │
  │  Step 2: 逻辑分辨率最长边 > 1920 时，等比缩放到最长边 1920
  │          例: 2560×1440 → 1920×1080
  │
  │  Step 3: 转 JPEG quality=75 进一步压缩
  ▼
发送给视觉模型 (base64 JPEG)
```

| 逻辑分辨率最长边 | 缩放策略 | 示例 |
|----------------|---------|------|
| ≤ 1920 | 不缩放（保持逻辑分辨率） | 1440×900 → 1440×900 |
| 1921 ~ 2560 | 等比缩放到最长边 1920 | 2560×1440 → 1920×1080 |
| > 2560 | 等比缩放到最长边 1920 | 3840×2160 → 1920×1080 |

#### 3.4.5 坐标转换链路

```
截图 (全屏, 物理分辨率)
  │
  │  统一分级缩放（见 3.4.4）
  ▼
发送给视觉模型
  │
  │  模型输出坐标 (model_x, model_y)，格式由训练决定
  ▼
CoordinateResolver（四步转换）
  │
  │  Step 1: 坐标顺序修正（Gemini yx → xy swap）
  │  Step 2: 模型坐标 → 归一化 (0~1)
  │  Step 3: 归一化 → 逻辑坐标（相对于目标显示器）
  │  Step 4: 逻辑坐标 + 显示器偏移 → 全局坐标
  ▼
nut.js mouse.click(global_x, global_y)
```

**Step 1 — 坐标顺序修正**：

| 坐标顺序 | 处理 | 适用模型 |
|----------|------|---------|
| `xy`（默认） | 不变，`rawX = model_x, rawY = model_y` | Claude、GPT、UI-TARS、Qwen 等 |
| `yx`（Gemini） | swap，`rawX = model_y, rawY = model_x` | Gemini 系列 |

**Step 2 — 模型坐标 → 归一化 (0~1)**：

| 坐标家族 | 归一化公式 |
|----------|-----------|
| 图片绝对像素 (Claude/GPT/Qwen) | `norm_x = rawX / imageWidth` <br> `norm_y = rawY / imageHeight` |
| 归一化 0-1000 (UI-TARS) | `norm_x = rawX / 1000` <br> `norm_y = rawY / 1000` |
| 归一化 0-999 (Gemini) | `norm_x = rawX / 999` <br> `norm_y = rawY / 999` |
| 归一化 0-1 (SeeClick/ShowUI) | `norm_x = rawX` <br> `norm_y = rawY` |

**Step 3 — 归一化 → 逻辑坐标**（所有模型统一）：

```
local_x = norm_x × logicalWidth
local_y = norm_y × logicalHeight
```

**Step 4 — 逻辑坐标 + 显示器偏移 → 全局坐标**（多显示器场景）：

```
global_x = local_x + display.origin.x
global_y = local_y + display.origin.y
```

> 主显示器 origin 为 (0,0)，副屏有偏移（见 3.6.5）。边界校验：结果 clamp 到目标显示器范围内。

#### 3.4.6 完整示例

**场景**：macOS Retina，逻辑分辨率 1440×900，scaleFactor=2，使用 Claude computer_use

```
1. 全屏截图 → 物理 2880×1800 的原始图
2. 系统缩放到 Claude 目标分辨率 → 1280×800 的图片
3. 发送 1280×800 图片给 Claude
4. Claude 输出: "click at (640, 400)"  ← 图片绝对像素坐标
5. 归一化: norm_x = 640/1280 = 0.5, norm_y = 400/800 = 0.5
6. 逻辑坐标: x = 0.5 × 1440 = 720, y = 0.5 × 900 = 450
7. nut.js: mouse.click(720, 450)  ← 屏幕正中央 ✓
```

**场景**：同一屏幕，使用 UI-TARS

```
1. 全屏截图 → 物理 2880×1800 的原始图
2. 系统缩放到合理尺寸 → 1440×900 的图片
3. 发送 1440×900 图片给 UI-TARS
4. UI-TARS 输出: (500, 500)  ← 归一化千分比
5. 归一化: norm_x = 500/1000 = 0.5, norm_y = 500/1000 = 0.5
6. 逻辑坐标: x = 0.5 × 1440 = 720, y = 0.5 × 900 = 450
7. nut.js: mouse.click(720, 450)  ← 屏幕正中央 ✓
```

**场景**：同一屏幕，使用未知视觉模型（fallback）

```
1. 全屏截图 → 物理 2880×1800 的原始图
2. 未知模型，缩放到逻辑分辨率 → 1440×900 的图片
   （必须从物理缩到逻辑，否则坐标会偏移 scaleFactor 倍）
3. 发送 1440×900 图片给未知模型
4. 模型输出: "click at (720, 450)"  ← 按 image-absolute 处理
5. 归一化: norm_x = 720/1440 = 0.5, norm_y = 450/900 = 0.5
6. 逻辑坐标: x = 0.5 × 1440 = 720, y = 0.5 × 900 = 450
7. nut.js: mouse.click(720, 450)  ← 屏幕正中央 ✓
```

> **为什么 scaleFactor 不需要显式出现在坐标公式中？**
>
> 因为截图从物理分辨率缩放到目标/逻辑分辨率时，scaleFactor 已被"吸收"。
> 最终 Step 2 乘的是 `logicalWidth` 而非 `physicalWidth`，这本身就是对 DPI 的处理。
> 如果跳过缩放直接把物理分辨率的截图发给模型，模型输出的坐标会比逻辑坐标大 scaleFactor 倍，点击位置会偏到屏幕外。

#### 3.4.7 截图图片约束（API 限制）

视觉模型 API 对输入图片有严格的大小和格式限制，截图必须在发送前处理：

| 模型/Provider | 单图大小限制 | 最大分辨率 | 推荐格式 |
|--------------|-------------|-----------|---------|
| Claude (Anthropic) | 基于 token 计算（~1600 token/图） | 最长边 1568px，总 ≤1.15MP | JPEG/PNG/WebP |
| GPT-4o (OpenAI) | 20MB | 最大 10.24MP；低分辨率模式 512×512 | JPEG/PNG/WebP |
| Gemini (Google) | 20MB | 无硬限，但推荐 ≤1440×900 | JPEG/PNG/WebP |
| Qwen2.5-VL | 取决于部署配置 | 建议 ≤1280×800 | JPEG/PNG |
| UI-TARS | 取决于部署配置 | 建议 ≤1280×800 | JPEG/PNG |

**截图处理管线**：

```
全屏截图（物理分辨率，PNG lossless）
  │
  │  1. 缩放到逻辑分辨率（吸收 scaleFactor）
  │     物理截图必须缩放，至少缩到逻辑分辨率，
  │     否则模型坐标 → 逻辑坐标的转换会因 scaleFactor 偏移
  │     逻辑分辨率最长边 > 1920 时，等比缩放到最长边 1920
  │     使用 LANCZOS 重采样保证质量
  ▼
  │  2. 转为 JPEG 格式 + 调整质量
  │     quality 参数平衡文件大小与清晰度
  │     默认 quality=75
  ▼
  │  3. 检查文件大小是否超限
  │     超限则降低 quality 重新编码
  ▼
  │  4. 转 base64 编码
  ▼
发送给视觉模型 (base64 JPEG)
```

**为什么用 JPEG 而不是 PNG**：
- 全屏截图的 PNG 通常 2-10MB，JPEG quality=75 可压缩到 100-300KB
- 视觉模型不需要像素级无损精度，JPEG 的压缩损失对 UI 识别无影响
- 大幅减少 base64 编码后的 token 消耗和网络传输时间
- 连续截图场景（Agent 循环每步都截图），累计节省非常显著

**quality 参数策略**：
- 默认 `quality=75`：清晰度与文件大小的最佳平衡
- 小文字/高密度 UI：可提高到 `quality=90`
- Token 敏感场景：可降低到 `quality=60`
- 可通过 `GUI_AGENT_JPEG_QUALITY` 环境变量覆盖（仅内部调试用）

#### 3.4.8 截图元数据

每次截图必须携带完整元数据，坐标转换依赖这些值：

```typescript
interface ScreenshotResult {
  image: string;           // base64 编码的 JPEG 图片数据
  mimeType: string;        // "image/jpeg"（默认）| "image/png"
  imageBytes: number;      // 编码前的图片字节数（用于检查是否超限）
  imageWidth: number;      // 发送给模型的图片宽度（按模型要求缩放后）
  imageHeight: number;     // 发送给模型的图片高度
  logicalWidth: number;    // 屏幕逻辑宽度（OS 坐标空间，nut.js 操作空间）
  logicalHeight: number;   // 屏幕逻辑高度
  physicalWidth: number;   // 屏幕物理宽度
  physicalHeight: number;  // 屏幕物理高度
  scaleFactor: number;     // DPI 缩放因子（物理/逻辑）
  displayIndex: number;    // 截图来源的显示器索引
}
```

#### 3.4.9 CoordinateResolver（坐标解析器）

```
CoordinateResolver
  ├── 输入: model_x, model_y, coordinateMode, coordinateOrder, screenshotMeta, displayInfo
  ├── 输出: global_x, global_y
  ├── 四步: 坐标顺序修正 → 归一化(0~1) → 逻辑坐标 → 全局偏移
  └── coordinateMode/coordinateOrder 来源:
        ├── 内置模型配置表（已知模型自动匹配）
        └── 环境变量 GUI_AGENT_COORDINATE_MODE 手动覆盖
```

**内置模型配置表**（可扩展）：

| 模型名匹配规则 | 坐标模式 | 坐标顺序 | 说明 |
|---------------|---------|---------|------|
| `claude-*` | `image-absolute` | `xy` | Anthropic Computer Use API 标准格式 |
| `gpt-4o*`, `gpt-5*` | `image-absolute` | `xy` | OpenAI CUA |
| `gemini*` | `normalized-999` | **`yx`** | Google Gemini，坐标顺序是 `[y, x]` 而非 `[x, y]`，这是 Google 训练数据的固有格式 |
| `ui-tars*` | `normalized-1000` | `xy` | UI-TARS |
| `qwen2.5-vl*`, `qwen-vl*` | `image-absolute` | `xy` | 通义千问 VL |
| `cogagent*` | `image-absolute` | `xy` | CogAgent |
| `seeclick*`, `showui*` | `normalized-0-1` | `xy` | SeeClick/ShowUI |
| **未匹配（fallback）** | `image-absolute` | `xy` | 保守策略 |

> **截图分辨率不按模型区分**：统一使用分级缩放策略（见 3.4.4），不在模型配置表中配置目标分辨率。
>
> **Gemini 坐标顺序**：Gemini 输出坐标格式为 `[y, x]`（非 `[x, y]`），这是 Google 训练数据的固有格式。CoordinateResolver 必须在归一化前根据 `coordinateOrder` 做 swap。

#### 3.4.10 原子操作中的坐标处理

对于原子操作工具（`gui_click` 等），坐标由**文本 Agent** 提供。需要支持两种输入方式：

| 参数 | 说明 |
|------|------|
| `x`, `y` | 默认为**逻辑坐标**（文本 Agent 自己换算后传入） |
| `coordinateMode?` | 可选，指定坐标格式。如果文本 Agent 直接传视觉模型输出的原始坐标，需声明格式以便 GUI Agent 转换 |

#### 3.4.11 现有 Electron 内嵌版的问题

当前 `systemPrompt.ts` 中让 Agent 自己做坐标缩放计算（"multiply pixel coords by 1/scale"），这是**错误的**：

- 视觉模型的坐标输出格式由训练数据决定，不是推理时可以改变的
- 让 LLM 做数学乘除运算误差大，尤其是 Retina 下多层缩放
- 正确做法：**系统层自动完成全部坐标转换，模型只管输出它训练时学到的坐标格式**

---

### 3.5 桌面操作能力

基于 **nut.js**（`@nut-tree/nut-js`）：

| 能力 | nut.js API | 说明 |
|------|-----------|------|
| 截图 | `screen.capture()` | 全屏截图（始终全屏） |
| 鼠标移动 | `mouse.moveTo(point)` | 移动光标（逻辑坐标） |
| 鼠标点击 | `mouse.click(button)` | 左/右/中键 |
| 鼠标拖拽 | `mouse.drag(path)` | 从 A 拖到 B |
| 滚动 | `mouse.scrollUp/Down(amount)` | 垂直滚动 |
| 键盘输入 | `keyboard.type(text)` | 输入文本 |
| 按键 | `keyboard.press(key)` / `release(key)` | 单键按下释放 |
| 图像查找 | `screen.find(image)` / `screen.findAll(image)` | 模板匹配 |
| 等待图像 | `screen.waitFor(image, timeout)` | 等待 UI 元素出现 |
| 光标位置 | `mouse.getPosition()` | 获取当前光标坐标（逻辑坐标） |
| 显示器 | 系统 API | 获取多显示器信息（含 scaleFactor） |

---

### 3.6 操作时序与可靠性

GUI 自动化的核心挑战不只是"点哪里"，还包括"什么时候点"、"怎么输入"、"出了意外怎么办"。

#### 3.6.1 操作后等待策略

**问题**：点击按钮后，UI 动画/页面跳转/弹窗需要时间渲染。如果操作后**立即截图**，截到的是过渡状态（动画中/加载中），视觉模型会误判。

**等待策略（参考 TuriX-CUA 的分层延迟机制）**：

| 层级 | 延迟 | 说明 |
|------|------|------|
| **微操作延迟** | 10-30ms | 单个鼠标事件内部（mouseDown → mouseUp 之间） |
| **连续操作间延迟** | 300-500ms | 同一步骤内多个操作之间（如先点击再输入） |
| **步骤间延迟** | 1-2s（默认 1.5s） | Agent 循环中每步操作完成后、截图验证前的等待 |
| **错误重试延迟** | 5-10s | API 限流或操作失败后的退避等待 |

```
执行操作 (click/type/etc.)
  │
  │  步骤间延迟 (默认 1.5s)
  │  目的: 等待 UI 动画完成、页面渲染稳定
  ▼
截取验证截图
  │
  │  发送给视觉模型分析
  ▼
决定下一步操作
```

**可配置**：通过环境变量 `GUI_AGENT_STEP_DELAY_MS`（默认 1500ms）调整步骤间延迟。

**特殊场景延迟**：Agent 循环中，LLM 可以主动选择 `wait` 动作（如等待页面加载完成），此时额外等待指定时间后再截图。

#### 3.6.2 截图时鼠标光标处理

**问题**：鼠标光标出现在截图中，可能遮挡 UI 元素（按钮文字、输入框等），影响视觉模型识别准确率。

**策略**：

| 方案 | 说明 | 采用 |
|------|------|------|
| **截图前移动光标到角落** | 简单有效，但用户能看到光标跳动 | 备选 |
| **接受光标在截图中** | 最简单，依赖视觉模型忽略光标 | **v1 采用** |
| **操作后光标归位** | 参考 TuriX-CUA 的隐形点击：操作完成后光标恢复原位 | v2 考虑 |

**v1 方案**：不主动处理光标，接受光标出现在截图中。原因：
- 主流视觉模型（Claude CU、GPT CUA）的训练数据中包含光标，能正确忽略
- 移动光标本身是一次额外操作，增加复杂度和失败概率
- 如果实测发现光标遮挡严重影响准确率，v2 再引入光标隐藏

#### 3.6.3 文本输入策略

**问题 1：CJK/非 ASCII 字符输入**

nut.js 的 `keyboard.type()` 基于键码模拟，**无法直接输入中文、日文、韩文**等需要 IME（输入法）的字符。

**解决方案：剪贴板粘贴**

```
输入文本
  │
  │  检测: 是否包含非 ASCII 字符？
  │
  ├── 纯 ASCII + 短文本 → keyboard.type() 逐字模拟
  │
  └── 包含非 ASCII 或长文本 → 剪贴板粘贴模式:
        1. 保存当前剪贴板内容
        2. 将目标文本写入剪贴板
        3. 模拟 Cmd+V (macOS) / Ctrl+V (Windows/Linux)
        4. 恢复原剪贴板内容
```

> **参考**：TuriX-CUA 使用 macOS Quartz 的 `CGEventKeyboardSetUnicodeString` 直接发送 Unicode 事件，但这是 macOS 专用 API。我们需要跨平台方案，剪贴板粘贴是最通用的方式。

**问题 2：长文本输入**

`keyboard.type()` 逐字模拟击键，长文本（>50 字符）存在问题：
- 速度慢（每字符需要 keyDown + keyUp 两个事件）
- 中途焦点切换会导致文本输入到错误窗口
- 可能触发系统的按键重复机制

**策略**：

| 文本特征 | 输入方式 | 原因 |
|----------|---------|------|
| 纯 ASCII，≤50 字符 | `keyboard.type()` 逐字模拟 | 最自然，兼容性最好 |
| 纯 ASCII，>50 字符 | 剪贴板粘贴 | 速度快，避免焦点丢失 |
| 包含非 ASCII 字符 | 剪贴板粘贴 | IME 兼容 |

**剪贴板恢复**：粘贴完成后必须恢复用户原有的剪贴板内容，避免破坏用户的复制粘贴工作流。

#### 3.6.4 意外弹窗处理

**问题**：操作过程中可能出现意外遮挡：
- 系统通知（macOS 通知中心、Windows Toast Notification）
- 权限请求弹窗（"xxx 想要访问你的麦克风"）
- 应用自身的弹窗（更新提醒、错误对话框、Cookie 同意）
- 屏保/锁屏触发

**策略（参考 TuriX-CUA：依赖 LLM 识别）**：

v1 不做自动弹窗检测，交给 Agent 循环中的视觉模型处理：
- 视觉模型截图后能看到弹窗
- 在 system prompt 中明确指导 LLM：如果发现意外弹窗/通知，优先关闭弹窗再继续任务
- 连续多步操作未有效推进（前后截图无变化），触发 stuck 检测

**system prompt 指导（gui_execute_task 内部）**：

```
如果你在截图中发现：
- 系统通知弹窗：忽略，通知会自动消失
- 权限请求对话框：点击"允许"或"确定"，然后继续任务
- 应用错误弹窗：点击"关闭"或"确定"，然后继续任务
- 如果弹窗阻挡了目标区域且无法关闭，报告失败原因
```

**stuck 检测**：连续 N 步（默认 3 步）操作后截图无明显变化（可通过图像相似度粗判），判定为卡死，自动终止并返回错误。

#### 3.6.5 多显示器坐标偏移

**问题**：多显示器环境下，OS 使用**全局连续坐标系统**。副屏的坐标原点不是 (0,0)，而是相对于主屏有偏移：

```
┌──────────────┐┌──────────────────┐
│  Display 1   ││    Display 0     │
│  (副屏)      ││    (主屏)        │
│  origin:     ││  origin: (0,0)   │
│  (-2560, 0)  ││  size: 1440×900  │
│  size:       ││                  │
│  2560×1440   ││                  │
└──────────────┘└──────────────────┘
```

nut.js 的鼠标操作使用**全局坐标**。如果 GUI Agent 选择了副屏（displayIndex=1），点击该屏幕上的 (100, 200) 实际需要传给 nut.js 的是 (-2560+100, 0+200) = (-2460, 200)。

**策略**：

```
CoordinateResolver 输出逻辑坐标 (local_x, local_y)
  │  这是相对于目标显示器左上角 (0,0) 的坐标
  │
  │  获取目标显示器的全局偏移量 (display.origin.x, display.origin.y)
  ▼
全局坐标: global_x = display.origin.x + local_x
         global_y = display.origin.y + local_y
  │
  ▼
nut.js mouse.click(global_x, global_y)
```

**获取显示器偏移量**：
- macOS: `screen.getAllDisplays()` 返回的 `bounds.x/y` 即为全局偏移
- Windows: `EnumDisplayMonitors` + `MONITORINFO.rcMonitor`
- Linux X11: `XRRGetScreenResources` + `XRRCrtcInfo`

**截图也需要对应**：截图时只截取目标显示器的画面，不是整个桌面。nut.js 的 `screen.capture()` 支持指定区域参数。

#### 3.6.6 屏幕状态前置检查

**问题**：在执行 GUI 操作前，屏幕可能处于不可用状态。

| 状态 | 影响 | 处理 |
|------|------|------|
| 屏幕锁定/屏保 | 截图为锁屏画面，操作无效 | 检测到后返回错误，不继续操作 |
| 目标应用最小化 | 截图中看不到目标窗口 | 交给 LLM 判断（截图中无目标时自行处理） |
| 系统模态对话框 | 阻止其他操作 | 同 3.6.4 弹窗处理 |

---

### 3.7 安全需求

#### S1: 危险操作防护

- 阻断危险热键：`Cmd+Q`/`Alt+F4`（关闭应用）、`Ctrl+Alt+Delete` 等
- 可配置的热键黑名单

#### S2: 审计日志

- 记录所有操作：时间戳、操作类型、坐标/文本、成功/失败
- 通过 MCP Resource `gui://audit-log` 可查询
- 环形缓冲（默认 1000 条）

#### S3: 最大轮次限制

- `gui_execute_task` 的 Agent 循环有 `maxSteps` 上限（默认 50）
- 超限后自动终止并返回当前状态和已完成的步骤

#### S4: 输入校验

- 坐标范围校验
- 文本长度限制（≤10000 字符）
- 请求体大小限制

---

### 3.8 平台需求

| 能力 | macOS | Windows | Linux (X11) | Linux (Wayland) |
|------|:-----:|:-------:|:-----------:|:---------------:|
| 截图 | 需 Screen Recording 权限 | 无需 | 支持 | 受限 |
| 键鼠控制 | 需 Accessibility 权限 | 无需 | 需 xdotool | 受限 |
| 图像查找 | 支持 | 支持 | 支持 | 受限 |

---

### 3.9 运行模式

| 模式 | 描述 | 入口 |
|------|------|------|
| **MCP Server 模式**（主要） | 作为持久化本地 HTTP 服务启动，多 Agent 通过 URL 连接 | `gui-agent --port 60008`（Streamable HTTP）或 `gui-agent --transport stdio`（stdio 备选） |
| **SDK 嵌入模式** | 被 NuwaClaw Electron 客户端等应用集成 | `import { createGuiAgentMcpServer }` |

> 注意：**没有 CLI 交互模式**。用户不直接与 GUI Agent 对话。

---

## 4. 技术选型

| 组件 | 选型 | 理由 |
|------|------|------|
| **Agent 框架** | pi-mono (`@mariozechner/pi-ai` + `@mariozechner/pi-agent-core`) | 极简、多 Provider（Anthropic/OpenAI/Gemini）、tool calling 成熟、context compaction |
| **桌面自动化** | nut.js (`@nut-tree/nut-js`) | 成熟的 Node.js 桌面自动化库，跨平台，支持截图/键鼠/图像查找 |
| **MCP SDK** | `@modelcontextprotocol/sdk` | MCP 官方 SDK，支持 stdio / Streamable HTTP |
| **语言** | TypeScript | 与 pi-mono 和 nut.js 生态一致 |
| **运行时** | Node.js 22+ | nut.js 要求 |

---

## 5. 架构概览

### 5.1 进程模型

```
文本 Agent 进程 (claude-code / nuwaxcode)
  │
  │  spawn 子进程 (stdio) 或 HTTP 连接
  ▼
┌─────────────────────────────────────────────────────┐
│             GUI Agent 进程                            │
│                                                       │
│  ┌─────────────────────────────────────────────┐     │
│  │          MCP Server 层                        │     │
│  │  接收 MCP tool call → 分发到对应 handler       │     │
│  └──────┬──────────────────────┬───────────────┘     │
│         │                      │                      │
│    原子操作                  完整任务                  │
│    (直接执行)            (启动 Agent 循环)             │
│         │                      │                      │
│         ▼                      ▼                      │
│  ┌─────────────┐     ┌──────────────────┐            │
│  │  桌面工具层   │     │  pi-mono Agent   │            │
│  │  (nut.js)    │◄────│  循环引擎        │            │
│  │  截图/键鼠    │     │  LLM + Tools     │            │
│  └─────────────┘     └──────────────────┘            │
│         │                                             │
│  ┌─────────────┐                                     │
│  │  安全层      │                                     │
│  │  热键审计    │                                     │
│  └─────────────┘                                     │
└─────────────────────────────────────────────────────┘
```

### 5.2 两种调用路径对比

| | 原子操作 (`gui_click` 等) | 完整任务 (`gui_execute_task`) |
|--|--------------------------|------------------------------|
| **决策者** | 文本 Agent | GUI Agent 内部 LLM |
| **步骤编排** | 文本 Agent 自行规划 | GUI Agent 自主循环 |
| **LLM 调用** | 不涉及（纯工具执行） | GUI Agent 调用 pi-ai |
| **适用场景** | 简单操作、文本 Agent 有视觉能力时 | 复杂多步 GUI 任务 |
| **延迟** | 低（单次操作） | 高（多轮 LLM + 多次截图） |

### 5.3 与现有 Electron 内嵌版的关系

```
NuwaClaw Electron 客户端
  │
  ├── 现有内嵌版 (HTTP API, src/main/services/gui/)
  │     特点: 依赖 Electron API, 工具层, 无自主决策
  │     适用: 引擎自己能看图决策时的简单 GUI 操作
  │
  └── 本项目 (MCP Server, 独立进程)
        特点: 独立于 Electron, 自带 LLM, 自主决策
        适用: 复杂 GUI 任务, 标准 MCP 集成, 任何 Agent 可调用
```

---

## 6. Electron 客户端集成需求（crates/agent-electron-client 改造）

GUI Agent 作为独立 MCP 服务运行，但需要 NuwaClaw Electron 客户端提供两项配套能力：**显示器选择** 和 **视觉模型配置接口**。

### 6.1 显示器选择

#### 6.1.1 需求背景

- 用户可能有多个显示器（如笔记本 + 外接屏）
- GUI Agent 截图和操作需要明确针对**哪一个显示器**
- 用户应在使用 GUI 操作前选择目标显示器，未选择则默认主显示器

#### 6.1.2 功能描述

| 功能点 | 说明 |
|--------|------|
| **显示器列表获取** | 调用 `screen.getAllDisplays()` 获取所有显示器信息（名称、分辨率、scaleFactor、是否主屏） |
| **默认选择** | 未设置时默认使用主显示器（`screen.getPrimaryDisplay()`） |
| **用户可选** | 在 GUIAgentSettings.tsx 中提供下拉选择器，显示所有显示器及其分辨率 |
| **持久化** | 选择结果存入 SQLite（`gui_agent_config` 中新增 `displayIndex` 字段） |
| **热更新** | 显示器插拔时自动刷新列表；如果已选显示器被拔掉，回退到主显示器 |

#### 6.1.3 配置扩展

`GuiAgentConfig` 新增字段：

```typescript
interface GuiAgentConfig {
  // ... 现有字段 ...
  /** 目标显示器索引，默认 0（主显示器） */
  displayIndex: number;
}
```

#### 6.1.4 UI 设计

在 GUIAgentSettings.tsx 的配置区新增"目标显示器"选择器：

```
目标显示器:  [Display 0 (Primary) - 1440×900 @2x  ▼]
             ├── Display 0 (Primary) - 1440×900 @2x
             ├── Display 1 - 2560×1440 @1x
             └── Display 2 - 1920×1080 @1.5x
```

- 显示格式：`Display {index}{primary标记} - {width}×{height} @{scaleFactor}x`
- 选中后实时预览（可选：在目标显示器上短暂闪烁边框确认）

#### 6.1.5 IPC 接口

| IPC 方法 | 说明 |
|---------|------|
| `guiAgent:getDisplays` | 返回当前所有显示器列表 |
| `guiAgent:setConfig({ displayIndex })` | 持久化选择（复用现有 setConfig） |

#### 6.1.6 传递给 GUI Agent

选中的 `displayIndex` 通过以下方式传递给独立 GUI Agent 进程：
- MCP 模式：作为 MCP Server 启动参数或环境变量 `GUI_AGENT_DISPLAY_INDEX`
- SDK 模式：直接传入配置对象

---

### 6.2 视觉模型配置 HTTP 接口

#### 6.2.1 需求背景

- GUI Agent 的 `gui_execute_task` 内部需要调用视觉模型（LLM）来分析截图并决策
- 视觉模型的配置（provider、model、api_key、base_url 等）需要一种方式传入
- 复用现有 computerServer 的 agent 端口，新增一个 HTTP 路径来接收和管理视觉模型配置
- 参考现有 `/computer/chat` 接口的 `ModelProviderConfig` 结构

#### 6.2.2 接口设计

**复用现有 computerServer**（`src/main/services/computerServer.ts`），在 `handleRequest` 中新增路由：

| 接口 | 方法 | 路径 | 说明 |
|------|------|------|------|
| 设置视觉模型配置 | POST | `/computer/gui-agent/vision-model` | 设置/更新视觉模型配置 |
| 获取视觉模型配置 | GET | `/computer/gui-agent/vision-model` | 读取当前视觉模型配置 |
| 获取显示器列表 | GET | `/computer/gui-agent/displays` | 返回所有显示器信息 |
| 设置目标显示器 | POST | `/computer/gui-agent/display` | 设置目标显示器 |

#### 6.2.3 视觉模型配置结构

参考现有 `ModelProviderConfig`（`/computer/chat` 入参），定义视觉模型配置：

```typescript
/** 视觉模型配置 — 用于 GUI Agent 内部的 gui_execute_task 决策 */
interface GuiVisionModelConfig {
  /** LLM Provider: "anthropic" | "openai" | "qwen" | "gemini" 等 */
  provider: string;
  /** API Key */
  api_key?: string;
  /** API Base URL（OpenAI 兼容端点） */
  base_url?: string;
  /** 模型名称（如 "claude-sonnet-4-20250514", "gpt-4o", "qwen2.5-vl-72b"） */
  model: string;
  /** API 协议: "anthropic" | "openai"（默认 "openai"） */
  api_protocol?: string;
  /** 坐标模式覆盖（不传则按模型名自动匹配内置配置表） */
  coordinate_mode?: 'image-absolute' | 'normalized-1000' | 'normalized-999' | 'normalized-0-1';
}
```

> **设计决策**：`jpeg_quality` 不暴露给外部接口。
> - **截图分辨率**：统一分级缩放（逻辑分辨率 + 最长边 ≤1920），不按模型区分
> - **JPEG 质量**：内部默认 75（清晰度与文件大小的最佳平衡），无需外部配置

与现有 `/computer/chat` 的 `ModelProviderConfig` 对比：

| 字段 | /computer/chat | /computer/gui-agent/vision-model | 说明 |
|------|---------------|----------------------------------|------|
| `provider` | ✅ | ✅ | 相同 |
| `api_key` | ✅ | ✅ | 相同 |
| `base_url` | ✅ | ✅ | 相同 |
| `model` | ✅ | ✅ | 相同 |
| `api_protocol` | ✅ | ✅ | 相同 |
| `coordinate_mode` | ❌ | ✅ 新增（可选） | GUI 专用：视觉模型坐标格式，不传则按模型名自动匹配 |

#### 6.2.4 请求/响应示例

**POST `/computer/gui-agent/vision-model`** — 设置视觉模型配置：

```json
// Request
{
  "provider": "anthropic",
  "model": "claude-sonnet-4-20250514",
  "api_key": "sk-ant-xxx",
  "api_protocol": "anthropic"
}

// Response
{
  "code": 200,
  "success": true,
  "message": "Vision model config updated",
  "data": { "provider": "anthropic", "model": "claude-sonnet-4-20250514" }
}
```

**GET `/computer/gui-agent/vision-model`** — 获取当前配置（含内部自动推断的参数）：

```json
// Response
{
  "code": 200,
  "success": true,
  "data": {
    "provider": "anthropic",
    "model": "claude-sonnet-4-20250514",
    "api_protocol": "anthropic",
    "coordinate_mode": "image-absolute",
    "screenshot_strategy": "logical_resolution, max_longest_edge=1920",
    "jpeg_quality": 75
  }
}
```

> GET 响应中的 `screenshot_strategy` 和 `jpeg_quality` 仅供查看，不可通过 POST 设置。

**GET `/computer/gui-agent/displays`** — 获取显示器列表：

```json
// Response
{
  "code": 200,
  "success": true,
  "data": {
    "displays": [
      { "index": 0, "label": "Display 0 (Primary)", "width": 1440, "height": 900, "scaleFactor": 2, "isPrimary": true },
      { "index": 1, "label": "Display 1", "width": 2560, "height": 1440, "scaleFactor": 1, "isPrimary": false }
    ],
    "selectedIndex": 0
  }
}
```

#### 6.2.5 持久化

- 视觉模型配置存入 SQLite，key = `gui_vision_model_config`
- 显示器选择存入 SQLite，在 `gui_agent_config` 中（同 6.1）
- 配置更新后通过 engineHooks 环境变量注入给 GUI Agent 进程

#### 6.2.6 配置传递给 GUI Agent

```
Electron 客户端
  │
  ├── 用户在 Settings UI 配置视觉模型 + 选择显示器
  │     ↓ 持久化到 SQLite
  │
  ├── 外部调用 POST /computer/gui-agent/vision-model 配置
  │     ↓ 持久化到 SQLite
  │
  └── 启动 GUI Agent MCP Server 时
        ↓ 注入环境变量
        GUI_AGENT_PROVIDER=anthropic
        GUI_AGENT_MODEL=claude-sonnet-4-20250514
        GUI_AGENT_API_KEY=sk-xxx
        GUI_AGENT_BASE_URL=...
        GUI_AGENT_COORDINATE_MODE=image-absolute
        GUI_AGENT_DISPLAY_INDEX=0
```

---

## 7. 非目标（v1 不做什么）

| 不做 | 理由 |
|------|------|
| 不做 CLI 交互模式 | 用户不直接使用，仅被文本 Agent 调用 |
| 不做 TUI / Web UI | 同上，无需用户界面 |
| 不做浏览器专用自动化 | 不替代 Playwright/Puppeteer，专注通用桌面 GUI |
| 不做 RPA 流程编排 | Agent 是 LLM 驱动的，不做可视化流程编辑 |
| 不做移动端 | 仅桌面（macOS/Windows/Linux） |
| 不做远程桌面控制 | 仅控制本机桌面 |
| 不做实时视频流分析 | 逐帧截图方式 |
| v1 不做 Accessibility Tree | 先依赖纯视觉方案保持简单通用；v2 可参考 TuriX-CUA 的 Accessibility Tree 标注辅助方案（截图上叠加元素编号，提升点击准确率） |

---

## 8. 配置

### 8.1 环境变量

| 变量 | 说明 | 默认值 |
|------|------|--------|
| `GUI_AGENT_PROVIDER` | LLM Provider (anthropic/openai/...) | `anthropic` |
| `GUI_AGENT_MODEL` | 模型名 | `claude-sonnet-4-20250514` |
| `GUI_AGENT_API_KEY` | API Key | 必填 |
| `GUI_AGENT_BASE_URL` | API Base URL（OpenAI 兼容端点） | Provider 默认 |
| `GUI_AGENT_MAX_STEPS` | Agent 循环最大轮次 | `50` |
| `GUI_AGENT_STEP_DELAY_MS` | 步骤间等待时间 (ms)，操作完成到截图验证之间 | `1500` |
| `GUI_AGENT_STUCK_THRESHOLD` | 连续无变化步数阈值，超过则判定卡死 | `3` |
| `GUI_AGENT_TRANSPORT` | MCP 传输方式 (http/stdio) | `http` |
| `GUI_AGENT_PORT` | HTTP 传输端口 | `60008` |
| `GUI_AGENT_COORDINATE_MODE` | 坐标模式覆盖 (image-absolute/normalized-1000/normalized-999/normalized-0-1) | 自动按模型匹配 |
| `GUI_AGENT_JPEG_QUALITY` | JPEG 编码质量 (1-100)，仅内部调试用 | `75` |
| `GUI_AGENT_DISPLAY_INDEX` | 目标显示器索引 | `0`（主显示器） |
| `GUI_AGENT_MEMORY_MODEL` | 记忆摘要用的模型（可选，可用更便宜的模型降低成本） | 复用 `GUI_AGENT_MODEL` |
| `GUI_AGENT_MEMORY_PROVIDER` | 记忆模型 Provider（可选） | 复用 `GUI_AGENT_PROVIDER` |

### 8.2 文本 Agent 的 MCP 配置示例

**Streamable HTTP 模式**（推荐，多 Agent 共享）：

先启动 GUI Agent 服务：
```bash
GUI_AGENT_API_KEY=sk-xxx gui-agent --port 60008
```

文本 Agent 通过 URL 连接：
```json
{
  "mcpServers": {
    "gui-agent": {
      "url": "http://127.0.0.1:60008/mcp"
    }
  }
}
```

**stdio 模式**（单 Agent 专用）：

```json
{
  "mcpServers": {
    "gui-agent": {
      "command": "npx",
      "args": ["-y", "@nuwax-ai/gui-agent", "--transport", "stdio"],
      "env": {
        "GUI_AGENT_PROVIDER": "anthropic",
        "GUI_AGENT_MODEL": "claude-sonnet-4-20250514",
        "GUI_AGENT_API_KEY": "sk-xxx"
      }
    }
  }
}
```

---

## 9. 验收标准

### 9.1 MCP 服务

- [ ] 可作为 MCP Server 启动（stdio 模式）
- [ ] 文本 Agent 可通过 MCP 调用所有原子操作工具（13 个）
- [ ] 文本 Agent 可通过 MCP 调用 `gui_execute_task` 执行完整 GUI 任务
- [ ] `gui_execute_task` 返回结果包含步骤日志和最终截图
- [ ] `gui_execute_task` 通过 MCP progress notification 推送每步进度
- [ ] `gui_execute_task` 支持通过 MCP AbortSignal 取消执行
- [ ] 互斥锁生效：同时只有一个 `gui_execute_task` 在执行

### 9.2 Agent 循环

- [ ] `gui_execute_task` 内部可调用 Anthropic (Claude) 模型分析截图并决策
- [ ] `gui_execute_task` 内部可调用 OpenAI 协议模型分析截图并决策
- [ ] 可执行完整的"截图→分析→操作→验证"循环
- [ ] maxSteps 限制生效

### 9.3 截图与坐标

- [ ] 全屏截图正确返回 imageWidth/imageHeight/logicalWidth/logicalHeight/scaleFactor
- [ ] 归一化千分比坐标 (0-1000) 正确转换为逻辑坐标并点击准确
- [ ] 图片绝对坐标（Qwen2.5-VL 格式）正确转换为逻辑坐标并点击准确
- [ ] Retina/高 DPI 屏幕下坐标转换正确（scaleFactor > 1）
- [ ] 截图缩放 (scale < 1.0) 不影响坐标转换的准确性
- [ ] 模型类型自动匹配坐标模式，也可通过环境变量手动覆盖
- [ ] 截图转 JPEG 后文件大小在 API 限制内（Claude ≤~1.15MP，GPT ≤20MB）
- [ ] JPEG quality 可配置，默认 75

### 9.4 操作时序与可靠性

- [ ] 操作后有步骤间延迟（默认 1.5s），等待 UI 渲染完成后再截图
- [ ] 中文/CJK 文本输入通过剪贴板粘贴正确工作
- [ ] 长文本（>50 字符）自动切换为剪贴板粘贴模式
- [ ] 剪贴板粘贴后恢复用户原有的剪贴板内容
- [ ] 多显示器场景下，副屏坐标正确加上全局偏移量
- [ ] 连续 N 步截图无变化时触发 stuck 检测并终止
- [ ] Agent 循环 system prompt 包含意外弹窗处理指导

### 9.5 安全与稳定

- [ ] 危险热键被阻断
- [ ] 审计日志完整记录

### 9.6 平台兼容

- [ ] macOS 上截图和键鼠均正常（授权后）
- [ ] Windows 上截图和键鼠均正常
- [ ] Linux X11 上截图和键鼠均正常

---

## 10. 开放问题

| # | 问题 | 影响 | 建议 |
|---|------|------|------|
| Q1 | pi-mono 不支持 MCP，MCP Server 与 Agent 循环如何协同？ | 架构核心 | MCP Server 是外壳，收到 `gui_execute_task` 后创建 pi-mono AgentSession 执行，完成后返回 MCP 结果。原子操作不经过 pi-mono |
| Q2 | ~~`gui_execute_task` 执行期间是阻塞还是异步？~~ | ~~调用体验~~ | **已解决**，同步阻塞。MCP SDK 原生支持长时间 tool call + progress notification + AbortSignal 取消。无需自定义 TaskQueue/gui_task_status/gui_abort_task |
| Q3 | ~~长任务的上下文管理？~~ | ~~token 溢出~~ | **已解决**，三层记忆管理（Summary/Recent/Pending）+ LLM 摘要压缩 + pi-mono transformContext hook。见 3.2 及 Plan 3.7 |
| Q4 | nut.js prebuilt binary 分发？ | 安装体验 | 跟随 npm 安装自动下载，需评估离线场景 |
| Q5 | `gui_execute_task` 中 Agent 循环的模型，是否可以与文本 Agent 的模型不同？ | 灵活性 | 是，通过 `model` 参数覆盖，允许用更便宜/更快的模型做 GUI 决策 |
| Q6 | 新增视觉模型的坐标格式如何扩展？ | 可维护性 | 内置模型映射表 + 环境变量覆盖。新增模型只需在映射表中加一行 |
| Q7 | ~~多显示器场景下的坐标如何处理？~~ | ~~多屏用户~~ | **已解决**，见 3.6.5 多显示器坐标偏移 |
| Q8 | ~~Agent 循环中连续失败如何处理？~~ | ~~稳定性~~ | **已解决**，见 3.6.4 stuck 检测 + 3.7 S4 最大轮次限制。参考 TuriX-CUA 连续失败计数器 |
| Q9 | ~~截图中的历史图片如何管理 token？~~ | ~~token 爆炸~~ | **已解决**，pruneScreenshots 策略：保留最近 3 步完整截图，更早步骤移除 base64 替换为文字描述。见 Plan 3.7.5 |

---

## 11. 项目结构（初步）

模块位于 `crates/agent-gui-server/`，与现有模块平级：

```
crates/agent-gui-server/
├── src/
│   ├── index.ts                  # CLI 入口: 参数解析 + 启动 MCP Server
│   ├── lib.ts                    # SDK 入口: 导出 createGuiAgentMcpServer()
│   ├── config.ts                 # 统一配置: 环境变量解析、校验、Fail Fast
│   │
│   ├── mcp/                      # MCP 协议层（外部接口）
│   │   ├── server.ts             # MCP Server 实例 (stdio + HTTP 双模式)
│   │   ├── atomicTools.ts        # 13 个原子操作 tool handler
│   │   ├── taskTools.ts          # gui_execute_task 互斥执行 + 进度通知
│   │   └── resources.ts          # MCP Resources (status/permissions/audit)
│   │
│   ├── agent/                    # Agent 循环引擎（gui_execute_task 内部）
│   │   ├── taskRunner.ts         # 循环核心: pi-mono Agent + 截图→LLM→操作
│   │   ├── systemPrompt.ts       # GUI Agent 专用 system prompt
│   │   ├── memoryManager.ts      # 三层记忆管理 (Summary/Recent/Pending) + LLM 摘要压缩
│   │   └── stuckDetector.ts      # 卡死检测: 连续截图相似度比对
│   │
│   ├── desktop/                  # 桌面操作层（底层能力封装，不依赖 MCP）
│   │   ├── screenshot.ts         # 截图管线: capture → scale → JPEG → base64
│   │   ├── mouse.ts              # 鼠标操作 (nut.js mouse)
│   │   ├── keyboard.ts           # 键盘操作 (nut.js keyboard)
│   │   ├── clipboard.ts          # 剪贴板操作（CJK/长文本粘贴、剪贴板备份恢复）
│   │   ├── display.ts            # 显示器信息
│   │   └── imageSearch.ts        # 图像查找 (nut.js template matcher)
│   │
│   ├── coordinates/              # 坐标系统（核心难点，独立目录）
│   │   ├── resolver.ts           # CoordinateResolver: 模型坐标 → 逻辑坐标 → 全局坐标
│   │   └── modelProfiles.ts      # 模型配置表: 坐标模式、坐标顺序、缩放策略
│   │
│   ├── safety/                   # 安全层
│   │   ├── hotkeys.ts            # 危险热键黑名单拦截
│   │   └── auditLog.ts           # 环形缓冲审计日志
│   │
│   └── utils/
│       ├── logger.ts             # 日志: stderr + 可选文件
│       ├── platform.ts           # 平台检测与权限检查
│       └── errors.ts             # 结构化错误类型
│
├── tests/                        # Vitest 测试
├── package.json
├── tsconfig.json
└── vitest.config.ts
```

---

## 12. 参考项目与借鉴

### 12.1 TuriX-CUA（Python GUI Agent 参考实现）

**项目**: `/Volumes/soddygo/git_work/TuriX-CUA` — Python 实现的桌面 GUI 自动化 Agent。

**架构亮点**：

| 设计 | 说明 | 对我们的启发 |
|------|------|------------|
| **多角色 LLM 架构** | Brain（分析状态）+ Actor（生成操作）+ Memory（压缩历史），各用不同 model | 可考虑 `gui_execute_task` 内部用更便宜的模型做决策，视觉分析用强模型 |
| **三层记忆管理** | Recent（近期详细）→ Summary（历史摘要）→ High-level（全局总结），token 接近上限时自动压缩 | 必须实现，否则每步带截图 base64 会迅速撑爆 context |
| **坐标自动检测** | `if position > 1` 则为 0-1000 格式，否则为 0-1 格式，运行时自动适配 | 简洁实用，我们的 CoordinateResolver 可以借鉴这种运行时检测 |
| **截图分级缩放** | ≤1080p 不缩放，2K-4K 缩 50%，8K 缩 25%，LANCZOS 重采样 | 比固定 scale 更合理，按实际分辨率自适应 |
| **Accessibility Tree 标注** | 截图上叠加编号框标注可交互元素（红/蓝/绿/黄/紫循环） | v2 可引入，显著提升点击准确率 |
| **连续失败熔断** | `consecutive_failures` 计数，超过 `max_failures`（默认 5）自动终止 | 必须实现，防止 Agent 卡在无效循环 |
| **强制停止热键** | `pynput.keyboard.GlobalHotKeys` 监听，用户可随时中断 | MCP 模式下通过 AbortSignal（客户端取消请求）实现等价功能 |
| **隐形点击** | 鼠标事件通过 Quartz `kCGHIDEventTap` 直发，不移动光标 | 减少视觉干扰，但可能影响某些应用的响应 |
| **操作后等待** | 每步操作后固定等待 2s 再截图验证 | 等待是必要的（UI 动画/渲染需要时间），但应可配置 |

**TuriX-CUA 的局限（我们需要改进的）**：

| 局限 | 我们的方案 |
|------|-----------|
| 仅 macOS（依赖 Quartz + Cocoa Accessibility API） | 跨平台（nut.js 抽象层） |
| 无 MCP 暴露 | MCP Server 为唯一入口 |
| 坐标无显式 DPI 处理（依赖 pyautogui 隐式处理） | 显式三层坐标空间 + CoordinateResolver |
| 不支持 Claude computer_use 的图片绝对坐标格式 | 内置模型配置表，支持所有三大坐标家族 |
| 无多显示器支持 | 支持 displayIndex |

### 12.2 社区 MCP 桌面自动化项目

**调研结论**：没有现成项目同时解决"多模型坐标适配 + 跨平台 DPI + MCP 暴露"。以下项目各有值得借鉴之处。

#### 跨平台

| 项目 | 地址 | 亮点 | 局限 |
|------|------|------|------|
| **computer-use-mcp** | github.com/domdomegg/computer-use-mcp | 最接近 Anthropic 官方方案，MIT 协议 | 仅适配 Claude，不处理多模型坐标差异 |
| **mcp-desktop-automation** | github.com/tanob/mcp-desktop-automation | 基于 RobotJS 的通用桌面自动化 | 无 DPI 处理 |
| **mcp-pyautogui-server** | github.com/hetaoBackend/mcp-pyautogui-server | PyAutoGUI 封装为 MCP | Python，Wayland 支持差 |

#### Windows 专项

| 项目 | 地址 | 亮点 |
|------|------|------|
| **precision-desktop** | github.com/ikoskela/precision-desktop | **DPI 校准方案**：用 landmark 检测实际 scale factor，不盲信 OS 报告值。影响 47% 高分屏用户 |
| **mcp-windows** | github.com/sbroenne/mcp-windows | Win11 专用，正确处理多显示器 + DPI + 虚拟桌面 |

#### macOS 专项

| 项目 | 地址 | 亮点 |
|------|------|------|
| **mcp-desktop-pro** | github.com/lksrz/mcp-desktop-pro | **显式 Retina 2x 支持**，窗口相对坐标，AI 优化截图（WebP 压缩） |
| **mcp-remote-macos-use** | github.com/baryhuang/mcp-remote-macos-use | 自动坐标缩放，支持远程 Mac 控制 |

#### Linux 专项

| 项目 | 地址 | 亮点 |
|------|------|------|
| **kwin-mcp** | github.com/isac322/kwin-mcp | **解决 Wayland 问题**，29 个工具，隔离虚拟 KWin 会话，支持无头环境（CI） |
| **ubuntu-desktop-control** | github.com/charettep/ubuntu-desktop-control-mcp | HiDPI 自动缩放 + 网格调试 overlay |

#### 标准参考

| 项目 | 地址 | 亮点 |
|------|------|------|
| **Anthropic quickstarts** | github.com/anthropics/anthropic-quickstarts/tree/main/computer-use-demo | 坐标缩放回映的**标准参考实现**（Python） |
| **GUI-Actor** (微软研究) | microsoft.github.io/GUI-Actor | **无坐标方案**（token-based grounding），未来演进方向 |

### 12.3 关键借鉴总结

| 来源 | 借鉴点 | 落地位置 |
|------|--------|---------|
| TuriX-CUA | 三层记忆管理（Recent/Summary/High-level） | 3.2 Agent 循环 |
| TuriX-CUA | 连续失败熔断机制 | 3.7 安全需求 |
| TuriX-CUA | 截图分级缩放（按分辨率自适应） | 3.4.4 截图策略 |
| TuriX-CUA | 分层操作延迟（微操作/操作间/步骤间） | 3.6.1 操作后等待策略 |
| TuriX-CUA | 依赖 LLM 截图分析处理弹窗 | 3.6.4 意外弹窗处理 |
| TuriX-CUA | Accessibility Tree 标注辅助（v2） | 7. 非目标 |
| precision-desktop | DPI 校准（不盲信 OS 报告值） | 3.4 坐标系统 |
| mcp-desktop-pro | 窗口相对坐标 | 未来优化 |
| Anthropic quickstarts | 截图缩放 + 坐标回映公式 | 3.4.5 坐标转换链路 |
| GUI-Actor | 无坐标 token-based 方案 | 未来研究方向 |

---

*下一步: 基于本 Spec 编写 Plan（技术方案）和 Task（执行任务）文档*
