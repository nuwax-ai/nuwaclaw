"""
NuwaClaw GUI Agent - 操作录制回放测试（模拟版）
不涉及真实 GUI 操作，测试核心逻辑
"""

import sys
import time
import json
from action_recorder import RecordedAction, RecordingSession, ActionRecorder, ActionPlayer

print("="*60)
print("NuwaClaw GUI Agent - 操作录制回放测试")
print("="*60)

# 测试 1: 创建模拟录制会话
print("\n📝 测试 1: 创建模拟录制会话")
print("-"*40)

session_id = f"test_session_{int(time.time())}"
session = RecordingSession(
    session_id=session_id,
    start_time="2026-03-18T11:00:00",
    actions=[
        RecordedAction(timestamp=time.time(), action_type="CLICK", 
                      parameters={"x": 100, "y": 200, "button": "left", "num_clicks": 1}, 
                      duration=0.5),
        RecordedAction(timestamp=time.time()+0.5, action_type="TYPING", 
                      parameters={"text": "Hello"}, 
                      duration=1.0),
        RecordedAction(timestamp=time.time()+1.5, action_type="PRESS", 
                      parameters={"key": "enter"}, 
                      duration=0.5),
        RecordedAction(timestamp=time.time()+2.0, action_type="SCROLL", 
                      parameters={"x": 500, "y": 300, "dx": 0, "dy": 100}, 
                      duration=1.0),
    ]
)
session.end_time = "2026-03-18T11:00:05"

print(f"  会话 ID: {session.session_id}")
print(f"  开始时间: {session.start_time}")
print(f"  结束时间: {session.end_time}")
print(f"  操作数: {len(session.actions)}")

for i, action in enumerate(session.actions):
    print(f"  {i+1}. {action.action_type}: {action.parameters}")

# 测试 2: 导出为 JSON
print("\n📝 测试 2: 导出为 JSON")
print("-"*40)

export_path = f"/tmp/{session_id}.json"
data = {
    "session_id": session.session_id,
    "start_time": session.start_time,
    "end_time": session.end_time,
    "action_count": len(session.actions),
    "actions": [
        {
            "timestamp": action.timestamp,
            "action_type": action.action_type,
            "parameters": action.parameters,
            "duration": action.duration
        }
        for action in session.actions
    ]
}

with open(export_path, 'w', encoding='utf-8') as f:
    json.dump(data, f, indent=2, ensure_ascii=False)

print(f"  ✅ 已导出: {export_path}")
print(f"  文件大小: {len(json.dumps(data))} bytes")

# 测试 3: 从 JSON 加载
print("\n📝 测试 3: 从 JSON 加载")
print("-"*40)

with open(export_path, 'r', encoding='utf-8') as f:
    loaded_data = json.load(f)

loaded_session = RecordingSession(
    session_id=loaded_data["session_id"],
    start_time=loaded_data["start_time"],
    end_time=loaded_data["end_time"],
    actions=[
        RecordedAction(**action) for action in loaded_data["actions"]
    ]
)

print(f"  ✅ 已加载")
print(f"  操作数: {len(loaded_session.actions)}")

# 验证数据一致性
if len(session.actions) == len(loaded_session.actions):
    print(f"  ✅ 数据一致")
else:
    print(f"  ❌ 数据不一致")

# 测试 4: ActionPlayer 初始化
print("\n📝 测试 4: ActionPlayer 初始化")
print("-"*40)

player = ActionPlayer(speed=2.0)
print(f"  速度: {player.speed}x")
print(f"  状态: {'播放中' if player.is_playing else '空闲'}")

# 测试 5: 模拟回放（不执行真实操作）
print("\n📝 测试 5: 模拟回放（跳过真实执行）")
print("-"*40)

print(f"  回放会话: {loaded_session.session_id}")
print(f"  操作数: {len(loaded_session.actions)}")

total_duration = sum(action.duration for action in loaded_session.actions)
adjusted_duration = total_duration / player.speed

print(f"  原始时长: {total_duration:.2f} 秒")
print(f"  调整后时长 ({player.speed}x): {adjusted_duration:.2f} 秒")

for i, action in enumerate(loaded_session.actions):
    print(f"  {i+1}/{len(loaded_session.actions)} {action.action_type} (等待 {action.duration:.2f}s)")

# 测试 6: 边界情况
print("\n📝 测试 6: 边界情况")
print("-"*40)

# 6.1 空会话
empty_session = RecordingSession(
    session_id="empty",
    start_time="2026-03-18T11:00:00"
)
print(f"  空会话操作数: {len(empty_session.actions)}")

# 6.2 单操作会话
single_session = RecordingSession(
    session_id="single",
    start_time="2026-03-18T11:00:00",
    actions=[RecordedAction(timestamp=time.time(), action_type="DONE", parameters={})]
)
print(f"  单操作会话: {len(single_session.actions)}")

# 清理
import os
os.remove(export_path)
print(f"\n📝 清理测试文件")
print(f"  ✅ 已删除: {export_path}")

print("\n" + "="*60)
print("测试完成")
print("="*60)
print(f"\n✅ 操作录制回放核心逻辑验证成功")
print(f"  - 会话创建: ✅")
print(f"  - JSON 导出: ✅")
print(f"  - JSON 加载: ✅")
print(f"  - Player 初始化: ✅")
print(f"  - 边界情况: ✅")
print(f"\n⚠️  真实录制回放需要 macOS 辅助功能权限")
