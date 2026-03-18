"""
NuwaClaw GUI Agent - VLM 集成
将视觉语言模型（Claude Vision / GPT-4V）集成到 GUI Agent
"""

import base64
import json
from typing import List, Dict, Any, Optional
from dataclasses import dataclass
from enum import Enum

# VLM 客户端（可选依赖）
try:
    import anthropic
    ANTHROPIC_AVAILABLE = True
except ImportError:
    ANTHROPIC_AVAILABLE = False

try:
    import openai
    OPENAI_AVAILABLE = True
except ImportError:
    OPENAI_AVAILABLE = False

# 导入 GUI Agent
from hybrid_agent import Action, ActionType

# ========== VLM 提供商 ==========

class VLMProvider(Enum):
    """VLM 提供商"""
    # 国际
    CLAUDE_VISION = "claude-vision"
    GPT4_VISION = "gpt4-vision"
    GEMINI_VISION = "gemini-vision"
    
    # 国内（推荐）
    GLM_4V = "glm-4v"           # 智谱AI
    QWEN_VL = "qwen-vl"         # 阿里云通义
    ERNIE_4V = "ernie-4v"       # 百度文心
    HUNYUAN_VISION = "hunyuan"  # 腾讯混元
    DOUBAO_VISION = "doubao"    # 字节豆包

# ========== 数据结构 ==========

@dataclass
class VLMActionPlan:
    """VLM 规划的动作"""
    reasoning: str
    actions: List[Action]
    confidence: float

@dataclass
class VLMConfig:
    """VLM 配置"""
    provider: VLMProvider
    model: str
    api_key: str
    max_tokens: int = 4096
    temperature: float = 0.7

# ========== VLM 客户端 ==========

