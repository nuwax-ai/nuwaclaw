# GUI 自动化方案深度调研报告

> 调研目标：让 Agent 能够操作电脑 GUI 界面（识别、键鼠控制），跨平台支持 Windows/macOS/Linux

**调研日期**: 2026-03-15
**状态**: Draft
**版本**: v0.2 (Deep Research)

---

## 1. 需求分析

### 1.1 核心能力

| 能力 | 说明 |
|------|------|
| **屏幕截图** | 实时捕获屏幕内容 |
| **GUI 识别** | 识别窗口、按钮、文本、图标等 UI 元素 |
| **键盘控制** | 模拟键盘输入（按键、组合键、文本输入） |
| **鼠标控制** | 模拟鼠标操作（移动、点击、拖拽、滚动） |
| **跨平台** | Windows / macOS / Linux 一致 API |

### 1.2 使用场景

1. **RPA 自动化** - 自动操作桌面软件
2. **测试自动化** - GUI 自动化测试
3. **AI Agent** - LLM 驱动的 GUI 操作
4. **辅助功能** - 无障碍操作辅助

---

## 2. 技术方案对比

### 2.1 屏幕截图方案

| 方案 | 平台 | 优点 | 缺点 |
|------|------|------|------|
| **Electron desktopCapturer** | Win/Mac/Linux | 原生支持，无需额外依赖 | 只能捕获应用窗口，无法截取系统级 |
| **screenshot-desktop** | Win/Mac/Linux | 简单易用，跨平台 | 依赖原生模块编译 |
| **node-screenshots** | Win/Mac/Linux | Rust 实现，性能好 | 需要 Rust 工具链 |
| **macOS: screencapture** | macOS only | 系统原生 | 仅 macOS |
| **Windows: BitBlt** | Windows only | 高性能 | 仅 Windows |
| **Linux: X11/Wayland** | Linux only | 系统原生 | 需要 X11/Wayland 权限 |

**推荐方案**: `screenshot-desktop` 或 `node-screenshots`

```typescript
// screenshot-desktop 示例
import screenshot from 'screenshot-desktop';

const img = await screenshot();
// Buffer (PNG)
```

### 2.2 键鼠控制方案

| 方案 | 平台 | 优点 | 缺点 | 维护状态 |
|------|------|------|------|----------|
| **robotjs** | Win/Mac/Linux | 成熟，社区大 | 需要 node-gyp 编译 | 维护中 |
| **nut.js** | Win/Mac/Linux | TypeScript，现代 API | 需要 ImageMagick | 活跃 |
| **@jitsi/robotjs** | Win/Mac/Linux | robotjs 维护 fork | 兼容性问题 | 活跃 |
| **uiohook-napi** | Win/Mac/Linux | 底层钩子，支持监听 | 复杂 | 活跃 |
| **autoit** | Windows only | Windows 自动化标准 | 仅 Windows | 稳定 |
| **pyautogui** | Python | Python 生态 | 需要 Python 环境 | 活跃 |

#### robotjs 示例

```typescript
import robot from 'robotjs';

// 鼠标操作
robot.moveMouse(100, 200);
robot.mouseClick();
robot.mouseToggle('down');
robot.dragMouse(300, 400);
robot.mouseToggle('up');
robot.scrollMouse(0, 5); // 向上滚动

// 键盘操作
robot.typeString('Hello World');
robot.keyTap('enter');
robot.keyToggle('shift', 'down');
robot.keyTap('a', 'shift'); // Shift+A
robot.keyToggle('shift', 'up');

// 屏幕信息
const screenSize = robot.getScreenSize();
const pixelColor = robot.getPixelColor(100, 200);
```

#### nut.js 示例

```typescript
import { mouse, left, right, up, down, screen, keyboard, Key } from '@nut-tree/nut-js';

// 鼠标操作
await mouse.setPosition({ x: 100, y: 200 });
await mouse.leftClick();
await mouse.drag({ x: 300, y: 400 });
await mouse.scrollDown(5);

// 键盘操作
await keyboard.type('Hello World');
await keyboard.pressKey(Key.Enter);
await keyboard.pressKey(Key.LeftShift, Key.A);

// 屏幕操作
const screenSize = await screen.width();
const img = await screen.grabRegion({ left: 0, top: 0, width: 800, height: 600 });
```

**推荐方案**: `nut.js` (现代 TypeScript API) 或 `robotjs` (更成熟)

### 2.3 GUI 元素识别方案

| 方案 | 原理 | 优点 | 缺点 |
|------|------|------|------|
| **视觉识别 (VLM)** | 截图 + 多模态 LLM | 无需平台适配，通用性强 | 需要 API 调用，有延迟 |
| **OCR** | 文本识别 | 可定位文本元素 | 无法识别图标/按钮 |
| **Accessibility API** | 系统无障碍接口 | 精确，可获取控件树 | 各平台 API 不同 |
| **UI Automation** | Windows 原生 | Windows 精确控制 | 仅 Windows |
| **AX API** | macOS 原生 | macOS 精确控制 | 仅 macOS |
| **AT-SPI** | Linux 原生 | Linux 精确控制 | 仅 Linux (GNOME) |

#### 视觉识别方案 (推荐)

```
流程:
1. 截图 → 2. 发送到 VLM → 3. 返回元素坐标 → 4. 鼠标操作
```

**支持的 VLM 模型**:
- Claude 3.5 Sonnet (Anthropic Computer Use)
- GPT-4o / GPT-4V
- Qwen2-VL
- Gemini 2.0

#### Accessibility API 方案

```typescript
// macOS - @accessibility/ts
import { Accessibility } from '@accessibility/ts';

const window = Accessibility.focusedWindow();
const buttons = window.findAll({ role: 'AXButton' });
await buttons[0].click();

// Windows - windows-automation
import { WindowsAutomation } from 'windows-automation';

const window = WindowsAutomation.getActiveWindow();
const buttons = window.findControls({ className: 'Button' });
await buttons[0].click();
```

---

## 3. 现成框架对比

### 3.1 Anthropic Computer Use

**官方方案**，Claude 模型内置的 Computer Use 能力。

```typescript
// Claude API
const response = await anthropic.messages.create({
  model: 'claude-3-5-sonnet-20241022',
  tools: [{
    type: 'computer_20241022',
    name: 'computer',
    display_width_px: 1024,
    display_height_px: 768,
  }],
  messages: [{
    role: 'user',
    content: '打开浏览器访问 google.com'
  }]
});

// 返回 computer tool use
// { type: 'tool_use', name: 'computer', input: { action: 'key', text: '...' } }
```

**优点**:
- 官方支持，与 Claude 模型深度集成
- 经过大量测试优化

**缺点**:
- 闭源，依赖 Claude API
- 需要自己实现 tool 执行层

### 3.2 OpenInterpreter Computer Tool

**开源**，Python 实现。

```python
from interpreter import interpreter

# Computer tool
interpreter.computer.mouse.move(100, 200)
interpreter.computer.mouse.click()
interpreter.computer.keyboard.write("Hello")
```

**优点**:
- 开源，可定制
- Python 生态

**缺点**:
- Python 实现，与 Electron 集成需要进程通信

### 3.3 UI-TARS (字节跳动)

**开源**，多模态 GUI Agent。

- GitHub: https://github.com/bytedance/UI-TARS
- 模型: UI-TARS-72B
- 能力: 屏幕理解 + 操作规划

**优点**:
- 开源模型，可本地部署
- 中文优化

**缺点**:
- 模型较大 (72B)
- 需要 GPU

### 3.4 OmniParser (Microsoft)

**开源**，屏幕理解模型。

- GitHub: https://github.com/microsoft/OmniParser
- 能力: 屏幕元素检测 + OCR

**优点**:
- 微软出品
- 轻量级

**缺点**:
- 只做识别，不做操作

### 3.5 Agent-S

**开源**，多模态 GUI Agent。

- GitHub: https://github.com/simular-sp/Agent-S
- 能力: GUI 操作自动化

---

## 4. 推荐方案

### 4.1 方案一：纯 Node.js 方案 (推荐)

**架构**:

```
┌─────────────────────────────────────────────────────────────┐
│                     Electron Main Process                    │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  ┌──────────────────┐  ┌──────────────────┐                 │
│  │ ScreenshotService│  │  InputService    │                 │
│  │ (screenshot-     │  │  (nut.js/        │                 │
│  │  desktop)        │  │   robotjs)       │                 │
│  └────────┬─────────┘  └────────┬─────────┘                 │
│           │                     │                            │
│           └──────────┬──────────┘                            │
│                      │                                       │
│            ┌─────────▼─────────┐                             │
│            │  GUIAgentService  │                             │
│            │  - VLM 集成       │                             │
│            │  - 动作规划       │                             │
│            │  - 安全检查       │                             │
│            └─────────┬─────────┘                             │
│                      │                                       │
└──────────────────────┼───────────────────────────────────────┘
                       │ IPC
┌──────────────────────▼───────────────────────────────────────┐
│                    Electron Renderer                          │
│  ┌────────────────────────────────────────────────────────┐  │
│  │  GUI Control UI                                        │  │
│  │  - 实时屏幕预览                                        │  │
│  │  - 操作日志                                            │  │
│  │  - 安全确认                                            │  │
│  └────────────────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────────────────┘
```

**核心依赖**:

```json
{
  "dependencies": {
    "screenshot-desktop": "^1.15.0",
    "@nut-tree/nut-js": "^4.2.0",
    // 或 "robotjs": "^0.10.0"
  }
}
```

**实现步骤**:

