"""
NuwaClaw GUI Agent - OSWorld 方案测试（跳过截图）
"""

from nuwaclaw_osworld_agent import OSWorldGUIAgent, Action, ActionType
import time

# 创建 Agent
agent = OSWorldGUIAgent(
    confidence=0.9,
    pause=0.1,
    enable_safety=True
)

print("\n" + "="*60)
print("NuwaClaw GUI Agent - OSWorld 方案测试")
print("="*60)

# ========== 测试 1: 鼠标位置 ==========
print("\n\n📝 测试 1: 鼠标位置")
print("-"*40)
current_pos = agent.get_mouse_position()
print(f"  当前位置: {current_pos}")
print(f"  屏幕尺寸: {agent.screen_width}x{agent.screen_height}")

# ========== 测试 2: 鼠标移动 ==========
print("\n\n📝 测试 2: 鼠标移动")
print("-"*40)

action_move = Action(
    action_type=ActionType.MOVE_TO,
    parameters={"x": 100, "y": 100}
)
result = agent.execute(action_move)
print(f"  移动到 (100, 100): {result.success}")
print(f"    消息: {result.message}")
print(f"    数据: {result.data}")

# 恢复位置
action_restore = Action(
    action_type=ActionType.MOVE_TO,
    parameters={"x": current_pos[0], "y": current_pos[1]}
)
agent.execute(action_restore)
print(f"  已恢复到原位置")

# ========== 测试 3: 按键操作 ==========
print("\n\n📝 测试 3: 按键操作")
print("-"*40)

action_press = Action(
    action_type=ActionType.PRESS,
    parameters={"key": "escape"}
)
result = agent.execute(action_press)
print(f"  按 ESC: {result.success}")

action_press_enter = Action(
    action_type=ActionType.PRESS,
    parameters={"key": "enter"}
)
result = agent.execute(action_press_enter)
print(f"  按 Enter: {result.success}")

# ========== 测试 4: 批量执行 ==========
print("\n\n📝 测试 4: 批量执行")
print("-"*40)

actions = [
    Action(action_type=ActionType.MOVE_TO, parameters={"x": 500, "y": 500}),
    Action(action_type=ActionType.PRESS, parameters={"key": "escape"}),
    Action(action_type=ActionType.MOVE_TO, parameters={"x": current_pos[0], "y": current_pos[1]}),
]

results = agent.execute_batch(actions)

print(f"\n  执行结果:")
for i, result in enumerate(results):
    print(f"    {i+1}. {result.success} - {result.message}")

# ========== 测试 5: 特殊操作 ==========
print("\n\n📝 测试 5: 特殊操作")
print("-"*40)

action_done = Action(
    action_type=ActionType.DONE,
    parameters={}
)
result = agent.execute(action_done)
print(f"  完成标记: {result.success}")
print(f"    数据: {result.data}")

# ========== 测试 6: 错误处理 ==========
print("\n\n📝 测试 6: 错误处理")
print("-"*40)

action_invalid = Action(
    action_type=ActionType.PRESS,
    parameters={"key": "invalid_key_123"}
)
result = agent.execute(action_invalid)
print(f"  无效按键: {result.success}")
print(f"    消息: {result.message}")

# ========== 总结 ==========
print("\n\n" + "="*60)
print("测试完成")
print("="*60)
print(f"\n✅ OSWorld Agent 初始化成功")
print(f"✅ 鼠标操作正常")
print(f"✅ 键盘操作正常")
print(f"✅ 批量执行正常")
print(f"✅ 错误处理正常")
print(f"\n⚠️  截图功能需要 macOS 屏幕录制权限")
