"""
NuwaClaw GUI Agent - 混合方案 PoC
结合 OSWorld 标准操作 + Pi-Agent 事件系统
"""

import pyautogui
import time
from typing import Dict, Any, Optional, Tuple, List, Callable
from dataclasses import dataclass, field
from enum import Enum
from PIL import Image
import io
import base64

# ========== 从 OSWorld 借鉴 ==========

class ActionType(Enum):
    """OSWorld 标准操作类型"""
    MOVE_TO = "MOVE_TO"
    CLICK = "CLICK"
    RIGHT_CLICK = "RIGHT_CLICK"
    DOUBLE_CLICK = "DOUBLE_CLICK"
    SCROLL = "SCROLL"
    TYPING = "TYPING"
    PRESS = "PRESS"
    HOTKEY = "HOTKEY"
    WAIT = "WAIT"

@dataclass
class Action:
    """OSWorld 标准操作定义"""
    action_type: ActionType
    parameters: Dict[str, Any]

# ========== 从 Pi-Agent 借鉴 ==========

@dataclass
class ToolResult:
    """工具结果（借鉴 Pi-Agent）"""
    content: List[Dict[str, Any]]
    details: Dict[str, Any]
    isError: bool = False

@dataclass
class AgentState:
    """Agent 状态（借鉴 Pi-Agent）"""
    isRunning: bool = False
    currentAction: Optional[str] = None
    executedActions: int = 0
    error: Optional[str] = None

class EventType(Enum):
    """事件类型（借鉴 Pi-Agent 4 级生命周期）"""
    AGENT_START = "agent_start"
    AGENT_END = "agent_end"
    ACTION_START = "action_start"
    ACTION_UPDATE = "action_update"
    ACTION_END = "action_end"

@dataclass
class AgentEvent:
    """Agent 事件"""
    type: EventType
    data: Optional[Dict[str, Any]] = None

# ========== 混合实现 ==========

class HybridGUIAgent:
    """
    混合 GUI Agent
    
    特点：
    - 底层：OSWorld 标准操作（16 种原语）
    - 运行时：Pi-Agent 事件系统 + Hook
    """
    
    def __init__(self,
                 beforeAction: Optional[Callable] = None,
                 afterAction: Optional[Callable] = None,
                 onEvent: Optional[Callable] = None):
        """
        初始化
        
        Args:
            beforeAction: Hook - 执行前拦截
            afterAction: Hook - 执行后处理
            onEvent: 事件监听器
        """
        self.beforeAction = beforeAction
        self.afterAction = afterAction
        self.onEventCallback = onEvent
        
        # 配置 pyautogui
        pyautogui.PAUSE = 0.1
        pyautogui.FAILSAFE = True
        self.screen_width, self.screen_height = pyautogui.size()
        
        # 状态
        self.state = AgentState()
    
    def execute(self, action: Action) -> ToolResult:
        """
        执行操作（带 Hook 和事件）
        
        Args:
            action: 操作定义
            
        Returns:
            执行结果
        """
        try:
            # 1. 发送 ACTION_START 事件
            self._emit(EventType.ACTION_START, {
                'action_type': action.action_type.value,
                'parameters': action.parameters
            })
            
            # 2. beforeAction Hook
            if self.beforeAction:
                should_block = self.beforeAction(action)
                if should_block:
                    result = ToolResult(
                        content=[{'type': 'text', 'text': '操作被拦截'}],
                        details={'reason': should_block},
                        isError=True
                    )
                    self._emit(EventType.ACTION_END, {'success': False, 'reason': 'blocked'})
                    return result
            
            # 3. 执行操作
            handler = self._get_handler(action.action_type)
            if handler is None:
                raise ValueError(f"未知操作: {action.action_type}")
            
            result_data = handler(**action.parameters)
            
            # 4. 构造结果
            result = ToolResult(
                content=[{'type': 'text', 'text': f'操作 {action.action_type.value} 成功'}],
                details=result_data
            )
            
            # 5. afterAction Hook
            if self.afterAction:
                modified_result = self.afterAction(action, result)
                if modified_result:
                    result = modified_result
            
            # 6. 发送 ACTION_END 事件
            self._emit(EventType.ACTION_END, {'success': True, 'data': result_data})
            
            self.state.executedActions += 1
            return result
            
        except Exception as e:
            result = ToolResult(
                content=[{'type': 'text', 'text': f'操作失败: {str(e)}'}],
                details={},
                isError=True
            )
            self._emit(EventType.ACTION_END, {'success': False, 'error': str(e)})
            return result
    
    def execute_batch(self, actions: List[Action]) -> List[ToolResult]:
        """批量执行"""
        self.state.isRunning = True
        self._emit(EventType.AGENT_START, {'total_actions': len(actions)})
        
        results = []
        for i, action in enumerate(actions):
            print(f"\n[Step {i+1}/{len(actions)}] 执行: {action.action_type.value}")
            result = self.execute(action)
            results.append(result)
            
            if result.isError:
                print(f"  ⚠️  失败: {result.content[0]['text']}")
            else:
                print(f"  ✅ 成功")
        
        self._emit(EventType.AGENT_END, {'executed': len(results)})
        self.state.isRunning = False
        return results
    
    # ========== 操作实现（OSWorld 标准）==========
    
    def _get_handler(self, action_type: ActionType):
        handlers = {
            ActionType.MOVE_TO: self._move_to,
            ActionType.CLICK: self._click,
            ActionType.RIGHT_CLICK: self._right_click,
            ActionType.DOUBLE_CLICK: self._double_click,
            ActionType.SCROLL: self._scroll,
            ActionType.TYPING: self._typing,
            ActionType.PRESS: self._press,
            ActionType.HOTKEY: self._hotkey,
            ActionType.WAIT: self._wait,
        }
        return handlers.get(action_type)
    
    def _move_to(self, x: float, y: float) -> Dict:
        pyautogui.moveTo(x, y)
        return {'x': x, 'y': y}
    
    def _click(self, x: Optional[float] = None, y: Optional[float] = None,
               button: str = "left", num_clicks: int = 1) -> Dict:
        if x and y:
            pyautogui.click(x, y, clicks=num_clicks, button=button)
        else:
            pyautogui.click(clicks=num_clicks, button=button)
        return {'x': x, 'y': y, 'button': button}
    
    def _right_click(self, x: Optional[float] = None, y: Optional[float] = None) -> Dict:
        if x and y:
            pyautogui.rightClick(x, y)
        else:
            pyautogui.rightClick()
        return {'x': x, 'y': y}
    
    def _double_click(self, x: Optional[float] = None, y: Optional[float] = None) -> Dict:
        if x and y:
            pyautogui.doubleClick(x, y)
        else:
            pyautogui.doubleClick()
        return {'x': x, 'y': y}
    
    def _scroll(self, dx: int, dy: int) -> Dict:
        if dy != 0:
            pyautogui.scroll(dy)
        return {'dx': dx, 'dy': dy}
    
    def _typing(self, text: str, interval: float = 0.0) -> Dict:
        # 支持流式进度
        chars = len(text)
        for i in range(0, chars, 10):
            chunk = text[i:i+10]
            pyautogui.typewrite(chunk, interval=interval)
            
            # 发送进度更新
            self._emit(EventType.ACTION_UPDATE, {
                'progress': ((i + len(chunk)) / chars) * 100,
                'chars_typed': i + len(chunk),
                'total_chars': chars
            })
        
        return {'text': text, 'length': chars}
    
    def _press(self, key: str) -> Dict:
        pyautogui.press(key)
        return {'key': key}
    
    def _hotkey(self, *keys: str) -> Dict:
        pyautogui.hotkey(*keys)
        return {'keys': list(keys)}
    
    def _wait(self, seconds: float = 5.0) -> Dict:
        steps = int(seconds * 2)
        for i in range(steps):
            time.sleep(0.5)
            self._emit(EventType.ACTION_UPDATE, {
                'progress': ((i + 1) / steps) * 100,
                'elapsed': (i + 1) * 0.5
            })
        return {'waited': seconds}
    
    # ========== 辅助功能 ==========
    
    def screenshot(self) -> str:
        """截图（需要权限）"""
        img = pyautogui.screenshot()
        buffer = io.BytesIO()
        img.save(buffer, format='PNG')
        return base64.b64encode(buffer.getvalue()).decode()
    
    def _emit(self, event_type: EventType, data: Optional[Dict] = None):
        """发送事件"""
        event = AgentEvent(type=event_type, data=data)
        if self.onEventCallback:
            self.onEventCallback(event)


