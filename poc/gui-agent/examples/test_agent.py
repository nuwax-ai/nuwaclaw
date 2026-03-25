"""
NuwaClaw GUI Agent - OSWorld 方案测试
"""

from nuwaclaw_osworld_agent import OSWorldGUIAgent, Action, ActionType

# 创建 Agent
agent = OSWorldGUIAgent(
    confidence=0.9,
    pause=0.1,
    enable_safety=True
)

print("\n" + "="*60)
print("NuwaClaw GUI Agent - OSWorld 方案测试")
print("="*60)

# ========== 测试 1: 截图 ==========
print("\n\n📝 测试 1: 截图")
print("-"*40)
screenshot_b64 = agent.screenshot()
print(f"  截图大小: {len(screenshot_b64)} bytes (base64)")
print(f"  截图尺寸: {agent.screen_width}x{agent.screen_height}")

# ========== 测试 2: 鼠标操作 ==========
print("\n\n📝 测试 2: 鼠标操作")
print("-"*40)

# 获取当前鼠标位置
current_pos = agent.get_mouse_position()
print(f"  当前位置: {current_pos}")

# 移动
action_move = Action(
    action_type=ActionType.MOVE_TO,
    parameters={"x": 100, "y": 100}
)
result = agent.execute(action_move)
print(f"\n  移动到 (100, 100): {result.success}")
print(f"    消息: {result.message}")

# 点击
action_click = Action(
    action_type=ActionType.CLICK,
    parameters={"x": 200, "y": 200, "button": "left", "num_clicks": 1}
)
result = agent.execute(action_click)
print(f"\n  左键点击 (200, 200): {result.success}")
print(f"    数据: {result.data}")

# 双击
action_double = Action(
    action_type=ActionType.DOUBLE_CLICK,
    parameters={"x": 300, "y": 300}
)
result = agent.execute(action_double)
print(f"\n  双击 (300, 300): {result.success}")

# 右键
action_right = Action(
    action_type=ActionType.RIGHT_CLICK,
    parameters={"x": 400, "y": 400}
)
result = agent.execute(action_right)
print(f"\n  右键点击 (400, 400): {result.success}")

# 恢复位置
action_restore = Action(
    action_type=ActionType.MOVE_TO,
    parameters={"x": current_pos[0], "y": current_pos[1]}
)
agent.execute(action_restore)

# ========== 测试 3: 键盘操作 ==========
print("\n\n📝 测试 3: 键盘操作")
print("-"*40)

# 单个按键
action_press = Action(
    action_type=ActionType.PRESS,
    parameters={"key": "enter"}
)
result = agent.execute(action_press)
print(f"  按下 Enter: {result.success}")

# 快捷键
action_hotkey = Action(
    action_type=ActionType.HOTKEY,
    parameters={"keys": ["command", "space"]}  # macOS Spotlight
)
result = agent.execute(action_hotkey)
print(f"  快捷键 Cmd+Space: {result.success}")

# 等待
import time
time.sleep(0.5)

# 输入文本
action_type = Action(
    action_type=ActionType.TYPING,
    parameters={"text": "Hello, NuwaClaw!"}
)
result = agent.execute(action_type)
print(f"  输入文本: {result.success}")
print(f"    数据: {result.data}")

# 关闭 Spotlight
action_esc = Action(
    action_type=ActionType.PRESS,
    parameters={"key": "escape"}
)
agent.execute(action_esc)

# ========== 测试 4: 滚动 ==========
print("\n\n📝 测试 4: 滚动")
print("-"*40)

action_scroll = Action(
    action_type=ActionType.SCROLL,
    parameters={"dx": 0, "dy": 100}  # 向上滚动
)
result = agent.execute(action_scroll)
print(f"  向上滚动: {result.success}")
print(f"    数据: {result.data}")

# ========== 测试 5: 批量执行 ==========
print("\n\n📝 测试 5: 批量执行")
print("-"*40)

actions = [
    Action(action_type=ActionType.MOVE_TO, parameters={"x": 500, "y": 500}),
    Action(action_type=ActionType.CLICK, parameters={"button": "left"}),
    Action(action_type=ActionType.TYPING, parameters={"text": "Batch test"}),
    Action(action_type=ActionType.PRESS, parameters={"key": "enter"}),
]

results = agent.execute_batch(actions)

print(f"\n  执行结果:")
for i, result in enumerate(results):
    print(f"    {i+1}. {result.success}")

# ========== 测试 6: 特殊操作 ==========
print("\n\n📝 测试 6: 特殊操作")
print("-"*40)

action_wait = Action(
    action_type=ActionType.WAIT,
    parameters={}
)
result = agent.execute(action_wait)
print(f"  等待: {result.success}")
print(f"    数据: {result.data}")

action_done = Action(
    action_type=ActionType.DONE,
    parameters={}
)
result = agent.execute(action_done)
print(f"\n  完成: {result.success}")
print(f"    数据: {result.data}")

# ========== 测试 7: 错误处理 ==========
print("\n\n📝 测试 7: 错误处理")
print("-"*40)

action_invalid = Action(
    action_type=ActionType.PRESS,
    parameters={"key": "invalid_key_123"}
)
result = agent.execute(action_invalid)
print(f"  无效按键: {result.success}")
print(f"    消息: {result.message}")

print("\n\n" + "="*60)
print("测试完成")
print("="*60)
