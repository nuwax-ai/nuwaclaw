#!/usr/bin/env python3
"""
NuwaClaw GUI Agent - Python Bridge

JSON-RPC 服务，接收 TypeScript 的调用请求，执行 OSWorld 标准操作。
"""

import sys
import json
import asyncio
import traceback
from typing import Any, Optional

# 添加 tools 目录到 path
sys.path.insert(0, '.')

try:
    from nuwaclaw_osworld_agent import OSWorldGUIAgent, Action, ActionType
    from image_locator import ImageLocator
    from action_recorder import ActionRecorder
except ImportError:
    # 如果直接运行，尝试从上级目录导入
    import os
    sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', 'tools'))
    from nuwaclaw_osworld_agent import OSWorldGUIAgent, Action, ActionType
    from image_locator import ImageLocator
    from action_recorder import ActionRecorder


class GUIAgentBridge:
    """GUI Agent Python 桥接服务"""

    def __init__(self):
        self.agent = OSWorldGUIAgent()
        self.image_locator = ImageLocator()
        self.recorder: Optional[ActionRecorder] = None

    async def handle_request(self, request: dict) -> dict:
        """处理 JSON-RPC 请求"""
        request_id = request.get('id')
        method = request.get('method')
        params = request.get('params', {})

        try:
            result = await self.dispatch(method, params)
            return {
                'jsonrpc': '2.0',
                'id': request_id,
                'result': result,
            }
        except Exception as e:
            return {
                'jsonrpc': '2.0',
                'id': request_id,
                'error': {
                    'code': -32000,
                    'message': str(e),
                    'data': traceback.format_exc(),
                },
            }

    async def dispatch(self, method: str, params: dict) -> Any:
        """分发方法调用"""
        handlers = {
            'ping': self.ping,
            'shutdown': self.shutdown,
            'execute_action': self.execute_action,
            'screenshot': self.screenshot,
            'locate_image': self.locate_image,
            'get_mouse_position': self.get_mouse_position,
            'start_recording': self.start_recording,
            'stop_recording': self.stop_recording,
            'play_recording': self.play_recording,
            'list_tools': self.list_tools,
        }

        handler = handlers.get(method)
        if not handler:
            raise ValueError(f'Unknown method: {method}')

        return await handler(params)

    # ==================== 基础方法 ====================

    async def ping(self, params: dict) -> str:
        """健康检查"""
        return 'pong'

    async def shutdown(self, params: dict) -> str:
        """关闭服务"""
        return 'shutting_down'

    async def list_tools(self, params: dict) -> list:
        """列出可用工具"""
        return [
            {'name': 'screenshot', 'description': '截取屏幕'},
            {'name': 'click', 'description': '点击'},
            {'name': 'double_click', 'description': '双击'},
            {'name': 'right_click', 'description': '右键点击'},
            {'name': 'move_to', 'description': '移动鼠标'},
            {'name': 'drag_to', 'description': '拖拽'},
            {'name': 'scroll', 'description': '滚动'},
            {'name': 'typing', 'description': '输入文本'},
            {'name': 'press', 'description': '按下按键'},
            {'name': 'hotkey', 'description': '快捷键'},
            {'name': 'locate_image', 'description': '定位图像'},
            {'name': 'get_mouse_position', 'description': '获取鼠标位置'},
        ]

    # ==================== OSWorld 操作 ====================

    async def execute_action(self, params: dict) -> dict:
        """执行 OSWorld 标准操作"""
        action_type_str = params.get('action_type')
        parameters = params.get('parameters', {})

        try:
            action_type = ActionType[action_type_str]
        except KeyError:
            raise ValueError(f'Invalid action type: {action_type_str}')

        action = Action(action_type=action_type, parameters=parameters)
        result = self.agent.execute(action)

        return {
            'success': result.success,
            'message': result.message,
            'data': result.data,
        }

    async def screenshot(self, params: dict) -> dict:
        """截取屏幕"""
        import base64
        from io import BytesIO

        region = params.get('region')
        format = params.get('format', 'png')

        # 截图
        if region:
            screenshot = self.agent.screenshot(region=(
                region['x'], region['y'], region['width'], region['height']
            ))
        else:
            screenshot = self.agent.screenshot()

        # 转换为 base64
        buffer = BytesIO()
        screenshot.save(buffer, format=format.upper())
        image_base64 = base64.b64encode(buffer.getvalue()).decode('utf-8')

        return {
            'image': image_base64,
            'width': screenshot.width,
            'height': screenshot.height,
            'format': format,
        }

    async def locate_image(self, params: dict) -> Optional[dict]:
        """定位图像"""
        image_path = params.get('image')
        confidence = params.get('confidence', 0.9)

        location = self.image_locator.locate_on_screen(image_path, confidence=confidence)

        if location:
            return {
                'x': location.x,
                'y': location.y,
                'width': location.width,
                'height': location.height,
            }
        return None

    async def get_mouse_position(self, params: dict) -> dict:
        """获取鼠标位置"""
        x, y = self.agent.get_mouse_position()
        return {'x': x, 'y': y}

    # ==================== 录制回放 ====================

    async def start_recording(self, params: dict) -> dict:
        """开始录制"""
        if self.recorder:
            self.recorder.stop()

        self.recorder = ActionRecorder()
        self.recorder.start()
        return {'status': 'recording'}

    async def stop_recording(self, params: dict) -> dict:
        """停止录制"""
        if not self.recorder:
            return {'status': 'not_recording', 'actions': []}

        actions = self.recorder.stop()
        self.recorder = None

        return {
            'status': 'stopped',
            'actions': [
                {
                    'action_type': a.action_type.name,
                    'parameters': a.parameters,
                    'timestamp': a.timestamp,
                }
                for a in actions
            ],
        }

    async def play_recording(self, params: dict) -> dict:
        """回放录制"""
        actions_data = params.get('actions', [])
        speed = params.get('speed', 1.0)

        # 转换为 Action 对象
        actions = []
        for a in actions_data:
            action_type = ActionType[a['action_type']]
            action = Action(action_type=action_type, parameters=a['parameters'])
            action.timestamp = a.get('timestamp', 0)
            actions.append(action)

        # 执行
        results = []
        for action in actions:
            result = self.agent.execute(action)
            results.append({
                'success': result.success,
                'message': result.message,
            })

        return {'status': 'completed', 'results': results}