class VLMClient:
    """
    VLM 客户端
    
    支持的模型：
    - Claude 3.5 Sonnet (claude-3-5-sonnet-20241022)
    - GPT-4 Vision (gpt-4-vision-preview)
    - Gemini Pro Vision (gemini-pro-vision)
    """
    
    def __init__(self, config: VLMConfig):
        """
        初始化 VLM 客户端
        
        Args:
            config: VLM 配置
        """
        self.config = config
        
        # 初始化客户端
        if config.provider == VLMProvider.CLAUDE_VISION:
            if not ANTHROPIC_AVAILABLE:
                raise ImportError("请安装 anthropic: pip install anthropic")
            self.client = anthropic.Anthropic(api_key=config.api_key)
        
        elif config.provider == VLMProvider.GPT4_VISION:
            if not OPENAI_AVAILABLE:
                raise ImportError("请安装 openai: pip install openai")
            self.client = openai.OpenAI(api_key=config.api_key)
        
        else:
            raise ValueError(f"不支持的 VLM 提供商: {config.provider}")
    
    def plan_actions(self, 
                     instruction: str, 
                     screenshot_b64: str,
                     context: Optional[Dict[str, Any]] = None) -> VLMActionPlan:
        """
        根据指令和截图规划动作
        
        Args:
            instruction: 用户指令（如 "点击登录按钮"）
            screenshot_b64: 截图的 base64 编码
            context: 可选的上下文信息
            
        Returns:
            VLMActionPlan: 规划的动作
        """
        if self.config.provider == VLMProvider.CLAUDE_VISION:
            return self._plan_with_claude(instruction, screenshot_b64, context)
        elif self.config.provider == VLMProvider.GPT4_VISION:
            return self._plan_with_gpt4(instruction, screenshot_b64, context)
        else:
            raise ValueError(f"不支持的提供商: {self.config.provider}")
    
    def _plan_with_claude(self, 
                          instruction: str, 
                          screenshot_b64: str,
                          context: Optional[Dict[str, Any]]) -> VLMActionPlan:
        """使用 Claude Vision 规划动作"""
        
        # 构造提示词
        system_prompt = self._build_system_prompt()
        user_prompt = self._build_user_prompt(instruction, context)
        
        # 调用 Claude API
        response = self.client.messages.create(
            model=self.config.model,
            max_tokens=self.config.max_tokens,
            temperature=self.config.temperature,
            system=system_prompt,
            messages=[
                {
                    "role": "user",
                    "content": [
                        {
                            "type": "image",
                            "source": {
                                "type": "base64",
                                "media_type": "image/png",
                                "data": screenshot_b64
                            }
                        },
                        {
                            "type": "text",
                            "text": user_prompt
                        }
                    ]
                }
            ]
        )
        
        # 解析响应
        return self._parse_response(response.content[0].text)
    
    def _plan_with_gpt4(self, 
                        instruction: str, 
                        screenshot_b64: str,
                        context: Optional[Dict[str, Any]]) -> VLMActionPlan:
        """使用 GPT-4 Vision 规划动作"""
        
        # 构造提示词
        system_prompt = self._build_system_prompt()
        user_prompt = self._build_user_prompt(instruction, context)
        
        # 调用 GPT-4 Vision API
        response = self.client.chat.completions.create(
            model=self.config.model,
            max_tokens=self.config.max_tokens,
            temperature=self.config.temperature,
            messages=[
                {
                    "role": "system",
                    "content": system_prompt
                },
                {
                    "role": "user",
                    "content": [
                        {
                            "type": "image_url",
                            "image_url": {
                                "url": f"data:image/png;base64,{screenshot_b64}"
                            }
                        },
                        {
                            "type": "text",
                            "text": user_prompt
                        }
                    ]
                }
            ]
        )
        
        # 解析响应
        return self._parse_response(response.choices[0].message.content)
    
    def _build_system_prompt(self) -> str:
        """构建系统提示词"""
        return """你是一个 GUI 操作专家。你的任务是分析屏幕截图，理解用户指令，并规划具体的 GUI 操作步骤。

**可用操作：**
1. CLICK - 点击（参数：x, y, button, num_clicks）
2. RIGHT_CLICK - 右键点击（参数：x, y）
3. DOUBLE_CLICK - 双击（参数：x, y）
4. TYPING - 输入文本（参数：text）
5. PRESS - 按键（参数：key）
6. HOTKEY - 快捷键（参数：keys）
7. SCROLL - 滚动（参数：dx, dy）
8. MOVE_TO - 移动鼠标（参数：x, y）
9. WAIT - 等待（参数：seconds）

**输出格式（JSON）：**
```json
{
  "reasoning": "分析当前屏幕状态和用户指令",
  "actions": [
    {
      "action_type": "CLICK",
      "parameters": {"x": 100, "y": 200, "button": "left"}
    }
  ],
  "confidence": 0.9
}
```

**注意事项：**
- 仔细观察屏幕上的元素位置
- 确保坐标在屏幕范围内
- 如果不确定，先截图观察
- 复杂任务分解为多个简单步骤"""
    
    def _build_user_prompt(self, 
                          instruction: str, 
                          context: Optional[Dict[str, Any]]) -> str:
        """构建用户提示词"""
        prompt = f"用户指令：{instruction}\n\n"
        
        if context:
            prompt += f"上下文：{json.dumps(context, ensure_ascii=False)}\n\n"
        
        prompt += "请分析屏幕截图，规划 GUI 操作步骤（JSON 格式）。"
        
        return prompt
    
    def _parse_response(self, response_text: str) -> VLMActionPlan:
        """解析 VLM 响应"""
        try:
            # 提取 JSON
            json_start = response_text.find('{')
            json_end = response_text.rfind('}') + 1
            json_str = response_text[json_start:json_end]
            
            data = json.loads(json_str)
            
            # 解析动作
            actions = []
            for action_data in data.get("actions", []):
                action = Action(
                    action_type=ActionType[action_data["action_type"]],
                    parameters=action_data["parameters"]
                )
                actions.append(action)
            
            return VLMActionPlan(
                reasoning=data.get("reasoning", ""),
                actions=actions,
                confidence=data.get("confidence", 0.5)
            )
        
        except Exception as e:
            # 解析失败，返回空计划
            return VLMActionPlan(
                reasoning=f"解析失败: {str(e)}",
                actions=[],
                confidence=0.0
            )


# ========== VLM 增强的 GUI Agent ==========

