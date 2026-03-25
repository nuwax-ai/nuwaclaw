# NuwaClaw GUI Agent - OSWorld 方案

> 基于 OSWorld 标准的 GUI Agent 实现

## 与 Pi-Agent 方案对比

| 维度 | Pi-Agent 方案 | OSWorld 方案 |
|------|--------------|--------------|
| **语言** | TypeScript | Python |
| **架构** | 轻量级（300 行） | 标准化（400+ 行） |
| **核心借鉴** | Pi-Agent 事件系统 | OSWorld ACTION_SPACE |
| **底层驱动** | robotjs (Node.js) | pyautogui (Python) |
| **操作原语** | 3 个核心工具 | 16 个标准操作 |
| **Hook 系统** | ✅ 完整 | ❌ 无（可添加） |
| **事件流** | ✅ 4 级生命周期 | ❌ 无（可添加） |
| **流式进度** | ✅ onUpdate | ❌ 无（可添加） |
| **标准化** | ⭐⭐⭐ | ⭐⭐⭐⭐⭐ |
| **扩展性** | ⭐⭐⭐⭐ | ⭐⭐⭐⭐⭐ |
| **轻量级** | ⭐⭐⭐⭐⭐ | ⭐⭐⭐ |

## 快速开始

### 安装依赖

```bash
pip install -e .
```

### 运行测试

```bash
cd poc/osworld-gui-agent
python test_agent.py
```

## 核心特性

### 1. OSWorld 标准操作空间

完全遵循 OSWorld 的 16 种操作原语：

```python
from nuwaclaw_osworld_agent import OSWorldGUIAgent, Action, ActionType

agent = OSWorldGUIAgent()

# 点击
action = Action(
    action_type=ActionType.CLICK,
    parameters={"x": 100, "y": 200, "button": "left", "num_clicks": 1}
)
result = agent.execute(action)

# 输入
action = Action(
    action_type=ActionType.TYPING,
    parameters={"text": "Hello"}
)
result = agent.execute(action)

# 快捷键
action = Action(
    action_type=ActionType.HOTKEY,
    parameters={"keys": ["command", "c"]}
)
result = agent.execute(action)
```

### 2. 批量执行

```python
actions = [
    Action(action_type=ActionType.MOVE_TO, parameters={"x": 100, "y": 100}),
    Action(action_type=ActionType.CLICK, parameters={"button": "left"}),
    Action(action_type=ActionType.TYPING, parameters={"text": "Test"}),
]

results = agent.execute_batch(actions)
```

### 3. 辅助功能

```python
# 截图
screenshot_b64 = agent.screenshot()

# 定位图片
location = agent.locate_on_screen("button.png", confidence=0.9)

# 获取鼠标位置
x, y = agent.get_mouse_position()
```

## 操作列表

| 操作 | 类型 | 参数 | 说明 |
|------|------|------|------|
| MOVE_TO | 鼠标 | x, y | 移动鼠标 |
| CLICK | 鼠标 | x?, y?, button?, num_clicks? | 点击 |
| MOUSE_DOWN | 鼠标 | button? | 按下鼠标 |
| MOUSE_UP | 鼠标 | button? | 释放鼠标 |
| RIGHT_CLICK | 鼠标 | x?, y? | 右键点击 |
| DOUBLE_CLICK | 鼠标 | x?, y? | 双击 |
| DRAG_TO | 鼠标 | x, y | 拖拽 |
| SCROLL | 鼠标 | dx, dy | 滚动 |
| TYPING | 键盘 | text | 输入文本 |
| PRESS | 键盘 | key | 按键 |
| KEY_DOWN | 键盘 | key | 按下按键 |
| KEY_UP | 键盘 | key | 释放按键 |
| HOTKEY | 键盘 | *keys | 快捷键 |
| WAIT | 控制 | - | 等待 5 秒 |
| FAIL | 控制 | - | 标记失败 |
| DONE | 控制 | - | 标记完成 |

## 测试结果示例

```
============================================================
NuwaClaw GUI Agent - OSWorld 方案测试
============================================================

📝 测试 1: 截图
  截图大小: 45678 bytes (base64)
  截图尺寸: 1920x1080

📝 测试 2: 鼠标操作
  当前位置: (500, 500)
  移动到 (100, 100): True
  左键点击 (200, 200): True
  双击 (300, 300): True
  右键点击 (400, 400): True

📝 测试 3: 键盘操作
  按下 Enter: True
  快捷键 Cmd+Space: True
  输入文本: True
    数据: {'text': 'Hello, NuwaClaw!', 'length': 17}

📝 测试 4: 滚动
  向上滚动: True

📝 测试 5: 批量执行
  执行结果:
    1. True
    2. True
    3. True
    4. True

📝 测试 6: 特殊操作
  等待: True
  完成: True

📝 测试 7: 错误处理
  无效按键: False
    消息: 操作失败: 无效按键: invalid_key_123
```

## 优缺点分析

### 优点

1. **标准化**: 完全遵循 OSWorld 标准，可与生态兼容
2. **功能完整**: 16 种操作原语，覆盖所有 GUI 场景
3. **生产级**: pyautogui 经过大量生产验证
4. **跨平台**: Windows/macOS/Linux 都支持
5. **生态丰富**: Python 生态库丰富

### 缺点

1. **重量级**: 代码量更大，依赖更多
2. **缺少 Hook**: 没有 beforeToolCall/afterToolCall
3. **缺少事件流**: 没有细粒度事件系统
4. **无流式进度**: 没有实时进度更新
5. **集成复杂**: 需要桥接到 Node.js/Electron

## 改进方向

### 1. 添加 Hook 系统

```python
class OSWorldGUIAgent:
    def __init__(self, before_action=None, after_action=None):
        self.before_action = before_action
        self.after_action = after_action
    
    def execute(self, action: Action) -> ActionResult:
        # before hook
        if self.before_action:
            should_block = self.before_action(action)
            if should_block:
                return ActionResult(success=False, message="Blocked")
        
        # execute
        result = self._execute_internal(action)
        
        # after hook
        if self.after_action:
            result = self.after_action(action, result)
        
        return result
```

### 2. 添加事件流

```python
class EventType(Enum):
    AGENT_START = "agent_start"
    ACTION_START = "action_start"
    ACTION_UPDATE = "action_update"
    ACTION_END = "action_end"
    AGENT_END = "agent_end"

class OSWorldGUIAgent:
    def on_event(self, callback):
        self.event_callback = callback
    
    def emit(self, event_type, data):
        if self.event_callback:
            self.event_callback(event_type, data)
```

### 3. 桥接到 MCP

```python
# 创建 MCP Server
from mcp import Server

server = Server("nuwaclaw-gui-agent")

@server.tool("execute_action")
async def execute_action(action_type: str, parameters: dict):
    action = Action(ActionType[action_type], parameters)
    return agent.execute(action)
```

## 参考

- [OSWorld 项目](https://github.com/xlang-ai/OSWorld)
- [OSWorld ACTION_SPACE](/Users/apple/workspace/OSWorld/desktop_env/actions.py)
- [Pi-Agent 方案对比](../gui-agent-research/poc/gui-agent-poc/README.md)