async def main():
    """主循环：读取 stdin，处理请求，写入 stdout"""
    bridge = GUIAgentBridge()

    # 发送就绪信号
    ready_response = json.dumps({'jsonrpc': '2.0', 'result': 'ready', 'id': 0})
    print(ready_response, flush=True)

    # 读取输入
    loop = asyncio.get_event_loop()
    reader = asyncio.StreamReader()
    protocol = asyncio.StreamReaderProtocol(reader)
    await loop.connect_read_pipe(lambda: protocol, sys.stdin)

    while True:
        try:
            line = await reader.readline()
            if not line:
                break

            line = line.decode('utf-8').strip()
            if not line:
                continue

            try:
                request = json.loads(line)
            except json.JSONDecodeError as e:
                error_response = json.dumps({
                    'jsonrpc': '2.0',
                    'id': None,
                    'error': {'code': -32700, 'message': f'Parse error: {e}'},
                })
                print(error_response, flush=True)
                continue

            # 处理请求
            response = await bridge.handle_request(request)
            print(json.dumps(response), flush=True)

            # 检查是否需要关闭
            if request.get('method') == 'shutdown':
                break

        except Exception as e:
            error_response = json.dumps({
                'jsonrpc': '2.0',
                'id': None,
                'error': {'code': -32603, 'message': f'Internal error: {e}'},
            })
            print(error_response, flush=True)


if __name__ == '__main__':
    asyncio.run(main())
