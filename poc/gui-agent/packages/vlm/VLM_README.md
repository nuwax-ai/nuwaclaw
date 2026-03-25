# NuwaClaw GUI Agent - VLM 集成文档

> Phase 2 任务 2：VLM 集成

## 支持的 VLM 模型

### 国际模型

| 模型 | 提供商 | 价格 (Input) | 特点 | 推荐度 |
|------|--------|-------------|------|--------|
| **Claude 3.5 Sonnet** | Anthropic | $3/1M | 高性价比，视觉理解强 | ⭐⭐⭐⭐⭐ |
| GPT-4 Vision | OpenAI | $10/1M | 成熟稳定 | ⭐⭐⭐⭐ |
| Gemini Pro Vision | Google | 免费 | 免费额度 | ⭐⭐⭐ |

### 国内模型（推荐）

| 模型 | 提供商 | 价格 | 特点 | 推荐度 |
|------|--------|------|------|--------|
| **GLM-4V** | 智谱AI | ¥0.01/千tokens | 国内首选，中文优化 | ⭐⭐⭐⭐⭐ |
| **Qwen-VL-Max** | 阿里云 | ¥0.02/千tokens | 开源生态好 | ⭐⭐⭐⭐⭐ |
| **文心 ERNIE 4.0** | 百度 | ¥0.12/千tokens | 中文场景强 | ⭐⭐⭐⭐ |
| **混元 Vision** | 腾讯 | ¥0.018/千tokens | 多模态强 | ⭐⭐⭐⭐ |
| **豆包 Vision** | 字节跳动 | ¥0.005/千tokens | 便宜，性能不错 | ⭐⭐⭐⭐ |
| **MiniMax** | MiniMax | ¥0.015/千tokens | 上下文长 | ⭐⭐⭐ |

## 推荐选择

**国内用户：GLM-4V 或 Qwen-VL-Max**
- ✅ 国内网络稳定访问
- ✅ 中文理解更好
- ✅ 价格更便宜
- ✅ 合规性强

**国际用户：Claude 3.5 Sonnet**
- ✅ 性价比高
- ✅ 视觉理解强
- ✅ 支持 200K 上下文

## 安装

### 1. 安装依赖

```bash
cd /Users/apple/workspace/nuwax-agent/crates/nuwax-agent-gui-alt/poc/osworld-gui-agent
source venv/bin/activate

# 国内模型（推荐）
pip install zhipuai        # GLM-4V (智谱AI)
pip install dashscope      # Qwen-VL (阿里云)

# 国际模型
pip install anthropic      # Claude Vision
pip install openai         # GPT-4 Vision
```

### 2. 配置 API Key

```bash
# 国内模型（推荐）
export ZHIPU_API_KEY='your-zhipu-api-key'        # GLM-4V
export DASHSCOPE_API_KEY='your-dashscope-key'    # Qwen-VL

# 国际模型
export ANTHROPIC_API_KEY='your-anthropic-key'    # Claude Vision
export OPENAI_API_KEY='your-openai-key'          # GPT-4 Vision
```

### 3. 获取 API Key

**国内模型：**
- **GLM-4V**: https://open.bigmodel.cn/
- **Qwen-VL**: https://dashscope.console.aliyun.com/

**国际模型：**
- **Claude Vision**: https://console.anthropic.com/
- **GPT-4 Vision**: https://platform.openai.com/

## 使用方法

### 基础用法（GLM-4V）

```python
from vlm_integration import VLMGUIAgent, VLMConfig, VLMProvider

# 创建配置（使用 GLM-4V）
config = VLMConfig(
    provider=VLMProvider.GLM_4V,
    model="glm-4v",
    api_key="your-zhipu-api-key"
)

# 创建 VLM GUI Agent
agent = VLMGUIAgent(config)

# 执行自然语言指令
result = await agent.execute_instruction("点击登录按钮")
```

### 基础用法（Qwen-VL）

```python
# 创建配置（使用 Qwen-VL）
config = VLMConfig(
    provider=VLMProvider.QWEN_VL,
    model="qwen-vl-max",
    api_key="your-dashscope-key"
)

# 创建 VLM GUI Agent
agent = VLMGUIAgent(config)

# 执行自然语言指令
result = await agent.execute_instruction("在搜索框输入 NuwaClaw")
```

### 示例：自动化登录

```python
# 1. 打开登录页面
await agent.execute_instruction("点击浏览器图标")

# 2. 输入用户名
await agent.execute_instruction("在用户名输入框输入 'admin'")

# 3. 输入密码
await agent.execute_instruction("在密码输入框输入 'password123'")

# 4. 点击登录
await agent.execute_instruction("点击登录按钮")
```

### 示例：批量操作