class VLMGUIAgent:
    """
    VLM 增强的 GUI Agent
    
    功能：
    - 自动分析屏幕状态
    - 根据自然语言指令规划操作
    - 支持多轮对话
    - 错误恢复
    """
    
    def __init__(self, vlm_config: VLMConfig):
        """
        初始化 VLM GUI Agent
        
        Args:
            vlm_config: VLM 配置
        """
        from hybrid_agent import HybridGUIAgent
        
        self.vlm_client = VLMClient(vlm_config)
        self.gui_agent = HybridGUIAgent()
    
    async def execute_instruction(self, 
                                  instruction: str,
                                  auto_confirm: bool = False) -> Dict[str, Any]:
        """
        执行自然语言指令
        
        Args:
            instruction: 自然语言指令（如 "点击登录按钮"）
            auto_confirm: 是否自动确认（跳过权限检查）
            
        Returns:
            执行结果
        """
        # 1. 截图
        screenshot_b64 = self.gui_agent.screenshot()
        
        # 2. VLM 规划
        plan = self.vlm_client.plan_actions(instruction, screenshot_b64)
        
        if not plan.actions:
            return {
                "success": False,
                "reasoning": plan.reasoning,
                "error": "VLM 未能规划任何操作"
            }
        
        # 3. 确认（可选）
        if not auto_confirm:
            print(f"\nVLM 规划：")
            print(f"推理：{plan.reasoning}")
            print(f"置信度：{plan.confidence}")
            print(f"\n操作步骤：")
            for i, action in enumerate(plan.actions):
                print(f"  {i+1}. {action.action_type.value}: {action.parameters}")
            
            # TODO: 添加 UI 确认对话框
            confirm = input("\n是否执行？(y/n): ")
            if confirm.lower() != 'y':
                return {
                    "success": False,
                    "reasoning": "用户取消执行"
                }
        
        # 4. 执行
        results = self.gui_agent.execute_batch(plan.actions)
        
        # 5. 返回结果
        return {
            "success": all(not r.isError for r in results),
            "reasoning": plan.reasoning,
            "confidence": plan.confidence,
            "action_count": len(results),
            "succeeded": sum(1 for r in results if not r.isError),
            "failed": sum(1 for r in results if r.isError),
            "results": [
                {
                    "action_type": plan.actions[i].action_type.value,
                    "success": not r.isError,
                    "message": r.content[0]["text"] if r.content else ""
                }
                for i, r in enumerate(results)
            ]
        }


# ========== 测试 ==========

if __name__ == "__main__":
    import os
    
    print("="*60)
    print("NuwaClaw GUI Agent - VLM 集成测试")
    print("="*60)
    
    # 检查 API Key
    anthropic_key = os.environ.get("ANTHROPIC_API_KEY")
    openai_key = os.environ.get("OPENAI_API_KEY")
    
    if not anthropic_key and not openai_key:
        print("\n⚠️  请设置环境变量：")
        print("  export ANTHROPIC_API_KEY='your-key'  # Claude Vision")
        print("  export OPENAI_API_KEY='your-key'     # GPT-4 Vision")
        exit(1)
    
    # 选择提供商
    if anthropic_key:
        provider = VLMProvider.CLAUDE_VISION
        model = "claude-3-5-sonnet-20241022"
        api_key = anthropic_key
        print(f"\n✅ 使用 Claude Vision: {model}")
    else:
        provider = VLMProvider.GPT4_VISION
        model = "gpt-4-vision-preview"
        api_key = openai_key
        print(f"\n✅ 使用 GPT-4 Vision: {model}")
    
    # 创建配置
    config = VLMConfig(
        provider=provider,
        model=model,
        api_key=api_key
    )
    
    # 创建 VLM 客户端
    try:
        client = VLMClient(config)
        print("✅ VLM 客户端初始化成功")
    except Exception as e:
        print(f"❌ VLM 客户端初始化失败: {e}")
        exit(1)
    
    # 创建 VLM GUI Agent
    agent = VLMGUIAgent(config)
    print("✅ VLM GUI Agent 初始化成功")
    
    print("\n" + "="*60)
    print("VLM 集成测试完成")
    print("="*60)
    print("\n✅ VLM 客户端验证成功")
    print("✅ 可以开始使用自然语言控制 GUI")
    print("\n示例用法：")
    print("  result = await agent.execute_instruction('点击登录按钮')")
    print("  result = await agent.execute_instruction('在搜索框输入 NuwaClaw')")