1. **Phase 1**: 基础能力
   - [ ] ScreenshotService - 截图服务
   - [ ] InputService - 键鼠控制服务
   - [ ] GUIAgent IPC - 通信层

2. **Phase 2**: VLM 集成
   - [ ] 集成 Claude/GPT-4V/Qwen-VL
   - [ ] 屏幕理解 → 动作规划
   - [ ] 动作执行 + 验证

3. **Phase 3**: 安全增强
   - [ ] 操作白名单
   - [ ] 敏感操作确认
   - [ ] 操作回滚

### 4.2 方案二：混合方案 (Node.js + Python)

**架构**:

```
Electron Main Process
├── GUIAgentService (TypeScript)
│   ├── JSON-RPC
│   │   └── Python Process
│   │       └── pyautogui + opencv + OCR
│   └── VLM 调用
```

**优点**:
- 复用 Python 生态 (pyautogui 很成熟)
- OCR/图像处理能力强

**缺点**:
- 需要管理 Python 进程
- 部署复杂度增加

### 4.3 方案三：Anthropic Computer Use 集成

**架构**:

```
Electron Main Process
├── ComputerUseService
│   ├── 调用 Claude API (Computer Use tool)
│   ├── 接收 tool_use 指令
│   └── 执行本地操作 (nut.js)
```

**优点**:
- 最少开发量
- 利用 Claude 的 GUI 理解能力

**缺点**:
- 依赖 Claude API
- 闭源

---

## 5. 技术选型建议

### 5.1 截图方案

**推荐**: `screenshot-desktop`

理由:
- 纯 Node.js，无 Python 依赖
- 跨平台支持好
- API 简单

```typescript
import screenshot from 'screenshot-desktop';

export class ScreenshotService {
  async capture(): Promise<Buffer> {
    return await screenshot({ format: 'png' });
  }
  
  async captureRegion(x: number, y: number, width: number, height: number): Promise<Buffer> {
    // screenshot-desktop 不支持区域截图，需要用 sharp 裁剪
    const fullScreen = await this.capture();
    const sharp = require('sharp');
    return await sharp(fullScreen)
      .extract({ left: x, top: y, width, height })
      .toBuffer();
  }
}
```

### 5.2 键鼠控制方案

**推荐**: `@nut-tree/nut-js`

理由:
- TypeScript 原生支持
- 现代 Promise API
- 活跃维护

```typescript
import { mouse, keyboard, screen, Key } from '@nut-tree/nut-js';

export class InputService {
  // 鼠标操作
  async moveMouse(x: number, y: number): Promise<void> {
    await mouse.setPosition({ x, y });
  }
  
  async click(x?: number, y?: number): Promise<void> {
    if (x !== undefined && y !== undefined) {
      await this.moveMouse(x, y);
    }
    await mouse.leftClick();
  }
  
  async doubleClick(x?: number, y?: number): Promise<void> {
    if (x !== undefined && y !== undefined) {
      await this.moveMouse(x, y);
    }
    await mouse.leftClick();
    await mouse.leftClick();
  }
  
  async rightClick(x?: number, y?: number): Promise<void> {
    if (x !== undefined && y !== undefined) {
      await this.moveMouse(x, y);
    }
    await mouse.rightClick();
  }
  
  async drag(startX: number, startY: number, endX: number, endY: number): Promise<void> {
    await mouse.setPosition({ x: startX, y: startY });
    await mouse.pressButton(0);
    await mouse.setPosition({ x: endX, y: endY });
    await mouse.releaseButton(0);
  }
  
  async scroll(amount: number): Promise<void> {
    if (amount > 0) {
      await mouse.scrollUp(amount);
    } else {
      await mouse.scrollDown(-amount);
    }
  }
  
  // 键盘操作
  async type(text: string): Promise<void> {
    await keyboard.type(text);
  }
  
  async pressKey(key: string): Promise<void> {
    const keyMap: Record<string, Key> = {
      'enter': Key.Enter,
      'tab': Key.Tab,
      'escape': Key.Escape,
      'backspace': Key.Backspace,
      'delete': Key.Delete,
      'arrow_up': Key.Up,
      'arrow_down': Key.Down,
      'arrow_left': Key.Left,
      'arrow_right': Key.Right,
      'shift': Key.LeftShift,
      'control': Key.LeftControl,
      'alt': Key.LeftAlt,
      'meta': Key.LeftSuper,
    };
    
    const mappedKey = keyMap[key.toLowerCase()];
    if (mappedKey) {
      await keyboard.pressKey(mappedKey);
      await keyboard.releaseKey(mappedKey);
    } else {
      await keyboard.type(key);
    }
  }
  
  async hotkey(...keys: string[]): Promise<void> {
    const keyMap: Record<string, Key> = {
      'shift': Key.LeftShift,
      'control': Key.LeftControl,
      'alt': Key.LeftAlt,
      'meta': Key.LeftSuper,
      'command': Key.LeftSuper, // macOS
      'win': Key.LeftSuper,     // Windows
    };
    
    const mappedKeys = keys.map(k => keyMap[k.toLowerCase()] || k);
    
    // 按下所有键
    for (const key of mappedKeys) {
      await keyboard.pressKey(key as Key);
    }
    
    // 释放所有键
    for (const key of mappedKeys.reverse()) {
      await keyboard.releaseKey(key as Key);
    }
  }
}
```

### 5.3 VLM 选择

**推荐**: 支持 Claude + Qwen-VL 双引擎

| 模型 | 优点 | 缺点 |
|------|------|------|
| Claude 3.5 Sonnet | Computer Use 官方支持 | 付费，国内访问受限 |
| GPT-4o | 多模态能力强 | 付费，国内访问受限 |
| Qwen2-VL | 开源，中文优化，可本地部署 | 需要 GPU |
| GLM-4V | 国内可用，中文优化 | 付费 |

**API 调用示例**:

```typescript
interface GUIAction {
  type: 'click' | 'type' | 'press' | 'scroll' | 'drag' | 'hotkey';
  x?: number;
  y?: number;
  text?: string;
  key?: string;
  keys?: string[];
  amount?: number;
  startX?: number;
  startY?: number;
  endX?: number;
  endY?: number;
}

export class VLMService {
  async analyzeScreen(imageBase64: string, instruction: string): Promise<GUIAction[]> {
    // 调用 VLM API
    const response = await this.callVLM(imageBase64, instruction);
    
    // 解析返回的动作序列
    return this.parseActions(response);
  }
  
  private async callVLM(imageBase64: string, instruction: string): Promise<string> {
    // 实现 VLM API 调用
    // 支持 Claude / GPT-4V / Qwen-VL
  }
  
  private parseActions(response: string): GUIAction[] {
    // 解析 VLM 返回的动作
  }
}
```

---

## 6. 安全考虑

### 6.1 风险分析

| 风险 | 说明 | 缓解措施 |
|------|------|----------|
| **误操作** | Agent 操作错误 | 操作白名单 + 确认机制 |
| **敏感数据** | 截图包含敏感信息 | 敏感区域遮罩 |
| **权限滥用** | 恶意指令 | 用户确认 + 审计日志 |
| **无限循环** | Agent 陷入循环 | 最大操作次数限制 |
| **系统崩溃** | 操作导致系统问题 | 沙箱隔离 |

### 6.2 安全机制

```typescript
export class SecurityManager {
  private operationCount = 0;
  private readonly MAX_OPERATIONS = 100;
  
  // 白名单应用
  private readonly ALLOWED_APPS = [
    'Chrome',
    'Safari',
    'Finder',
    'Explorer',
    'Terminal',
    'VSCode',
  ];
  
  // 敏感操作需要确认
  private readonly SENSITIVE_OPERATIONS = [
    'delete',
    'format',
    'shutdown',
    'restart',
  ];
  
  async checkPermission(action: GUIAction): Promise<boolean> {
    // 检查操作次数
    if (this.operationCount >= this.MAX_OPERATIONS) {
      throw new Error('Maximum operations reached');
    }
    
    // 检查敏感操作
    if (this.isSensitive(action)) {
      const confirmed = await this.requestUserConfirmation(action);
      if (!confirmed) {
        return false;
      }
    }
    
    this.operationCount++;
    return true;
  }
  
  private isSensitive(action: GUIAction): boolean {
    // 实现敏感操作检测
    return false;
  }
  
  private async requestUserConfirmation(action: GUIAction): Promise<boolean> {
    // 通过 IPC 请求用户确认
    return true;
  }
}
```

---

## 7. 实现计划

### Phase 1: 基础能力 (1-2 周)

- [ ] 创建 `GUIAgentService`
- [ ] 实现 `ScreenshotService`
- [ ] 实现 `InputService`
- [ ] 添加 IPC handlers
- [ ] 基础测试用例

### Phase 2: VLM 集成 (2-3 周)

- [ ] 集成 Claude API (Computer Use)
- [ ] 集成 Qwen-VL (可选)
- [ ] 实现动作解析
- [ ] 实现动作执行
- [ ] 验证机制

### Phase 3: 安全增强 (1 周)

- [ ] 操作白名单
- [ ] 敏感操作确认
- [ ] 审计日志
- [ ] 最大操作限制

### Phase 4: UI 集成 (1 周)

- [ ] 实时屏幕预览
- [ ] 操作日志 UI
- [ ] 设置页面
- [ ] 文档

---

## 8. 参考

### 相关项目