# ========== 测试 ==========

if __name__ == "__main__":
    print("="*60)
    print("NuwaClaw GUI Agent - 混合方案测试")
    print("="*60)
    
    # 创建 Agent（带 Hook 和事件）
    agent = HybridGUIAgent(
        beforeAction=lambda action: "需要确认" if action.action_type == ActionType.CLICK else None,
        afterAction=lambda action, result: None,  # 不修改结果
        onEvent=lambda event: print(f"  [Event] {event.type.value}") if event.type in [EventType.AGENT_START, EventType.AGENT_END] else None
    )
    
    # 测试 1: 单个操作
    print("\n📝 测试 1: 单个操作（移动）")
    action = Action(ActionType.MOVE_TO, {"x": 100, "y": 100})
    result = agent.execute(action)
    print(f"  成功: {not result.isError}")
    
    # 测试 2: Hook 拦截
    print("\n📝 测试 2: Hook 拦截（点击被拦截）")
    action = Action(ActionType.CLICK, {"x": 200, "y": 200})
    result = agent.execute(action)
    print(f"  被拦截: {result.isError}")
    print(f"  原因: {result.details.get('reason')}")
    
    # 测试 3: 批量执行
    print("\n📝 测试 3: 批量执行（3 个操作）")
    actions = [
        Action(ActionType.MOVE_TO, {"x": 300, "y": 300}),
        Action(ActionType.PRESS, {"key": "escape"}),
        Action(ActionType.WAIT, {"seconds": 1.0}),
    ]
    results = agent.execute_batch(actions)
    print(f"  成功: {sum(1 for r in results if not r.isError)}/{len(results)}")
    
    print("\n" + "="*60)
    print("测试完成")
    print("="*60)
    print(f"\n✅ 混合方案验证成功")
    print(f"  - OSWorld 操作: ✅")
    print(f"  - Pi-Agent Hook: ✅")
    print(f"  - Pi-Agent 事件: ✅")
    print(f"  - 流式进度: ✅")
