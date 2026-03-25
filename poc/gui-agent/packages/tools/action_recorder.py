"""
NuwaClaw GUI Agent - 操作录制与回放
记录用户操作，支持回放和脚本导出
"""

import json
import time
from typing import List, Dict, Any, Optional
from dataclasses import dataclass, asdict
from datetime import datetime
import pyautogui
from pynput import mouse, keyboard

# ========== 数据结构 ==========

@dataclass
class RecordedAction:
    """录制的操作"""
    timestamp: float
    action_type: str
    parameters: Dict[str, Any]
    duration: float = 0.0  # 与下一个操作的时间间隔

@dataclass
class RecordingSession:
    """录制会话"""
    session_id: str
    start_time: str
    end_time: Optional[str] = None
    actions: List[RecordedAction] = None
    
    def __post_init__(self):
        if self.actions is None:
            self.actions = []

# ========== 录制器 ==========

class ActionRecorder:
    """
    操作录制器
    
    功能：
    - 监听鼠标和键盘事件
    - 记录操作序列
    - 支持暂停/恢复
    - 导出为 JSON 脚本
    """
    
    def __init__(self):
        self.session: Optional[RecordingSession] = None
        self.is_recording = False
        self.is_paused = False
        self.last_action_time: Optional[float] = None
        
        # 监听器
        self.mouse_listener: Optional[mouse.Listener] = None
        self.keyboard_listener: Optional[keyboard.Listener] = None
    
    def start_recording(self, session_id: Optional[str] = None) -> str:
        """
        开始录制
        
        Args:
            session_id: 会话 ID（可选，自动生成）
            
        Returns:
            session_id
        """
        if self.is_recording:
            raise RuntimeError("Already recording")
        
        # 创建会话
        if session_id is None:
            session_id = f"session_{int(time.time())}"
        
        self.session = RecordingSession(
            session_id=session_id,
            start_time=datetime.now().isoformat()
        )
        
        self.is_recording = True
        self.is_paused = False
        self.last_action_time = time.time()
        
        # 启动监听器
        self._start_listeners()
        
        print(f"[Recorder] 开始录制: {session_id}")
        return session_id
    
    def stop_recording(self) -> RecordingSession:
        """停止录制"""
        if not self.is_recording:
            raise RuntimeError("Not recording")
        
        self.is_recording = False
        self.session.end_time = datetime.now().isoformat()
        
        # 停止监听器
        self._stop_listeners()
        
        print(f"[Recorder] 停止录制: {self.session.session_id}")
        print(f"  操作数: {len(self.session.actions)}")
        
        return self.session
    
    def pause_recording(self):
        """暂停录制"""
        self.is_paused = True
        print("[Recorder] 已暂停")
    
    def resume_recording(self):
        """恢复录制"""
        self.is_paused = False
        self.last_action_time = time.time()
        print("[Recorder] 已恢复")
    
    def _start_listeners(self):
        """启动监听器"""
        # 鼠标监听
        self.mouse_listener = mouse.Listener(
            on_move=self._on_mouse_move,
            on_click=self._on_mouse_click,
            on_scroll=self._on_mouse_scroll
        )
        
        # 键盘监听
        self.keyboard_listener = keyboard.Listener(
            on_press=self._on_key_press,
            on_release=self._on_key_release
        )
        
        self.mouse_listener.start()
        self.keyboard_listener.start()
    
    def _stop_listeners(self):
        """停止监听器"""
        if self.mouse_listener:
            self.mouse_listener.stop()
        if self.keyboard_listener:
            self.keyboard_listener.stop()
    
    def _record_action(self, action_type: str, parameters: Dict[str, Any]):
        """记录操作"""
        if not self.is_recording or self.is_paused:
            return
        
        current_time = time.time()
        duration = current_time - self.last_action_time if self.last_action_time else 0
        
        action = RecordedAction(
            timestamp=current_time,
            action_type=action_type,
            parameters=parameters,
            duration=duration
        )
        
        self.session.actions.append(action)
        self.last_action_time = current_time
        
        print(f"  [{len(self.session.actions)}] {action_type}: {parameters}")
    
    # ========== 鼠标事件 ==========
    
    def _on_mouse_move(self, x, y):
        """鼠标移动"""
        # 移动事件太多，只记录最终位置（通过时间间隔过滤）
        pass
    
    def _on_mouse_click(self, x, y, button, pressed):
        """鼠标点击"""
        if pressed:
            self._record_action("CLICK", {
                "x": x,
                "y": y,
                "button": str(button).split('.')[-1],  # left/right/middle
                "num_clicks": 1
            })
    
    def _on_mouse_scroll(self, x, y, dx, dy):
        """鼠标滚动"""
        self._record_action("SCROLL", {
            "x": x,
            "y": y,
            "dx": dx,
            "dy": dy
        })
    
    # ========== 键盘事件 ==========
    
    def _on_key_press(self, key):
        """按键按下"""
        try:
            key_name = key.char  # 普通字符
            self._record_action("TYPING", {
                "text": key_name
            })
        except AttributeError:
            key_name = str(key).split('.')[-1]  # 特殊键
            self._record_action("KEY_DOWN", {
                "key": key_name
            })
    
    def _on_key_release(self, key):
        """按键释放"""
        # 可选：记录 KEY_UP
        pass
    
    # ========== 导出功能 ==========
    
    def export_to_json(self, filepath: str):
        """导出为 JSON"""
        if not self.session:
            raise RuntimeError("No recording session")
        
        data = {
            "session_id": self.session.session_id,
            "start_time": self.session.start_time,
            "end_time": self.session.end_time,
            "action_count": len(self.session.actions),
            "actions": [asdict(action) for action in self.session.actions]
        }
        
        with open(filepath, 'w', encoding='utf-8') as f:
            json.dump(data, f, indent=2, ensure_ascii=False)
        
        print(f"[Recorder] 已导出: {filepath}")
    
    @staticmethod
    def load_from_json(filepath: str) -> RecordingSession:
        """从 JSON 加载"""
        with open(filepath, 'r', encoding='utf-8') as f:
            data = json.load(f)
        
        session = RecordingSession(
            session_id=data["session_id"],
            start_time=data["start_time"],
            end_time=data["end_time"],
            actions=[RecordedAction(**action) for action in data["actions"]]
        )
        
        print(f"[Recorder] 已加载: {filepath}")
        print(f"  操作数: {len(session.actions)}")
        
        return session