```python
# VLM 自动规划多步操作
result = await agent.execute_instruction(
    "搜索 'NuwaClaw' 并点击第一个结果"
)

# 输出：
# 推理：当前在主页，需要先定位搜索框，输入关键词，然后点击搜索按钮，最后点击第一个结果
# 操作步骤：
#   1. CLICK: {"x": 500, "y": 100}  # 点击搜索框
#   2. TYPING: {"text": "NuwaClaw"}  # 输入关键词
#   3. PRESS: {"key": "enter"}       # 按回车
#   4. CLICK: {"x": 300, "y": 400}   # 点击第一个结果
```

## 集成到 MCP Server

### 1. 添加 VLM 工具

在 `mcp_server.py` 中添加：

```python
async def gui_vlm_execute(self, instruction: str, auto_confirm: bool = False):
    """
    使用 VLM 执行自然语言指令
    
    Args:
        instruction: 自然语言指令
        auto_confirm: 是否自动确认
        
    Returns:
        执行结果
    """
    result = await self.vlm_agent.execute_instruction(instruction, auto_confirm)
    return result
```

### 2. 注册工具

```python
Tool(
    name="gui_vlm_execute",
    description="使用 VLM 执行自然语言 GUI 操作",
    inputSchema={
        "type": "object",
        "properties": {
            "instruction": {"type": "string"},
            "auto_confirm": {"type": "boolean", "default": False}
        },
        "required": ["instruction"]
    }
)
```

### 3. 使用示例

```typescript
// 主 Agent 调用
const result = await guiAgent.callTool('gui_vlm_execute', {
  instruction: "点击设置按钮，然后选择 '隐私' 选项",
  auto_confirm: false
});
```

## 提示词工程

### 系统提示词结构

```
1. 角色定义：GUI 操作专家
2. 可用操作：16 种 OSWorld 操作
3. 输出格式：JSON
4. 注意事项：
   - 观察屏幕元素
   - 确保坐标在范围内
   - 复杂任务分解
```

### 用户提示词结构

```
1. 用户指令
2. 上下文信息（可选）
3. 输出要求（JSON 格式）
```

### 优化技巧

1. **提供上下文**
```python
result = await agent.execute_instruction(
    "点击提交按钮",
    context={
        "current_app": "Chrome",
        "page": "登录页面",
        "screen_resolution": "1920x1080"
    }
)
```

2. **分步执行**
```python
# 不推荐：一次性执行复杂任务
await agent.execute_instruction("登录并发送邮件")

# 推荐：分步执行
await agent.execute_instruction("点击登录按钮")
await agent.execute_instruction("输入用户名")
await agent.execute_instruction("点击提交")
```

3. **错误恢复**
```python
result = await agent.execute_instruction("点击按钮")

if not result["success"]:
    # 重新截图并重试
    await agent.execute_instruction("重新定位并点击按钮")
```

## 性能优化

### 1. 缓存策略

```python
# 缓存屏幕状态，避免重复截图
class CachedVLMGUIAgent(VLMGUIAgent):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self.cached_screenshot = None
        self.cache_time = 0
    
    async def execute_instruction(self, instruction: str):
        # 如果缓存未过期（5 秒内），使用缓存
        if time.time() - self.cache_time < 5:
            screenshot = self.cached_screenshot
        else:
            screenshot = self.gui_agent.screenshot()
            self.cached_screenshot = screenshot
            self.cache_time = time.time()
        
        # 使用缓存截图
        plan = self.vlm_client.plan_actions(instruction, screenshot)
        # ...
```

### 2. 批量操作

```python
# VLM 一次规划多个操作
result = await agent.execute_instruction(
    "填写表单：姓名张三，邮箱 test@example.com，提交"
)

# VLM 会自动规划：
# 1. 点击姓名输入框
# 2. 输入 "张三"
# 3. 点击邮箱输入框
# 4. 输入 "test@example.com"
# 5. 点击提交按钮
```

## 成本控制

### 价格对比

| 模型 | Input | Output | Vision |
|------|-------|--------|--------|
| Claude 3.5 Sonnet | $3/1M | $15/1M | 包含 |
| GPT-4 Vision | $10/1M | $30/1M | 包含 |
| Gemini Pro Vision | 免费 | 免费 | 包含 |

### 成本优化

1. **使用 Gemini 免费额度**
2. **批量操作减少 API 调用**
3. **缓存屏幕状态**
4. **本地模型（未来支持）**

## 错误处理

### 常见错误

1. **VLM 未规划任何操作**
   - 原因：指令不清晰或屏幕元素无法识别
   - 解决：提供更清晰的指令或上下文

2. **坐标超出屏幕范围**
   - 原因：VLM 定位错误
   - 解决：重新截图或提供屏幕尺寸

3. **操作执行失败**
   - 原因：元素位置变化或权限不足
   - 解决：重试或检查权限

## 下一步

- [ ] 支持本地 VLM 模型（LLaVA, Qwen-VL）
- [ ] 多语言支持
- [ ] 操作录制学习
- [ ] 自动化测试