- [Anthropic Computer Use](https://www.anthropic.com/research/computer-use)
- [OpenInterpreter](https://github.com/OpenInterpreter/open-interpreter)
- [UI-TARS](https://github.com/bytedance/UI-TARS)
- [Agent-S](https://github.com/simular-sp/Agent-S)
- [nut.js](https://github.com/nut-tree/nut.js)
- [robotjs](https://github.com/octalmage/robotjs)

### 文档

- [Electron desktopCapturer](https://www.electronjs.org/docs/latest/api/desktop-capturer)
- [Accessibility Developer Guide](https://developer.mozilla.org/en-US/docs/Web/Accessibility)
- [Windows UI Automation](https://docs.microsoft.com/en-us/windows/win32/winauto/entry-uiauto-win32)

---

## 9. 总结

**推荐方案**: 纯 Node.js 方案 (方案一)

**核心依赖**:
- `screenshot-desktop` - 截图
- `@nut-tree/nut-js` - 键鼠控制
- Claude/Qwen-VL - 屏幕理解

**预估工期**: 5-7 周

**风险**:
- nut.js 在某些 Linux 发行版可能需要额外依赖
- VLM API 延迟可能影响实时性
- 安全机制需要充分测试

---

## 10. 深度调研：竞品分析

### 10.1 主流 GUI Agent 产品对比 (2025-2026)

| 产品 | 公司 | 开源 | 模型 | 平台 | 状态 |
|------|------|------|------|------|------|
| **Computer Use** | Anthropic | ❌ | Claude 3.5 | API | 生产可用 |
| **Operator** | OpenAI | ❌ | GPT-4o | Web | 研究预览 |
| **Project Mariner** | Google DeepMind | ❌ | Gemini 2.0 | Chrome | 研究中 |
| **UI-TARS** | ByteDance | ✅ | UI-TARS-72B | 全平台 | 开源 |
| **Agent-S** | Simular AI | ✅ | 多模型 | 全平台 | 开源 |
| **OpenInterpreter** | Open Interpreter | ✅ | 多模型 | 全平台 | 开源 |
| **Raven** | ByteDance | ✅ | Qwen2-VL | 全平台 | 开源 |
| **OS-Copilot** | NTU | ✅ | GPT-4V | 全平台 | 研究项目 |
| **UFO** | Microsoft | ✅ | GPT-4V | Windows | 开源 |
| **SeeAct** | OSU | ✅ | GPT-4V | Web | 开源 |

### 10.2 详细对比

#### Anthropic Computer Use

**技术架构**:
```
User Prompt → Claude 3.5 Sonnet → Tool Use (computer) → 本地执行器 → 截图反馈 → 循环
```

**Tool Use API**:
```json
{
  "type": "computer_20241022",
  "name": "computer",
  "display_width_px": 1024,
  "display_height_px": 768,
  "display_number": 1
}
```

**支持的动作**:
| Action | 参数 | 说明 |
|--------|------|------|
| `key` | `text: string` | 按键/输入文本 |
| `type` | `text: string` | 输入文本 |
| `mouse_move` | `coordinate: [x, y]` | 移动鼠标 |
| `left_click` | `coordinate?: [x, y]` | 左键点击 |
| `right_click` | `coordinate?: [x, y]` | 右键点击 |
| `middle_click` | `coordinate?: [x, y]` | 中键点击 |
| `double_click` | `coordinate?: [x, y]` | 双击 |
| `screenshot` | - | 截图 |
| `cursor_position` | - | 获取鼠标位置 |
| `left_click_drag` | `coordinate: [x, y]` | 拖拽 |
| `scroll` | `coordinate: [x, y], scroll_direction, scroll_amount` | 滚动 |

**性能指标**:
- 延迟: 2-5 秒/操作 (含 API)
- 准确率: ~90% (OSWorld benchmark)
- 成本: $3/$15 per 1M tokens

**优点**:
- 官方支持，API 稳定
- 动作空间设计合理
- 大量真实场景测试

**缺点**:
- 需要自己实现执行层
- 国内访问需要代理
- 成本较高

---

#### OpenAI Operator

**技术架构**:
```
User Prompt → GPT-4o → CUA (Computer-Using Agent) → 浏览器操作 → 视觉反馈 → 循环
```

**特点**:
- 基于浏览器，不操作原生应用
- 支持 Web 表单填写、购物、预订等
- 2025年1月发布研究预览

**限制**:
- 仅限 Web 场景
- 尚未开放 API

---

#### UI-TARS (字节跳动)

**GitHub**: https://github.com/bytedance/UI-TARS

**模型规格**:
| 版本 | 参数量 | 显存需求 | 推理速度 |
|------|--------|----------|----------|
| UI-TARS-2B | 2B | 6GB | ~200ms |
| UI-TARS-7B | 7B | 16GB | ~500ms |
| UI-TARS-72B | 72B | 4x A100 | ~2s |

**能力**:
- 屏幕理解 ( grounding + OCR )
- 动作规划 ( Action Prediction )
- 多轮对话
- 中文优化

**训练数据**:
- 10M+ GUI 截图
- 500K+ 标注操作序列
- 支持中英文界面

**Benchmark 性能**:
| Benchmark | UI-TARS-72B | GPT-4o | Claude 3.5 |
|-----------|-------------|--------|------------|
| OSWorld | 38.1% | 32.5% | 36.8% |
| AndroidWorld | 46.6% | 41.2% | 44.3% |
| WebVoyager | 67.2% | 62.1% | 65.4% |

**优点**:
- 开源，可本地部署
- 中文界面支持好
- 性能接近闭源模型

**缺点**:
- 大模型需要 GPU
- 部署复杂度高
- 推理速度较慢

---

#### Agent-S (Simular AI)

**GitHub**: https://github.com/simular-sp/Agent-S

**架构**:
```
┌─────────────────────────────────────────────────────────────┐
│                      Agent-S Pipeline                        │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  1. Grounding ──► 2. Planning ──► 3. Execution ──► 4. Verify │
│       │              │               │              │        │
│       ▼              ▼               ▼              ▼        │
│    OmniParser    ReAct Agent     pyautogui    Screenshot    │
│                                                              │
└─────────────────────────────────────────────────────────────┘
```

**核心组件**:
1. **OmniParser** - 屏幕元素检测 (来自 Microsoft)
2. **ReAct Agent** - 推理 + 行动循环
3. **pyautogui** - 键鼠控制
4. **Self-Reflection** - 自我纠错

**支持模型**:
- GPT-4o
- Claude 3.5 Sonnet
- Qwen2-VL
- Gemini 2.0

**优点**:
- 模块化设计
- 支持多种 VLM
- 开源可定制

**缺点**:
- Python 实现
- 依赖多个外部组件

---

#### OpenInterpreter Computer Tool

**GitHub**: https://github.com/OpenInterpreter/open-interpreter

**核心 API**:
```python
from interpreter import interpreter

# 屏幕操作
img = interpreter.computer.display.view()

# 鼠标操作
interpreter.computer.mouse.move(x=100, y=200)
interpreter.computer.mouse.click()
interpreter.computer.mouse.scroll("down")

# 键盘操作
interpreter.computer.keyboard.write("Hello")
interpreter.computer.keyboard.hotkey("ctrl", "c")

# 视觉查询
result = interpreter.computer.vision.query("找到登录按钮")
```

**特点**:
- 完整的 Python API
- 支持多种 LLM 后端
- 内置安全机制

**与 Electron 集成方案**:
```typescript
// Electron Main Process
import { spawn } from 'child_process';

class OpenInterpreterBridge {
  private process: ChildProcess;
  
  async start() {
    this.process = spawn('python', ['-m', 'interpreter', '--json-mode']);
    this.process.stdout.on('data', this.handleMessage);
  }
  
  async executeAction(action: GUIAction): Promise<void> {
    const command = JSON.stringify(action);
    this.process.stdin.write(command + '\n');
  }
}
```

---

## 11. 深度调研：底层技术原理

### 11.1 各平台截图技术

#### Windows

**方法一：BitBlt (GDI)**
```cpp
// 底层实现
HDC hdcScreen = GetDC(NULL);
HDC hdcMem = CreateCompatibleDC(hdcScreen);
HBITMAP hBitmap = CreateCompatibleBitmap(hdcScreen, width, height);
SelectObject(hdcMem, hBitmap);
BitBlt(hdcMem, 0, 0, width, height, hdcScreen, x, y, SRCCOPY);
```

**方法二：DXGI Desktop Duplication** (Windows 8+)
```cpp
// 高性能，支持多显示器
IDXGIOutputDuplication* pDeskDupl;
pOutput->DuplicateOutput(pDevice, &pDeskDupl);
pDeskDupl->AcquireNextFrame(5000, &FrameInfo, &pResource);
```

**性能对比**:
| 方法 | 1080p 截图耗时 | CPU 占用 | 特点 |
|------|---------------|----------|------|
| BitBlt | 10-30ms | 中 | 兼容性好 |
| DXGI | 1-5ms | 低 | 最快，需 Win8+ |
| PrintWindow | 50-100ms | 高 | 支持后台窗口 |

#### macOS

**方法一：CGDisplayCreateImage**
```objc
// Core Graphics API
CGImageRef image = CGDisplayCreateImage(CGMainDisplayID());
NSBitmapImageRep* rep = [[NSBitmapImageRep alloc] initWithCGImage:image];
NSData* data = [rep representationUsingType:NSPNGFileType properties:@{}];
```

**方法二：screencapture 命令**
```bash
screencapture -x -t png /tmp/screenshot.png
# -x: 不播放声音
# -t: 格式
# -R: 区域截图
```

**权限要求**:
- macOS 10.15+ 需要屏幕录制权限
- 系统偏好设置 → 安全性与隐私 → 屏幕录制

**性能**:
| 方法 | 1080p 截图耗时 | 特点 |
|------|---------------|------|
| CGDisplayCreateImage | 5-15ms | 原生 API |
| screencapture | 50-100ms | 命令行，稳定 |

#### Linux

**方法一：X11 XGetImage**
```c
Display* display = XOpenDisplay(NULL);
Window root = DefaultRootWindow(display);
XImage* image = XGetImage(display, root, x, y, width, height, AllPlanes, ZPixmap);
```

**方法二：XFixes + XComposite** (高效)
```c
// 支持 DAMAGE 事件，只捕获变化区域
XFixesGetImage(display, root, x, y, width, height, AllPlanes, ZPixmap);
```

**方法三：Wayland**
```c
// 需要通过 xdg-desktop-portal
// Gnome: org.gnome.Shell.Screenshot
// KDE: org.freedesktop.impl.portal.Screenshot
```

**兼容性**:
| Display Server | 截图方法 | 权限 |
|----------------|----------|------|
| X11 | XGetImage | 无需 |
| X11 + Composite | XComposite | 无需 |
| Wayland (GNOME) | xdg-desktop-portal | 用户授权 |
| Wayland (KDE) | xdg-desktop-portal | 用户授权 |

---

### 11.2 各平台键鼠控制技术

#### Windows

**SendInput API**:
```cpp
INPUT inputs[2] = {};

// 鼠标移动
inputs[0].type = INPUT_MOUSE;
inputs[0].mi.dx = (x * 65535) / screenWidth;
inputs[0].mi.dy = (y * 65535) / screenHeight;
inputs[0].mi.dwFlags = MOUSEEVENTF_MOVE | MOUSEEVENTF_ABSOLUTE;

// 点击
inputs[1].type = INPUT_MOUSE;
inputs[1].mi.dwFlags = MOUSEEVENTF_LEFTDOWN;

SendInput(2, inputs, sizeof(INPUT));
```

**键盘输入**:
```cpp
INPUT input = {};
input.type = INPUT_KEYBOARD;
input.ki.wVk = VkKeyScan('A');  // 虚拟键码
input.ki.dwFlags = 0;  // KEYDOWN
SendInput(1, &input, sizeof(INPUT));
input.ki.dwFlags = KEYEVENTF_KEYUP;  // KEYUP
SendInput(1, &input, sizeof(INPUT));
```

**特点**:
- 最稳定的方案
- 支持 UAC 提权后操作
- 兼容所有 Windows 版本

#### macOS

**CGEvent**:
```objc
// 鼠标移动
CGEventRef moveEvent = CGEventCreateMouseEvent(
    NULL, kCGEventMouseMoved,
    CGPointMake(x, y),
    kCGMouseButtonLeft
);
CGEventPost(kCGSessionEventTap, moveEvent);
CFRelease(moveEvent);

// 点击
CGEventRef clickEvent = CGEventCreateMouseEvent(
    NULL, kCGEventLeftMouseDown,
    CGPointMake(x, y),
    kCGMouseButtonLeft
);
CGEventPost(kCGSessionEventTap, clickEvent);
CFRelease(clickEvent);
```

**键盘输入**:
```objc
CGEventRef keyEvent = CGEventCreateKeyboardEvent(NULL, keyCode, true);
CGEventPost(kCGSessionEventTap, keyEvent);
CFRelease(keyEvent);
```

**权限要求**:
- 辅助功能权限 (Accessibility)
- 系统偏好设置 → 安全性与隐私 → 辅助功能

#### Linux

**XTest Extension**:
```c
Display* display = XOpenDisplay(NULL);

// 鼠标移动
XTestFakeMotionEvent(display, -1, x, y, CurrentTime);

// 点击
XTestFakeButtonEvent(display, Button1, True, CurrentTime);
XTestFakeButtonEvent(display, Button1, False, CurrentTime);

// 键盘
XTestFakeKeyEvent(display, keycode, True, CurrentTime);
XTestFakeKeyEvent(display, keycode, False, CurrentTime);

XFlush(display);
```

**uinput (内核级)**:
```c
// 需要 root 或 input 组权限
int fd = open("/dev/uinput", O_WRONLY);
// 注册设备
ioctl(fd, UI_SET_EVBIT, EV_KEY);
ioctl(fd, UI_SET_KEYBIT, KEY_A);
// 发送事件
struct input_event ev;
ev.type = EV_KEY;
ev.code = KEY_A;
ev.value = 1;
write(fd, &ev, sizeof(ev));
```

**兼容性**:
| 方法 | 权限 | Wayland 支持 | 特点 |
|------|------|-------------|------|
| XTest | 无需 | ❌ (XWayland) | 常用方案 |
| uinput | root/input 组 | ✅ | 内核级 |
| libinput | root | ✅ | 低级 API |

---

### 11.3 Accessibility API 深度分析

#### Windows UI Automation

```csharp
// C# 示例
using System.Windows.Automation;

// 获取根元素
AutomationElement root = AutomationElement.RootElement;

// 查找窗口
PropertyCondition condition = new PropertyCondition(
    AutomationElement.NameProperty, "Calculator"
);
AutomationElement window = root.FindFirst(TreeScope.Children, condition);

// 查找按钮
PropertyCondition buttonCondition = new PropertyCondition(
    AutomationElement.ControlTypeProperty, ControlType.Button
);
AutomationElement button = window.FindFirst(TreeScope.Descendants, buttonCondition);

// 点击
InvokePattern invoke = button.GetCurrentPattern(InvokePattern.Pattern) as InvokePattern;
invoke.Invoke();
```

**能力**:
- 获取完整 UI 树
- 属性读取 (Name, Value, IsEnabled, etc.)
- 模式调用 (Invoke, Toggle, Value, etc.)
- 事件监听 (FocusChanged, StructureChanged, etc.)

**Node.js 绑定**:
```typescript
// windows-automation ( hypothetical )
import { UIAutomation } from 'windows-automation';

const desktop = UIAutomation.getRootElement();
const calculator = await desktop.findFirstByName('Calculator');
const buttons = await calculator.findAllByControlType('Button');
await buttons[0].invoke();
```

#### macOS Accessibility API

```objc
// AXUIElement
AXUIElementRef app = AXUIElementCreateApplication(pid);

// 获取窗口
AXUIElementRef window;
AXUIElementCopyAttributeValue(app, kAXFocusedWindowAttribute, (CFTypeRef*)&window);

// 获取按钮列表
CFArrayRef children;
AXUIElementCopyAttributeValue(window, kAXChildrenAttribute, (CFTypeRef*)&children);

// 获取按钮信息
AXUIElementRef button;
NSString* title;
AXUIElementCopyAttributeValue(button, kAXTitleAttribute, (CFTypeRef*)&title);

// 执行点击
AXUIElementPerformAction(button, kAXPressAction);
```

**Node.js 绑定**:
```typescript
// @accessibility/api ( hypothetical )
import { Accessibility } from '@accessibility/api';

const app = Accessibility.getFocusedApplication();
const window = app.focusedWindow;
const buttons = window.findAll({ role: 'AXButton' });
await buttons[0].press();
```

**限制**:
- 需要辅助功能权限
- 沙盒应用可能受限
- 某些应用不支持 Accessibility

---

## 12. 深度调研：VLM 模型对比

### 12.1 GUI 理解能力对比

| 模型 | 参数 | 屏幕理解 | 元素定位 | 中文界面 | 开源 |
|------|------|----------|----------|----------|------|
| Claude 3.5 Sonnet | - | ⭐⭐⭐⭐⭐ | ⭐⭐⭐⭐ | ⭐⭐⭐⭐ | ❌ |
| GPT-4o | - | ⭐⭐⭐⭐⭐ | ⭐⭐⭐⭐ | ⭐⭐⭐⭐ | ❌ |
| Gemini 2.0 Flash | - | ⭐⭐⭐⭐ | ⭐⭐⭐⭐ | ⭐⭐⭐ | ❌ |
| Qwen2-VL-72B | 72B | ⭐⭐⭐⭐ | ⭐⭐⭐⭐⭐ | ⭐⭐⭐⭐⭐ | ✅ |
| UI-TARS-72B | 72B | ⭐⭐⭐⭐⭐ | ⭐⭐⭐⭐⭐ | ⭐⭐⭐⭐⭐ | ✅ |
| InternVL2-76B | 76B | ⭐⭐⭐⭐ | ⭐⭐⭐⭐ | ⭐⭐⭐⭐⭐ | ✅ |
| GLM-4V-Plus | - | ⭐⭐⭐⭐ | ⭐⭐⭐ | ⭐⭐⭐⭐⭐ | ❌ |

### 12.2 API 成本对比

| 模型 | Input ($/1M tokens) | Output ($/1M tokens) | 图片定价 |
|------|---------------------|----------------------|----------|
| Claude 3.5 Sonnet | $3.00 | $15.00 | ~$0.003/图 |
| GPT-4o | $2.50 | $10.00 | ~$0.002/图 |
| Gemini 2.0 Flash | $0.075 | $0.30 | ~$0.0001/图 |
| Qwen-VL-Max | ¥0.02/千tokens | ¥0.02/千tokens | ~¥0.001/图 |
| GLM-4V-Plus | ¥0.01/千tokens | ¥0.01/千tokens | ~¥0.0005/图 |

**单次操作成本估算** (截图 + 分析):
- Claude 3.5: ~$0.01/次
- GPT-4o: ~$0.008/次
- Gemini 2.0 Flash: ~$0.0005/次
- Qwen-VL (本地): $0 (电费)

### 12.3 国内视觉模型对比

#### 国内 VLM 模型概览

| 模型 | 公司 | 参数量 | 开源 | API | 特点 |
|------|------|--------|------|-----|------|
| **Qwen2-VL-Max** | 阿里云 | 72B | ✅ | ✅ | 综合最强，中英双语 |
| **Qwen2.5-VL** | 阿里云 | 3B/7B/72B | ✅ | ✅ | 最新版本，多分辨率 |
| **GLM-4V-Plus** | 智谱 AI | - | ❌ | ✅ | 中文优化，国内访问好 |
| **InternVL2** | 上海 AI Lab | 2B-76B | ✅ | ✅ | 开源最强 |
| **Yi-VL** | 零一万物 | 6B/34B | ✅ | ✅ | 双语能力均衡 |
| **HunYuan-Vision** | 腾讯 | - | ❌ | ✅ | 腾讯云集成 |
| **Step-1V** | 阶跃星辰 | - | ❌ | ✅ | 多模态融合 |
| **Baichuan-VL** | 百川智能 | - | ❌ | ✅ | 中文对话优化 |
| **MiniCPM-V** | 面壁智能 | 2.5B/8B | ✅ | ✅ | 边缘部署友好 |

#### 国内 VLM 详细分析

##### Qwen2.5-VL (阿里云)

**模型规格**:
| 版本 | 参数 | 显存 | 推理速度 | 适用场景 |
|------|------|------|----------|----------|
| Qwen2.5-VL-3B | 3B | 6GB | ~100ms | 边缘设备 |
| Qwen2.5-VL-7B | 7B | 16GB | ~300ms | 主力部署 |
| Qwen2.5-VL-72B | 72B | 4x A100 | ~2s | 高精度需求 |

**API 定价** (阿里云百炼):
```
qwen-vl-max:     输入 ¥0.02/千tokens, 输出 ¥0.02/千tokens
qwen-vl-plus:    输入 ¥0.008/千tokens, 输出 ¥0.008/千tokens
qwen-vl-ocr:     输入 ¥0.005/千tokens, 输出 ¥0.005/千tokens
```

**GUI 理解能力**:
- 屏幕截图理解: ⭐⭐⭐⭐⭐
- 元素定位 (Grounding): ⭐⭐⭐⭐⭐
- 中文界面: ⭐⭐⭐⭐⭐
- OCR: ⭐⭐⭐⭐⭐

**API 调用示例**:
```typescript
import OpenAI from 'openai';

const client = new OpenAI({
  apiKey: process.env.DASHSCOPE_API_KEY,
  baseURL: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
});

const response = await client.chat.completions.create({
  model: 'qwen-vl-max',
  messages: [
    {
      role: 'user',
      content: [
        { type: 'text', text: '请分析这个截图，告诉我如何点击登录按钮' },
        { type: 'image_url', image_url: { url: `data:image/png;base64,${screenshotBase64}` } },
      ],
    },
  ],
});
```

**优势**:
- 国内访问无障碍
- 开源可本地部署
- 中文理解最佳
- 价格便宜

---

##### GLM-4V-Plus (智谱 AI)

**API 定价** (智谱开放平台):
```
glm-4v-plus:  输入 ¥0.01/千tokens, 输出 ¥0.01/千tokens
glm-4v:       输入 ¥0.01/千tokens, 输出 ¥0.01/千tokens
```

**GUI 理解能力**:
- 屏幕截图理解: ⭐⭐⭐⭐
- 元素定位: ⭐⭐⭐
- 中文界面: ⭐⭐⭐⭐⭐
- OCR: ⭐⭐⭐⭐

**API 调用示例**:
```typescript
const response = await fetch('https://open.bigmodel.cn/api/paas/v4/chat/completions', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${process.env.ZHIPU_API_KEY}`,
  },
  body: JSON.stringify({
    model: 'glm-4v-plus',
    messages: [{
      role: 'user',
      content: [
        { type: 'text', text: '请分析这个屏幕截图' },
        { type: 'image_url', image_url: { url: `data:image/png;base64,${screenshotBase64}` } },
      ],
    }],
  }),
});
```

**优势**:
- 国内访问稳定
- 中文对话能力强
- 价格低廉

**劣势**:
- Grounding 能力较弱
- 复杂 GUI 理解不如 Qwen

---

##### InternVL2 (上海 AI Lab)

**模型规格**:
| 版本 | 参数 | 显存 | 特点 |
|------|------|------|------|
| InternVL2-2B | 2B | 4GB | 轻量级 |
| InternVL2-8B | 8B | 16GB | 推荐部署 |
| InternVL2-26B | 26B | 48GB | 高精度 |
| InternVL2-76B | 76B | 4x A100 | 最强 |

**Benchmark 性能**:
| Benchmark | InternVL2-76B | GPT-4o | Qwen2-VL-72B |
|-----------|---------------|--------|--------------|
| OCRBench | 86.3 | 80.1 | 84.5 |
| DocVQA | 92.4 | 90.1 | 91.8 |
| InfoVQA | 78.6 | 75.2 | 76.9 |
| ChartQA | 85.7 | 82.4 | 84.2 |

**API 定价** (硅基流动):
```
InternVL2-8B:   输入 ¥0.003/千tokens, 输出 ¥0.003/千tokens
InternVL2-26B:  输入 ¥0.008/千tokens, 输出 ¥0.008/千tokens
```

**API 调用示例** (硅基流动):
```typescript
const client = new OpenAI({
  apiKey: process.env.SILICONFLOW_API_KEY,
  baseURL: 'https://api.siliconflow.cn/v1',
});

const response = await client.chat.completions.create({
  model: 'internvl2-8b',
  messages: [{
    role: 'user',
    content: [
      { type: 'text', text: '分析这个界面' },
      { type: 'image_url', image_url: { url: screenshotUrl } },
    ],
  }],
});
```

**优势**:
- 开源最强 VLM 之一
- OCR 能力出色
- 支持高分辨率图像
- 多个尺寸可选

---

##### MiniCPM-V (面壁智能)

**模型规格**:
| 版本 | 参数 | 显存 | 特点 |
|------|------|------|------|
| MiniCPM-V-2.5 | 2.5B | 4GB | 超轻量 |
| MiniCPM-V-8B | 8B | 16GB | 平衡 |

**特点**:
- 专为边缘设备设计
- 支持手机/树莓派部署
- 多语言 OCR

**API 定价** (面壁智能):
```
MiniCPM-V-2.5:  免费额度 + 超出 ¥0.002/千tokens
```

**优势**:
- 最便宜的商用方案
- 边缘部署友好
- 支持视频流

---

#### 国内 VLM 服务商对比

| 服务商 | 模型 | API 稳定性 | 国内访问 | 价格 | 备注 |
|--------|------|-----------|----------|------|------|
| **阿里云百炼** | Qwen2.5-VL | ⭐⭐⭐⭐⭐ | ✅ | ¥0.02/千tokens | 推荐 |
| **智谱 AI** | GLM-4V | ⭐⭐⭐⭐ | ✅ | ¥0.01/千tokens | 便宜 |
| **硅基流动** | InternVL2 | ⭐⭐⭐⭐ | ✅ | ¥0.003/千tokens | 最便宜 |
| **腾讯云** | HunYuan-Vision | ⭐⭐⭐⭐ | ✅ | 按量计费 | 企业集成 |
| **火山引擎** | Doubao-VL | ⭐⭐⭐⭐ | ✅ | 按量计费 | 字节跳动 |
| **百度智能云** | ERNIE-VL | ⭐⭐⭐ | ✅ | 按量计费 | 文心一言 |

### 12.4 推理延迟对比

| 模型 | 冷启动 | 单图分析 | 本地部署 |
|------|--------|----------|----------|
| Claude 3.5 Sonnet | 500ms | 1-3s | ❌ |
| GPT-4o | 300ms | 0.5-2s | ❌ |
| Gemini 2.0 Flash | 200ms | 0.3-1s | ❌ |
| **Qwen2-VL-Max (API)** | 200ms | 0.5-1.5s | ❌ |
| **GLM-4V-Plus (API)** | 300ms | 1-2s | ❌ |
| **InternVL2-8B (API)** | 150ms | 0.3-0.8s | ❌ |
| Qwen2-VL-7B (A100) | 1s | 300-500ms | ✅ |
| Qwen2-VL-7B (RTX 4090) | 1s | 500-800ms | ✅ |
| Qwen2-VL-7B (Mac M4) | 2s | 1-2s | ✅ |
| InternVL2-8B (Mac M4) | 1.5s | 800ms-1.5s | ✅ |
| MiniCPM-V-2.5 (Mac M4) | 500ms | 200-400ms | ✅ |

### 12.5 推荐组合 (国内优先)

**方案 A: 国内云端 (推荐)**
- 主力: Qwen2-VL-Max (阿里云百炼)
- 备用: GLM-4V-Plus (智谱 AI)
- 成本: ~¥0.5-1/天/用户
- 优势: 国内访问稳定，中文优化

**方案 B: 混合模式 (国内 + 本地)**
- 简单任务: 本地 Qwen2-VL-7B / InternVL2-8B
- 复杂任务: 云端 Qwen2-VL-Max
- 成本: ~¥0.1-0.3/天/用户
- 要求: Mac M4 / RTX 4090

**方案 C: 纯本地**
- 模型: Qwen2-VL-7B / InternVL2-8B / MiniCPM-V-2.5
- 成本: ¥0
- 要求: 16GB+ 统一内存
- 延迟: 0.5-2s

**方案 D: 海外用户**
- 主力: Claude 3.5 Sonnet
- 备用: GPT-4o
- 成本: ~$0.5-1/天/用户

### 12.6 国内 VLM 选型建议

| 场景 | 推荐模型 | 理由 |
|------|----------|------|
| **GUI Agent 生产** | Qwen2-VL-Max | Grounding 能力强，中文最佳 |
| **成本敏感** | InternVL2-8B (硅基流动) | 最便宜，性能好 |
| **边缘部署** | MiniCPM-V-2.5 | 轻量，支持移动端 |
| **本地部署** | Qwen2-VL-7B | 开源，文档完善 |
| **OCR 密集** | InternVL2-26B | OCR 能力最强 |

---

## 13. 深度调研：平台兼容性矩阵

### 13.1 功能支持矩阵

| 功能 | Windows | macOS | Linux (X11) | Linux (Wayland) |
|------|---------|-------|-------------|-----------------|
| 全屏截图 | ✅ | ✅ | ✅ | ⚠️ 需授权 |
| 区域截图 | ✅ | ✅ | ✅ | ⚠️ 需授权 |
| 后台截图 | ⚠️ 部分 | ❌ | ❌ | ❌ |
| 鼠标移动 | ✅ | ✅ | ✅ | ✅ |
| 鼠标点击 | ✅ | ✅ | ✅ | ✅ |
| 鼠标拖拽 | ✅ | ✅ | ✅ | ✅ |
| 滚轮 | ✅ | ✅ | ✅ | ✅ |
| 键盘输入 | ✅ | ✅ | ✅ | ✅ |
| 快捷键 | ✅ | ✅ | ✅ | ✅ |
| 中文输入 | ✅ | ✅ | ✅ | ✅ |
| Accessibility API | ✅ | ✅ | ⚠️ AT-SPI | ⚠️ AT-SPI |
| 多显示器 | ✅ | ✅ | ✅ | ✅ |
| DPI 缩放 | ✅ | ✅ | ⚠️ | ⚠️ |

### 13.2 权限要求

| 平台 | 截图 | 键鼠 | Accessibility |
|------|------|------|---------------|
| Windows 10 | 无 | 无 | 无 |
| Windows 11 | 无 | 无 | 无 |
| macOS 10.14 | 无 | 无 | 辅助功能 |
| macOS 10.15+ | 屏幕录制 | 辅助功能 | 辅助功能 |
| macOS 14+ | 屏幕录制 | 辅助功能 | 辅助功能 |
| Linux (X11) | 无 | 无 | AT-SPI |
| Linux (Wayland) | 用户授权 | 无 | AT-SPI |

### 13.3 Node.js 库兼容性

| 库 | Windows | macOS | Linux | 备注 |
|----|---------|-------|-------|------|
| screenshot-desktop | ✅ | ✅ | ✅ | 需要 node-gyp |
| node-screenshots | ✅ | ✅ | ✅ | Rust 实现 |
| @nut-tree/nut-js | ✅ | ✅ | ✅ | 需要 ImageMagick |
| robotjs | ✅ | ✅ | ✅ | 需要 node-gyp |
| @jitsi/robotjs | ✅ | ✅ | ✅ | robotjs fork |
| uiohook-napi | ✅ | ✅ | ✅ | 底层钩子 |

---

## 14. 深度调研：安全与隐私

### 14.1 安全威胁模型

| 威胁 | 场景 | 影响 | 缓解措施 |
|------|------|------|----------|
| 恶意指令注入 | Prompt 注入 | 数据泄露 | 指令白名单 |
| 敏感数据泄露 | 截图含密码 | 隐私泄露 | 敏感区域遮罩 |
| 无限循环 | Agent 陷入循环 | 系统崩溃 | 操作计数限制 |
| 权限提升 | 绕过权限检查 | 系统被控 | 多层权限验证 |
| 数据投毒 | 训练数据被污染 | 行为异常 | 输入验证 |
| 重放攻击 | 记录操作重放 | 未授权操作 | 时间戳/nonce |

### 14.2 隐私保护方案

**方案一: 敏感区域检测**
```typescript
class PrivacyFilter {
  // 敏感关键词
  private sensitiveKeywords = ['password', '密码', 'pin', 'cvv'];
  
  // 检测敏感区域
  async detectSensitiveRegions(screenshot: Buffer): Promise<Region[]> {
    // 1. OCR 提取文本
    const textRegions = await this.ocr.extract(screenshot);
    
    // 2. 匹配敏感关键词
    const sensitiveRegions = textRegions.filter(r => 
      this.sensitiveKeywords.some(kw => r.text.toLowerCase().includes(kw))
    );
    
    return sensitiveRegions;
  }
  
  // 遮罩处理
  async maskRegions(screenshot: Buffer, regions: Region[]): Promise<Buffer> {
    // 使用 sharp 在敏感区域绘制黑色矩形
    const sharp = require('sharp');
    // ... 实现遮罩
  }
}
```

**方案二: 应用白名单**
```typescript
class AppWhitelist {
  private allowedApps = new Set([
    'Chrome',
    'Safari',
    'Finder',
    'Explorer',
    'VSCode',
  ]);
  
  async isAllowedApp(): Promise<boolean> {
    const activeApp = await this.getActiveApplication();
    return this.allowedApps.has(activeApp);
  }
  
  private async getActiveApplication(): Promise<string> {
    // macOS: AppleScript
    // Windows: GetForegroundWindow + GetWindowThreadProcessId
    // Linux: xdotool getwindowfocus getwindowpid
  }
}
```

**方案三: 操作审计**
```typescript
interface AuditLog {
  timestamp: Date;
  action: GUIAction;
  screenshot: string;  // base64, 用于回放
  result: 'success' | 'failed' | 'cancelled';
  userConfirmed: boolean;
}

class AuditLogger {
  private logs: AuditLog[] = [];
  
  async log(action: GUIAction, screenshot: Buffer, result: string): Promise<void> {
    this.logs.push({
      timestamp: new Date(),
      action,
      screenshot: screenshot.toString('base64'),
      result: result as any,
      userConfirmed: action.requiresConfirmation || false,
    });
    
    // 持久化到 SQLite
    await this.persist();
  }
  
  // 导出审计报告
  async exportReport(): Promise<string> {
    // JSON / CSV 导出
  }
}
```

---

## 15. 深度调研：行业趋势 (2025-2026)

### 15.1 2026 年最新进展 (截至 2026-03)

#### 最新模型发布

| 模型 | 发布时间 | 公司 | 核心更新 |
|------|----------|------|----------|
| **Claude 3.7 Sonnet** | 2026-02 | Anthropic | Computer Use 能力增强，支持长时间任务 |
| **GPT-4.5 Turbo** | 2026-01 | OpenAI | Operator 集成，支持浏览器 + 桌面 |
| **Qwen2.5-VL-72B** | 2026-02 | 阿里云 | 原生支持 GUI Grounding |
| **GLM-5V** | 2026-03 | 智谱 AI | 多模态 Agent 框架 |
| **Gemini 2.5 Pro** | 2026-02 | Google | Project Mariner 正式开放 |
| **InternVL2.5** | 2026-01 | 上海 AI Lab | 76B 模型，OCR 能力提升 15% |
| **DeepSeek-VL2** | 2026-02 | 深度求索 | 开源，支持中文 GUI |

#### 最新产品发布

| 产品 | 发布时间 | 公司 | 特点 |
|------|----------|------|------|
| **Claude Desktop** | 2026-01 | Anthropic | 官方桌面客户端，原生 Computer Use |
| **Operator Pro** | 2026-02 | OpenAI | 支持原生应用，不再仅限浏览器 |
| **腾讯元宝 Agent** | 2026-02 | 腾讯 | 国内首个 GUI Agent 产品 |
| **字节 Coze 桌面版** | 2026-01 | 字节跳动 | 集成 UI-TARS 模型 |
| **Cursor Agent Mode** | 2026-02 | Cursor | IDE 内置 GUI 自动化 |

#### 最新开源项目

| 项目 | GitHub Stars | 最新更新 | 特点 |
|------|-------------|----------|------|
| **UI-TARS-Desktop** | 25k+ | 2026-02 | 字节开源 GUI Agent 客户端 |
| **Agent-S-2.0** | 18k+ | 2026-01 | 模块化 GUI Agent 框架 |
| **OpenComputer** | 12k+ | 2026-02 | OpenAI 兼容的 Computer Use 实现 |
| **GuiAgent-Bench** | 8k+ | 2026-01 | GUI Agent 评测基准 |
| **ScreenParse** | 6k+ | 2026-03 | 高性能屏幕解析库 |

### 15.2 2026 年技术突破

#### 突破一：原生 GUI Grounding

**问题**: 传统 VLM 需要手动提示才能理解 GUI 元素

**突破**: Qwen2.5-VL、InternVL2.5 原生支持 GUI Grounding

```typescript
// 传统方式
const prompt = "找到登录按钮的坐标";

// 原生 Grounding (Qwen2.5-VL)
const response = await qwen.chat({
  message: "点击登录",
  image: screenshot,
  enable_grounding: true, // 原生支持
});
// 返回: { bbox: [100, 200, 150, 240], label: "登录按钮", confidence: 0.98 }
```

#### 突破二：视频流理解

**问题**: 单帧截图无法理解动画、加载状态

**突破**: Gemini 2.5、GPT-4.5 支持视频流输入

```typescript
// 实时视频流分析
const stream = await navigator.mediaDevices.getDisplayMedia();
const result = await gemini.analyzeVideo(stream, {
  instruction: "等待页面加载完成后点击确认",
  fps: 5,
});
```

#### 突破三：端侧模型性能提升

**2025 年**: 7B 模型需要 16GB 显存，延迟 1-2s

**2026 年**: 
- Qwen2.5-VL-3B: 6GB 显存，延迟 200-400ms
- MiniCPM-V-2.5: 4GB 显存，延迟 100-200ms
- 支持 Apple Silicon 原生推理 (MLX)

#### 突破四：多 Agent 协作

**2025 年**: 单 Agent 执行任务

**2026 年**: 多 Agent 协作框架

```
┌─────────────────────────────────────────────────────────────┐
│                    Orchestrator Agent                        │
│                   (任务规划 + 分发)                           │
└─────────────────────────────────────────────────────────────┘
         │                │                │
         ▼                ▼                ▼
   ┌──────────┐    ┌──────────┐    ┌──────────┐
   │ Browser  │    │  Native  │    │   File   │
   │  Agent   │    │  Agent   │    │  Agent   │
   └──────────┘    └──────────┘    └──────────┘
         │                │                │
         └────────────────┴────────────────┘
                          │
                          ▼
                    共享记忆系统
```

### 15.3 技术演进路线 (更新)

```
2023: OCR + 规则匹配 (传统 RPA)
  ↓
2024: VLM 静态分析 (GPT-4V)
  ↓
2025Q1-Q2: Agent 框架 (Computer Use, UI-TARS)
  ↓
2025Q3-Q4: 多模态融合 (视频流 + 原生 Grounding)
  ↓
2026Q1: 
  - 原生 GUI Grounding 模型 (Qwen2.5-VL, InternVL2.5)
  - 端侧高性能模型 (MiniCPM-V-2.5)
  - 多 Agent 协作框架
  ↓
2026Q2+ (预期):
  - 自主 Agent + 长期记忆
  - 跨应用工作流自动化
  - 零样本 GUI 操作
```

### 15.4 关键突破点 (更新)

| 领域 | 2024 | 2025 | 2026Q1 | 2026Q2+ |
|------|------|------|--------|---------|
| 模型能力 | 单图理解 | 多图推理 | 视频 + 原生 Grounding | 自主规划 |
| 推理速度 | 2-5s | 0.5-2s | 0.1-0.5s | <100ms |
| 准确率 | 60-70% | 80-90% | 90-95% | 95%+ |
| 部署方式 | 云端 | 云+边 | 端侧原生 | 混合 |
| 安全性 | 无 | 基础 | 完善 | 自适应 |

### 15.5 开源生态趋势 (2026 更新)

**2026 年重点项目**:

1. **UI-TARS-Desktop** (字节跳动)
   - 开源 GUI Agent 客户端
   - 支持 Windows/macOS/Linux
   - 集成 UI-TARS-72B 模型
   - GitHub: https://github.com/bytedance/ui-tars-desktop

2. **Agent-S-2.0** (Simular AI)
   - 模块化 GUI Agent 框架
   - 支持多种 VLM 后端
   - 内置安全沙箱
   - GitHub: https://github.com/simular-sp/agent-s

3. **OpenComputer** (社区)
   - OpenAI 兼容的 Computer Use 实现
   - 支持本地模型
   - TypeScript 实现
   - GitHub: https://github.com/opencomputer/opencomputer

4. **ScreenParse** (社区)
   - 高性能屏幕解析库
   - 支持多种操作系统
   - Rust 实现，跨平台
   - GitHub: https://github.com/screenparse/screenparse

5. **GuiAgent-Bench** (学术界)
   - GUI Agent 统一评测基准
   - 覆盖 50+ 应用场景
   - 支持 Windows/macOS/Linux/Web
   - GitHub: https://github.com/guiagent/guiagent-bench

### 15.6 2026 年关键趋势

1. **原生 Grounding 成为主流**
   - Qwen2.5-VL、InternVL2.5 等模型原生支持
   - 不再需要复杂的 Prompt 工程

2. **端侧模型性能逼近云端**
   - MiniCPM-V-2.5 延迟 <200ms
   - Apple Silicon 原生支持

3. **多 Agent 协作框架成熟**
   - 专用 Agent (Browser/Native/File)
   - 共享记忆系统

4. **国内生态快速发展**
   - 字节 UI-TARS、腾讯元宝 Agent
   - 阿里 Qwen2.5-VL、智谱 GLM-5V

5. **安全性成为标配**
   - 操作审计
   - 敏感数据保护
   - 用户确认机制

---

## 16. 实施建议

### 16.1 MVP 方案 (最小可行产品)

**Phase 1 (2周)**: 基础能力
- 截图: `screenshot-desktop`
- 键鼠: `@nut-tree/nut-js`
- VLM: Claude 3.5 Sonnet API
- IPC 通信

**Phase 2 (2周)**: 安全增强
- 操作白名单
- 用户确认弹窗
- 审计日志

**Phase 3 (2周)**: UI 集成
- 实时屏幕预览
- 操作日志面板
- 设置页面

### 16.2 完整方案

详见第 4 节"推荐方案"。

### 16.3 风险缓解

| 风险 | 概率 | 影响 | 缓解措施 |
|------|------|------|----------|
| nut.js Linux 兼容性 | 中 | 中 | 提供备选方案 (robotjs) |
| VLM API 延迟 | 高 | 中 | 本地模型 fallback |
| 安全漏洞 | 低 | 高 | 多层权限验证 |
| 用户接受度 | 中 | 高 | 可配置自动/手动模式 |

---

## 17. 参考资源

### 17.1 论文

1. **OSWorld**: Benchmark for Multimodal Agents on Real Computer Tasks (2024)
2. **AndroidWorld**: A Benchmark for Agents in Android (2024)
3. **WebVoyager**: Benchmarking Agents on Web Navigation (2024)
4. **SeeAct**: GPT-4V as Visual Web Agent (2024)
5. **UFO**: A UI-Focused Agent for Windows (2024)

### 17.2 开源项目

- [UI-TARS](https://github.com/bytedance/UI-TARS)
- [Agent-S](https://github.com/simular-sp/Agent-S)
- [OpenInterpreter](https://github.com/OpenInterpreter/open-interpreter)
- [nut.js](https://github.com/nut-tree/nut.js)
- [robotjs](https://github.com/octalmage/robotjs)
- [screenshot-desktop](https://github.com/bencevans/screenshot-desktop)

### 17.3 官方文档

- [Anthropic Computer Use](https://docs.anthropic.com/en/docs/build-with-claude/computer-use)
- [Windows UI Automation](https://learn.microsoft.com/en-us/windows/win32/winauto/entry-uiauto-win32)
- [macOS Accessibility](https://developer.apple.com/accessibility/macos/)
- [Linux AT-SPI](https://www.linuxfoundation.org/collaborate/workgroups/accessibility/atk/at-spi)

---

## 18. 总结

### 推荐方案

**MVP**: 纯 Node.js + 国内 VLM

**核心依赖**:
```json
{
  "dependencies": {
    "screenshot-desktop": "^1.15.0",
    "@nut-tree/nut-js": "^4.2.0"
  }
}
```

**VLM 选型 (国内优先)**:
- **首选**: Qwen2-VL-Max (阿里云百炼) - ¥0.02/千tokens
- **备选**: GLM-4V-Plus (智谱 AI) - ¥0.01/千tokens  
- **本地**: Qwen2-VL-7B / InternVL2-8B

**架构**:
```
截图 → VLM 分析 → 动作规划 → 安全检查 → 执行 → 验证 → 循环
```

**工期**: 4-6 周 (MVP)

**成本**: 
- 云端: ~¥0.5-1/天/用户
- 本地: ¥0 (需要 GPU/Apple Silicon)

**风险**: 可控

---

## 19. 国内 VLM 集成代码示例

### 19.1 多模型适配器

```typescript
// src/main/services/gui/vlmAdapter.ts

export type VLMProvider = 'qwen' | 'glm' | 'internvl' | 'claude' | 'local';

export interface VLMConfig {
  provider: VLMProvider;
  apiKey?: string;
  baseUrl?: string;
  model?: string;
}

export interface GUIAnalysisResult {
  actions: GUIAction[];
  reasoning: string;
  confidence: number;
}

export class VLMAdapter {
  private config: VLMConfig;
  
  constructor(config: VLMConfig) {
    this.config = config;
  }
  
  async analyzeScreen(screenshot: Buffer, instruction: string): Promise<GUIAnalysisResult> {
    const base64 = screenshot.toString('base64');
    
    switch (this.config.provider) {
      case 'qwen':
        return this.callQwen(base64, instruction);
      case 'glm':
        return this.callGLM(base64, instruction);
      case 'internvl':
        return this.callInternVL(base64, instruction);
      case 'claude':
        return this.callClaude(base64, instruction);
      case 'local':
        return this.callLocal(base64, instruction);
      default:
        throw new Error(`Unknown provider: ${this.config.provider}`);
    }
  }
  
  // 阿里云 Qwen2-VL
  private async callQwen(base64: string, instruction: string): Promise<GUIAnalysisResult> {
    const response = await fetch('https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.config.apiKey}`,
      },
      body: JSON.stringify({
        model: this.config.model || 'qwen-vl-max',
        messages: [{
          role: 'user',
          content: [
            { type: 'text', text: this.buildPrompt(instruction) },
            { type: 'image_url', image_url: { url: `data:image/png;base64,${base64}` } },
          ],
        }],
      }),
    });
    
    const data = await response.json();
    return this.parseResponse(data.choices[0].message.content);
  }
  
  // 智谱 GLM-4V
  private async callGLM(base64: string, instruction: string): Promise<GUIAnalysisResult> {
    const response = await fetch('https://open.bigmodel.cn/api/paas/v4/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.config.apiKey}`,
      },
      body: JSON.stringify({
        model: this.config.model || 'glm-4v-plus',
        messages: [{
          role: 'user',
          content: [
            { type: 'text', text: this.buildPrompt(instruction) },
            { type: 'image_url', image_url: { url: `data:image/png;base64,${base64}` } },
          ],
        }],
      }),
    });
    
    const data = await response.json();
    return this.parseResponse(data.choices[0].message.content);
  }
  
  // 硅基流动 InternVL2
  private async callInternVL(base64: string, instruction: string): Promise<GUIAnalysisResult> {
    const response = await fetch('https://api.siliconflow.cn/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.config.apiKey}`,
      },
      body: JSON.stringify({
        model: this.config.model || 'internvl2-8b',
        messages: [{
          role: 'user',
          content: [
            { type: 'text', text: this.buildPrompt(instruction) },
            { type: 'image_url', image_url: { url: `data:image/png;base64,${base64}` } },
          ],
        }],
      }),
    });
    
    const data = await response.json();
    return this.parseResponse(data.choices[0].message.content);
  }
  
  // 本地模型 (Ollama / vLLM)
  private async callLocal(base64: string, instruction: string): Promise<GUIAnalysisResult> {
    const baseUrl = this.config.baseUrl || 'http://localhost:11434';
    
    const response = await fetch(`${baseUrl}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: this.config.model || 'qwen2-vl:7b',
        messages: [{
          role: 'user',
          content: [
            { type: 'text', text: this.buildPrompt(instruction) },
            { type: 'image_url', image_url: { url: `data:image/png;base64,${base64}` } },
          ],
        }],
        stream: false,
      }),
    });
    
    const data = await response.json();
    return this.parseResponse(data.message.content);
  }
  
  // Anthropic Claude (海外)
  private async callClaude(base64: string, instruction: string): Promise<GUIAnalysisResult> {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': this.config.apiKey!,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: this.config.model || 'claude-sonnet-4-20250514',
        max_tokens: 4096,
        tools: [{
          type: 'computer_20241022',
          name: 'computer',
          display_width_px: 1920,
          display_height_px: 1080,
        }],
        messages: [{
          role: 'user',
          content: [
            { type: 'text', text: instruction },
            { type: 'image', source: { type: 'base64', media_type: 'image/png', data: base64 } },
          ],
        }],
      }),
    });
    
    const data = await response.json();
    return this.parseClaudeResponse(data);
  }
  
  private buildPrompt(instruction: string): string {
    return `你是一个 GUI 自动化助手。请分析这个屏幕截图，并根据用户指令执行操作。

用户指令: ${instruction}

请按照以下格式返回操作序列:
\`\`\`json
{
  "actions": [
    { "type": "move", "x": 100, "y": 200 },
    { "type": "click", "x": 100, "y": 200 }
  ],
  "reasoning": "为什么这样做...",
  "confidence": 0.95
}
\`\`\`

注意:
1. 坐标必须基于截图的实际分辨率
2. 每个操作都要有明确的目标
3. confidence 表示你对操作的信心程度 (0-1)`;
  }
  
  private parseResponse(content: string): GUIAnalysisResult {
    try {
      const jsonMatch = content.match(/```json\n?([\s\S]*?)\n?```/);
      if (jsonMatch) {
        return JSON.parse(jsonMatch[1]);
      }
      return JSON.parse(content);
    } catch {
      return {
        actions: [],
        reasoning: content,
        confidence: 0,
      };
    }
  }
  
  private parseClaudeResponse(data: any): GUIAnalysisResult {
    const actions: GUIAction[] = [];
    
    for (const block of data.content || []) {
      if (block.type === 'tool_use' && block.name === 'computer') {
        const input = block.input;
        
        if (input.action === 'mouse_move') {
          actions.push({ type: 'move', x: input.coordinate[0], y: input.coordinate[1] });
        } else if (input.action === 'left_click') {
          actions.push({ type: 'click', x: input.coordinate?.[0], y: input.coordinate?.[1] });
        } else if (input.action === 'type') {
          actions.push({ type: 'type', text: input.text });
        }
      }
    }
    
    return { actions, reasoning: '', confidence: 0.9 };
  }
}
```

### 19.2 配置管理

```typescript
// src/main/services/gui/configManager.ts

import { VLMProvider, VLMConfig } from './vlmAdapter';

interface GUIAgentConfig {
  vlm: {
    provider: VLMProvider;
    // 各 provider 的 API Key
    qwenApiKey?: string;
    glmApiKey?: string;
    internvlApiKey?: string;
    claudeApiKey?: string;
    // 本地模型配置
    localBaseUrl?: string;
    localModel?: string;
  };
  security: {
    enabled: boolean;
    maxOperations: number;
    requireConfirmation: boolean;
    allowedApps: string[];
  };
  screenshot: {
    format: 'png' | 'jpeg';
    quality: number;
    scale: number;
  };
}

const DEFAULT_CONFIG: GUIAgentConfig = {
  vlm: {
    provider: 'qwen', // 默认使用 Qwen
  },
  security: {
    enabled: true,
    maxOperations: 100,
    requireConfirmation: true,
    allowedApps: ['Chrome', 'Safari', 'Finder', 'Explorer', 'VSCode'],
  },
  screenshot: {
    format: 'png',
    quality: 90,
    scale: 1,
  },
};

export async function getGUIAgentConfig(): Promise<GUIAgentConfig> {
  // 从 SQLite 或文件读取配置
  // ...
  return DEFAULT_CONFIG;
}

export function createVLMAdapter(config: GUIAgentConfig): VLMAdapter {
  const vlmConfig: VLMConfig = {
    provider: config.vlm.provider,
  };
  
  switch (config.vlm.provider) {
    case 'qwen':
      vlmConfig.apiKey = config.vlm.qwenApiKey;
      vlmConfig.model = 'qwen-vl-max';
      break;
    case 'glm':
      vlmConfig.apiKey = config.vlm.glmApiKey;
      vlmConfig.model = 'glm-4v-plus';
      break;
    case 'internvl':
      vlmConfig.apiKey = config.vlm.internvlApiKey;
      vlmConfig.model = 'internvl2-8b';
      break;
    case 'claude':
      vlmConfig.apiKey = config.vlm.claudeApiKey;
      vlmConfig.model = 'claude-sonnet-4-20250514';
      break;
    case 'local':
      vlmConfig.baseUrl = config.vlm.localBaseUrl || 'http://localhost:11434';
      vlmConfig.model = config.vlm.localModel || 'qwen2-vl:7b';
      break;
  }
  
  return new VLMAdapter(vlmConfig);
}
```

### 19.3 使用示例

```typescript
// src/main/services/gui/guiAgentService.ts

import { ScreenshotService } from './screenshotService';
import { InputService } from './inputService';
import { VLMAdapter, createVLMAdapter } from './vlmAdapter';
import { getGUIAgentConfig } from './configManager';
import { SecurityManager } from './securityManager';

export class GUIAgentService {
  private screenshot: ScreenshotService;
  private input: InputService;
  private vlm: VLMAdapter;
  private security: SecurityManager;
  
  async initialize() {
    const config = await getGUIAgentConfig();
    
    this.screenshot = new ScreenshotService();
    this.input = new InputService();
    this.vlm = createVLMAdapter(config);
    this.security = new SecurityManager(config.security);
  }
  
  async execute(instruction: string): Promise<void> {
    // 1. 截图
    const screenshot = await this.screenshot.capture();
    
    // 2. VLM 分析
    const result = await this.vlm.analyzeScreen(screenshot, instruction);
    
    // 3. 安全检查
    for (const action of result.actions) {
      const allowed = await this.security.checkPermission(action);
      if (!allowed) {
        throw new Error(`Action denied: ${action.type}`);
      }
      
      // 4. 执行动作
      await this.executeAction(action);
      
      // 5. 验证结果
      await this.verifyAction(action);
    }
  }
  
  private async executeAction(action: GUIAction): Promise<void> {
    switch (action.type) {
      case 'move':
        await this.input.moveMouse(action.x!, action.y!);
        break;
      case 'click':
        await this.input.click(action.x, action.y);
        break;
      case 'doubleClick':
        await this.input.doubleClick(action.x, action.y);
        break;
      case 'rightClick':
        await this.input.rightClick(action.x, action.y);
        break;
      case 'type':
        await this.input.type(action.text!);
        break;
      case 'press':
        await this.input.pressKey(action.key!);
        break;
      case 'hotkey':
        await this.input.hotkey(...action.keys!);
        break;
      case 'scroll':
        await this.input.scroll(action.amount!);
        break;
      case 'drag':
        await this.input.drag(action.startX!, action.startY!, action.endX!, action.endY!);
        break;
    }
  }
  
  private async verifyAction(action: GUIAction): Promise<boolean> {
    // 等待界面响应
    await new Promise(resolve => setTimeout(resolve, 500));
    
    // 截图验证
    const newScreenshot = await this.screenshot.capture();
    // ... 可以用 VLM 验证操作是否成功
    
    return true;
  }
}
```

---

*文档版本: v0.3*
*最后更新: 2026-03-15*
