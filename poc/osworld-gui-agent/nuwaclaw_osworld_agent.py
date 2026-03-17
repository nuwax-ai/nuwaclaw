"""
NuwaClaw GUI Agent - OSWorld 方案
直接使用 OSWorld 的 desktop_env 和 ACTION_SPACE
"""

import pyautogui
import time
from typing import Dict, Any, Optional, Tuple, List
from dataclasses import dataclass
from enum import Enum
from PIL import Image
import io
import base64

# 借鉴 OSWorld 的常量定义
X_MAX = 1920  # TODO: 动态获取屏幕分辨率
Y_MAX = 1080

# OSWorld 的键盘按键定义
KEYBOARD_KEYS = [
    '\t', '\n', '\r', ' ', '!', '"', '#', '$', '%', '&', "'", '(', ')', '*', '+', ',', '-', '.', '/',
    '0', '1', '2', '3', '4', '5', '6', '7', '8', '9', ':', ';', '<', '=', '>', '?', '@', '[', '\\',
    ']', '^', '_', '`', 'a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j', 'k', 'l', 'm', 'n', 'o',
    'p', 'q', 'r', 's', 't', 'u', 'v', 'w', 'x', 'y', 'z', '{', '|', '}', '~',
    'accept', 'add', 'alt', 'altleft', 'altright', 'apps', 'backspace',
    'browserback', 'browserfavorites', 'browserforward', 'browserhome',
    'browserrefresh', 'browsersearch', 'browserstop', 'capslock', 'clear',
    'convert', 'ctrl', 'ctrlleft', 'ctrlright', 'decimal', 'del', 'delete',
    'divide', 'down', 'end', 'enter', 'esc', 'escape', 'execute', 'f1', 'f10',
    'f11', 'f12', 'f13', 'f14', 'f15', 'f16', 'f17', 'f18', 'f19', 'f2', 'f20',
    'f21', 'f22', 'f23', 'f24', 'f3', 'f4', 'f5', 'f6', 'f7', 'f8', 'f9',
    'final', 'fn', 'hanguel', 'hangul', 'hanja', 'help', 'home', 'insert',
    'junja', 'kana', 'kanji', 'launchapp1', 'launchapp2', 'launchmail',
    'launchmediaselect', 'left', 'modechange', 'multiply', 'nexttrack',
    'nonconvert', 'num0', 'num1', 'num2', 'num3', 'num4', 'num5', 'num6',
    'num7', 'num8', 'num9', 'numlock', 'pagedown', 'pageup', 'pause', 'pgdn',
    'pgup', 'playpause', 'prevtrack', 'print', 'printscreen', 'prntscrn',
    'prtsc', 'prtscr', 'return', 'right', 'scrolllock', 'select', 'separator',
    'shift', 'shiftleft', 'shiftright', 'sleep', 'stop', 'subtract', 'tab',
    'up', 'volumedown', 'volumemute', 'volumeup', 'win', 'winleft', 'winright',
    'yen', 'command', 'option', 'optionleft', 'optionright'
]


class ActionType(Enum):
    """OSWorld 标准操作类型"""
    MOVE_TO = "MOVE_TO"
    CLICK = "CLICK"
    MOUSE_DOWN = "MOUSE_DOWN"
    MOUSE_UP = "MOUSE_UP"
    RIGHT_CLICK = "RIGHT_CLICK"
    DOUBLE_CLICK = "DOUBLE_CLICK"
    DRAG_TO = "DRAG_TO"
    SCROLL = "SCROLL"
    TYPING = "TYPING"
    PRESS = "PRESS"
    KEY_DOWN = "KEY_DOWN"
    KEY_UP = "KEY_UP"
    HOTKEY = "HOTKEY"
    WAIT = "WAIT"
    FAIL = "FAIL"
    DONE = "DONE"


@dataclass
class Action:
    """OSWorld 标准操作定义"""
    action_type: ActionType
    parameters: Dict[str, Any]


@dataclass
class ActionResult:
    """操作执行结果"""
    success: bool
    message: str
    data: Optional[Dict[str, Any]] = None
    screenshot: Optional[str] = None  # base64


