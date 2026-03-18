# NuwaClaw GUI Agent - MCP Server

> 将 GUI Agent 暴露为 MCP 工具，供主 Agent 调用

## 安装

### 1. 安装依赖

```bash
cd /Users/apple/workspace/nuwax-agent/crates/nuwax-agent-gui-alt/poc/osworld-gui-agent
source venv/bin/activate
pip install mcp
```

### 2. 配置 MCP

在 NuwaClaw 主配置中添加：

```json
{
  "mcpServers": {
    "nuwaclaw-gui-agent": {
      "command": "python",
      "args": ["/Users/apple/workspace/nuwax-agent/crates/nuwax-agent-gui-alt/poc/osworld-gui-agent/mcp_server.py"],
      "env": {}
    }
  }
}
```

## 可用工具

### 1. gui_execute

执行单个 GUI 操作

**参数:**
- `action_type`: 操作类型
  - CLICK - 点击
  - TYPING - 输入文本
  - PRESS - 按键
  - SCROLL - 滚动
  - MOVE_TO - 移动鼠标
  - RIGHT_CLICK - 右键
  - DOUBLE_CLICK - 双击
  - DRAG_TO - 拖拽
  - HOTKEY - 快捷键
  - WAIT - 等待
- `parameters`: 操作参数

**示例:**
```json
{
  "action_type": "CLICK",
  "parameters": {
    "x": 100,
    "y": 200,
    "button": "left"
  }
}
```

### 2. gui_batch

批量执行 GUI 操作

**参数:**
- `actions`: 操作列表

**示例:**
```json
{
  "actions": [
    {
      "action_type": "MOVE_TO",
      "parameters": {"x": 100, "y": 100}
    },
    {
      "action_type": "CLICK",
      "parameters": {"button": "left"}
    },
    {
      "action_type": "TYPING",
      "parameters": {"text": "Hello"}
    }
  ]
}
```

### 3. gui_screenshot

截取屏幕

**参数:**
- `region`: 可选，截图区域 {x, y, width, height}

**返回:**
- base64 编码的 PNG 图片

### 4. gui_locate

在屏幕上定位图片

**参数:**
- `image_path`: 图片路径
- `confidence`: 置信度 (0-1, 默认 0.8)

**返回:**
- x, y, width, height, confidence

### 5. gui_click_image

查找并点击图片

**参数:**
- `image_path`: 图片路径
- `confidence`: 置信度
- `button`: 鼠标按钮
- `offset_x`: x 偏移
- `offset_y`: y 偏移

## 测试

```bash
# 运行 MCP Server
python mcp_server.py

# 在另一个终端测试
# 使用 MCP CLI 或直接调用工具
```

## 集成示例

### 与 NuwaClaw 主 Agent 集成

```typescript
// 主 Agent 代码
const guiAgent = getMCPClient('nuwaclaw-gui-agent');

// 执行点击操作
await guiAgent.callTool('gui_execute', {
  action_type: 'CLICK',
  parameters: { x: 100, y: 200 }
});

// 查找并点击图片
await guiAgent.callTool('gui_click_image', {
  image_path: '/path/to/button.png',
  confidence: 0.9
});
```

### 与 VLM 集成

```python
# VLM 规划 → GUI 操作
async def vlm_plan_and_execute(instruction: str):
    # 1. 截图当前状态
    screenshot = await guiAgent.callTool('gui_screenshot', {})
    
    # 2. 发送给 VLM
    actions = await vlm.plan(instruction, screenshot)
    
    # 3. 执行操作
    result = await guiAgent.callTool('gui_batch', {
        "actions": actions
    })
    
    return result
```

## 架构

```
NuwaClaw Main Agent (ACP Engine)
         ↓ MCP Protocol
    GUI Agent MCP Server
         ↓
    HybridGUIAgent (混合方案)
         ↓
    OSWorld Actions (16 种操作)
         ↓
    pyautogui / pynput
         ↓
    macOS / Windows / Linux
```

## 权限要求

- ✅ **辅助功能**: 鼠标键盘控制
- ⚠️  **屏幕录制**: 截图功能

使用前请运行权限检查：
```bash
python check_permissions.py
```

## 下一步

- [ ] VLM 集成 (Claude Vision / GPT-4V)
- [ ] 权限 UI (Electron)
- [ ] 审计日志系统
- [ ] 操作回滚