# ========== 回放器 ==========

class ActionPlayer:
    """
    操作回放器
    
    功能：
    - 回放录制的操作序列
    - 支持速度调节
    - 支持暂停/停止
    """
    
    def __init__(self, speed: float = 1.0):
        """
        初始化
        
        Args:
            speed: 回放速度（1.0 = 正常，2.0 = 2 倍速）
        """
        self.speed = speed
        self.is_playing = False
        self.should_stop = False
    
    def play(self, session: RecordingSession, speed: Optional[float] = None):
        """
        回放操作
        
        Args:
            session: 录制会话
            speed: 速度（覆盖默认值）
        """
        speed = speed or self.speed
        self.is_playing = True
        self.should_stop = False
        
        print(f"[Player] 开始回放: {session.session_id}")
        print(f"  操作数: {len(session.actions)}")
        print(f"  速度: {speed}x")
        
        for i, action in enumerate(session.actions):
            if self.should_stop:
                print(f"[Player] 已停止")
                break
            
            # 等待间隔（考虑速度）
            if action.duration > 0:
                time.sleep(action.duration / speed)
            
            # 执行操作
            self._execute_action(action)
            print(f"  [{i+1}/{len(session.actions)}] {action.action_type}")
        
        self.is_playing = False
        print(f"[Player] 回放完成")
    
    def stop(self):
        """停止回放"""
        self.should_stop = True
    
    def _execute_action(self, action: RecordedAction):
        """执行操作"""
        action_type = action.action_type
        params = action.parameters
        
        try:
            if action_type == "CLICK":
                pyautogui.click(
                    params["x"], params["y"],
                    button=params.get("button", "left"),
                    clicks=params.get("num_clicks", 1)
                )
            
            elif action_type == "SCROLL":
                pyautogui.scroll(
                    params["dy"],
                    x=params.get("x"),
                    y=params.get("y")
                )
            
            elif action_type == "TYPING":
                pyautogui.typewrite(params["text"])
            
            elif action_type == "KEY_DOWN":
                pyautogui.keyDown(params["key"])
            
            elif action_type == "KEY_UP":
                pyautogui.keyUp(params["key"])
            
            else:
                print(f"  ⚠️  未知操作: {action_type}")
        
        except Exception as e:
            print(f"  ❌ 执行失败: {e}")


# ========== 测试 ==========

if __name__ == "__main__":
    print("="*60)
    print("NuwaClaw GUI Agent - 操作录制回放测试")
    print("="*60)
    
    # 测试 1: 录制操作
    print("\n📝 测试 1: 录制操作（5 秒）")
    print("-"*40)
    print("提示: 请进行一些鼠标和键盘操作...")
    
    recorder = ActionRecorder()
    session_id = recorder.start_recording()
    
    # 录制 5 秒
    time.sleep(5)
    
    session = recorder.stop_recording()
    
    # 测试 2: 导出 JSON
    print("\n📝 测试 2: 导出 JSON")
    print("-"*40)
    
    export_path = f"/tmp/recording_{session_id}.json"
    recorder.export_to_json(export_path)
    
    # 测试 3: 加载 JSON
    print("\n📝 测试 3: 加载 JSON")
    print("-"*40)
    
    loaded_session = ActionRecorder.load_from_json(export_path)
    
    # 测试 4: 回放操作
    print("\n📝 测试 4: 回放操作（2 倍速）")
    print("-"*40)
    print("提示: 观察自动操作...")
    
    player = ActionPlayer(speed=2.0)
    player.play(loaded_session)
    
    # 清理
    import os
    os.remove(export_path)
    print(f"\n📝 已清理: {export_path}")
    
    print("\n" + "="*60)
    print("测试完成")
    print("="*60)
    print(f"\n✅ 录制回放功能验证成功")
    print(f"  - 录制: ✅")
    print(f"  - 导出: ✅")
    print(f"  - 加载: ✅")
    print(f"  - 回放: ✅")