class OSWorldGUIAgent:
    """
    基于 OSWorld 标准的 GUI Agent 实现
    
    特点：
    - 直接使用 OSWorld 的 ACTION_SPACE 定义
    - 使用 pyautogui 作为底层驱动
    - 支持完整的 GUI 操作原语
    - 更重量级，但功能完整
    """
    
    def __init__(self, 
                 confidence: float = 0.9,
                 pause: float = 0.1,
                 enable_safety: bool = True):
        """
        初始化 Agent
        
        Args:
            confidence: pyautogui 置信度
            pause: 操作间隔
            enable_safety: 是否启用安全模式（防止失控）
        """
        self.confidence = confidence
        self.pause = pause
        self.enable_safety = enable_safety
        
        # 配置 pyautogui
        pyautogui.PAUSE = pause
        pyautogui.CONFIDENCE = confidence
        
        if enable_safety:
            # 防止失控：鼠标移到角落会触发异常
            pyautogui.FAILSAFE = True
        
        # 获取屏幕尺寸
        self.screen_width, self.screen_height = pyautogui.size()
        
        print(f"[OSWorld Agent] 初始化完成")
        print(f"  屏幕尺寸: {self.screen_width}x{self.screen_height}")
        print(f"  安全模式: {enable_safety}")
    
    def execute(self, action: Action) -> ActionResult:
        """
        执行单个操作
        
        Args:
            action: 操作定义
            
        Returns:
            执行结果
        """
        try:
            handler = self._get_handler(action.action_type)
            if handler is None:
                return ActionResult(
                    success=False,
                    message=f"未知操作类型: {action.action_type}"
                )
            
            result = handler(**action.parameters)
            return ActionResult(
                success=True,
                message=f"操作 {action.action_type.value} 执行成功",
                data=result
            )
            
        except Exception as e:
            return ActionResult(
                success=False,
                message=f"操作失败: {str(e)}"
            )
    
    def execute_batch(self, actions: List[Action]) -> List[ActionResult]:
        """
        批量执行操作
        
        Args:
            actions: 操作列表
            
        Returns:
            结果列表
        """
        results = []
        for i, action in enumerate(actions):
            print(f"\n[Step {i+1}/{len(actions)}] 执行: {action.action_type.value}")
            result = self.execute(action)
            results.append(result)
            
            if not result.success:
                print(f"  ⚠️  失败: {result.message}")
            else:
                print(f"  ✅ 成功")
        
        return results
    
    def _get_handler(self, action_type: ActionType):
        """获取操作处理器"""
        handlers = {
            ActionType.MOVE_TO: self._move_to,
            ActionType.CLICK: self._click,
            ActionType.MOUSE_DOWN: self._mouse_down,
            ActionType.MOUSE_UP: self._mouse_up,
            ActionType.RIGHT_CLICK: self._right_click,
            ActionType.DOUBLE_CLICK: self._double_click,
            ActionType.DRAG_TO: self._drag_to,
            ActionType.SCROLL: self._scroll,
            ActionType.TYPING: self._typing,
            ActionType.PRESS: self._press,
            ActionType.KEY_DOWN: self._key_down,
            ActionType.KEY_UP: self._key_up,
            ActionType.HOTKEY: self._hotkey,
            ActionType.WAIT: self._wait,
            ActionType.FAIL: self._fail,
            ActionType.DONE: self._done,
        }
        return handlers.get(action_type)
    
    # ========== 操作实现 ==========
    
    def _move_to(self, x: float, y: float) -> Dict[str, Any]:
        """移动鼠标"""
        pyautogui.moveTo(x, y)
        return {"x": x, "y": y}
    
    def _click(self, button: str = "left", x: Optional[float] = None, 
               y: Optional[float] = None, num_clicks: int = 1) -> Dict[str, Any]:
        """点击"""
        if x is not None and y is not None:
            pyautogui.click(x, y, clicks=num_clicks, button=button)
        else:
            pyautogui.click(clicks=num_clicks, button=button)
        
        return {"button": button, "x": x, "y": y, "num_clicks": num_clicks}
    
    def _mouse_down(self, button: str = "left") -> Dict[str, Any]:
        """按下鼠标"""
        pyautogui.mouseDown(button=button)
        return {"button": button}
    
    def _mouse_up(self, button: str = "left") -> Dict[str, Any]:
        """释放鼠标"""
        pyautogui.mouseUp(button=button)
        return {"button": button}
    
    def _right_click(self, x: Optional[float] = None, 
                     y: Optional[float] = None) -> Dict[str, Any]:
        """右键点击"""
        if x is not None and y is not None:
            pyautogui.rightClick(x, y)
        else:
            pyautogui.rightClick()
        return {"x": x, "y": y}
    
    def _double_click(self, x: Optional[float] = None, 
                      y: Optional[float] = None) -> Dict[str, Any]:
        """双击"""
        if x is not None and y is not None:
            pyautogui.doubleClick(x, y)
        else:
            pyautogui.doubleClick()
        return {"x": x, "y": y}
    
    def _drag_to(self, x: float, y: float) -> Dict[str, Any]:
        """拖拽"""
        pyautogui.dragTo(x, y)
        return {"x": x, "y": y}
    
    def _scroll(self, dx: int, dy: int) -> Dict[str, Any]:
        """滚动"""
        # pyautogui 的 scroll 是垂直滚动
        if dy != 0:
            pyautogui.scroll(dy)
        # 水平滚动需要 hscroll（较新版本）
        if dx != 0:
            try:
                pyautogui.hscroll(dx)
            except AttributeError:
                print("  ⚠️  水平滚动不支持")
        
        return {"dx": dx, "dy": dy}
    
    def _typing(self, text: str) -> Dict[str, Any]:
        """输入文本"""
        pyautogui.typewrite(text)
        return {"text": text, "length": len(text)}
    
    def _press(self, key: str) -> Dict[str, Any]:
        """按键"""
        if key not in KEYBOARD_KEYS:
            raise ValueError(f"无效按键: {key}")
        pyautogui.press(key)
        return {"key": key}
    
    def _key_down(self, key: str) -> Dict[str, Any]:
        """按下按键"""
        if key not in KEYBOARD_KEYS:
            raise ValueError(f"无效按键: {key}")
        pyautogui.keyDown(key)
        return {"key": key}
    
    def _key_up(self, key: str) -> Dict[str, Any]:
        """释放按键"""
        if key not in KEYBOARD_KEYS:
            raise ValueError(f"无效按键: {key}")
        pyautogui.keyUp(key)
        return {"key": key}
    
    def _hotkey(self, *keys: str) -> Dict[str, Any]:
        """快捷键"""
        for key in keys:
            if key not in KEYBOARD_KEYS:
                raise ValueError(f"无效按键: {key}")
        pyautogui.hotkey(*keys)
        return {"keys": list(keys)}
    
    def _wait(self) -> Dict[str, Any]:
        """等待"""
        time.sleep(5)
        return {"waited": 5}
    
    def _fail(self) -> Dict[str, Any]:
        """标记失败"""
        return {"status": "fail"}
    
    def _done(self) -> Dict[str, Any]:
        """标记完成"""
        return {"status": "done"}
    
    # ========== 辅助功能 ==========
    
    def screenshot(self, region: Optional[Tuple[int, int, int, int]] = None,
                   format: str = "PNG") -> str:
        """
        截图
        
        Args:
            region: 截图区域 (x, y, width, height)
            format: 图片格式
            
        Returns:
            base64 编码的图片
        """
        if region:
            img = pyautogui.screenshot(region=region)
        else:
            img = pyautogui.screenshot()
        
        # 转换为 base64
        buffer = io.BytesIO()
        img.save(buffer, format=format)
        img_base64 = base64.b64encode(buffer.getvalue()).decode()
        
        return img_base64
    
    def locate_on_screen(self, image_path: str, 
                         confidence: Optional[float] = None) -> Optional[Tuple[int, int, int, int]]:
        """
        在屏幕上定位图片
        
        Args:
            image_path: 图片路径
            confidence: 置信度
            
        Returns:
            位置 (x, y, width, height) 或 None
        """
        conf = confidence or self.confidence
        try:
            location = pyautogui.locateOnScreen(image_path, confidence=conf)
            return location
        except pyautogui.ImageNotFoundException:
            return None
    
    def get_mouse_position(self) -> Tuple[int, int]:
        """获取鼠标位置"""
        return pyautogui.position()
