"""
NuwaClaw GUI Agent - MCP Server
将 HybridGUIAgent 暴露为 MCP 工具
"""

import asyncio
import json
from typing import List, Dict, Any, Optional
from dataclasses import dataclass

# MCP SDK (需要安装: pip install mcp)
try:
    from mcp.server import Server
    from mcp.server.stdio import stdio_server
    from mcp.types import Tool, TextContent, ImageContent
    MCP_AVAILABLE = True
except ImportError:
    MCP_AVAILABLE = False
    print("⚠️  MCP SDK 未安装，请运行: pip install mcp")

# 导入 HybridGUIAgent
from hybrid_agent import HybridGUIAgent, Action, ActionType
from image_locator import ImageLocator
from action_recorder import ActionRecorder, ActionPlayer

# ========== MCP 工具定义 ==========

@dataclass
class ToolDefinition:
    """工具定义"""
    name: str
    description: str
    parameters: Dict[str, Any]
    handler: callable

# ========== GUI Agent MCP Server ==========

class GUIAgentMCPServer:
    """
    GUI Agent MCP Server
    
    暴露的工具：
    1. gui_execute - 执行单个 GUI 操作
    2. gui_batch - 批量执行操作
    3. gui_screenshot - 截取屏幕
    4. gui_locate - 定位图片
    5. gui_click_image - 点击图片
    6. gui_record_start - 开始录制
    7. gui_record_stop - 停止录制
    8. gui_playback - 回放操作
    """
    
    def __init__(self):
        """初始化 MCP Server"""
        self.agent = HybridGUIAgent(
            beforeAction=self._before_action_hook,
            afterAction=self._after_action_hook,
            onEvent=self._on_event
        )
        
        self.locator = ImageLocator()
        self.recorder = ActionRecorder()
        self.player = ActionPlayer()
        
        # 当前录制会话
        self.current_session = None
        
        # 事件日志
        self.event_log: List[Dict[str, Any]] = []
    
    def _before_action_hook(self, action: Action) -> Optional[str]:
        """执行前 Hook（可扩展权限检查）"""
        # TODO: 集成权限 UI
        return None  # 不阻止
    
    def _after_action_hook(self, action: Action, result):
        """执行后 Hook（可扩展审计日志）"""
        # 记录到事件日志
        self.event_log.append({
            "action_type": action.action_type.value,
            "parameters": action.parameters,
            "success": not result.isError,
            "timestamp": action.timestamp if hasattr(action, 'timestamp') else None
        })
        return None
    
    def _on_event(self, event):
        """事件回调"""
        self.event_log.append({
            "event_type": event.type.value,
            "data": event.data
        })
    
    # ========== 工具实现 ==========
    
    async def gui_execute(self, action_type: str, parameters: Dict[str, Any]) -> Dict[str, Any]:
        """
        执行单个 GUI 操作
        
        Args:
            action_type: 操作类型（CLICK, TYPING, PRESS, 等）
            parameters: 操作参数
            
        Returns:
            执行结果
        """
        try:
            action = Action(
                action_type=ActionType[action_type],
                parameters=parameters
            )
            
            result = self.agent.execute(action)
            
            return {
                "success": not result.isError,
                "message": result.content[0]["text"] if result.content else "",
                "details": result.details
            }
        
        except Exception as e:
            return {
                "success": False,
                "error": str(e)
            }
    
    async def gui_batch(self, actions: List[Dict[str, Any]]) -> Dict[str, Any]:
        """
        批量执行 GUI 操作
        
        Args:
            actions: 操作列表，每个包含 action_type 和 parameters
            
        Returns:
            批量执行结果
        """
        try:
            action_list = [
                Action(
                    action_type=ActionType[a["action_type"]],
                    parameters=a["parameters"]
                )
                for a in actions
            ]
            
            results = self.agent.execute_batch(action_list)
            
            return {
                "success": all(not r.isError for r in results),
                "total": len(results),
                "succeeded": sum(1 for r in results if not r.isError),
                "failed": sum(1 for r in results if r.isError),
                "results": [
                    {
                        "success": not r.isError,
                        "message": r.content[0]["text"] if r.content else "",
                        "details": r.details
                    }
                    for r in results
                ]
            }
        
        except Exception as e:
            return {
                "success": False,
                "error": str(e)
            }
    
    async def gui_screenshot(self, region: Optional[Dict[str, int]] = None) -> Dict[str, Any]:
        """
        截取屏幕
        
        Args:
            region: 可选，截图区域 {x, y, width, height}
            
        Returns:
            截图结果（包含 base64 图片）
        """
        try:
            # TODO: 实现截图
            screenshot_b64 = self.agent.screenshot()
            
            return {
                "success": True,
                "image": screenshot_b64,
                "format": "png"
            }
        
        except Exception as e:
            return {
                "success": False,
                "error": str(e)
            }
    
    async def gui_locate(self, image_path: str, confidence: float = 0.8) -> Dict[str, Any]:
        """
        在屏幕上定位图片
        
        Args:
            image_path: 图片路径
            confidence: 置信度阈值
            
        Returns:
            定位结果
        """
        try:
            result = self.locator.locate_on_screen(image_path, confidence)
            
            return {
                "success": result.found,
                "x": result.x,
                "y": result.y,
                "width": result.width,
                "height": result.height,
                "confidence": result.confidence,
                "message": result.message
            }
        
        except Exception as e:
            return {
                "success": False,
                "error": str(e)
            }
    
    async def gui_click_image(self, image_path: str, confidence: float = 0.8,
                              button: str = "left", offset_x: int = 0, 
                              offset_y: int = 0) -> Dict[str, Any]:
        """
        查找并点击图片
        
        Args:
            image_path: 图片路径
            confidence: 置信度阈值
            button: 鼠标按钮（left/right/middle）
            offset_x: x 偏移
            offset_y: y 偏移
            
        Returns:
            点击结果
        """
        try:
            success = self.locator.click_image(
                image_path, 
                confidence, 
                button, 
                offset_x, 
                offset_y
            )
            
            return {
                "success": success,
                "message": "点击成功" if success else "未找到图片"
            }
        
        except Exception as e:
            return {
                "success": False,
                "error": str(e)
            }
    
    async def gui_record_start(self, session_id: Optional[str] = None) -> Dict[str, Any]:
        """
        开始录制操作
        
        Args:
            session_id: 可选，会话 ID
            
        Returns:
            录制会话信息
        """
        try:
            session_id = self.recorder.start_recording(session_id)
            self.current_session = self.recorder.session
            
            return {
                "success": True,
                "session_id": session_id,
                "message": "录制已开始"
            }
        
        except Exception as e:
            return {
                "success": False,
                "error": str(e)
            }
    
    async def gui_record_stop(self) -> Dict[str, Any]:
        """
        停止录制
        
        Returns:
            录制会话信息
        """
        try:
            session = self.recorder.stop_recording()
            self.current_session = session
            
            return {
                "success": True,
                "session_id": session.session_id,
                "action_count": len(session.actions),
                "start_time": session.start_time,
                "end_time": session.end_time
            }
        
        except Exception as e:
            return {
                "success": False,
                "error": str(e)
            }
    
    async def gui_playback(self, session_id: str, speed: float = 1.0) -> Dict[str, Any]:
        """
        回放录制的操作
        
        Args:
            session_id: 会话 ID
            speed: 回放速度（1.0 = 正常，2.0 = 2 倍速）
            
        Returns:
            回放结果
        """
        try:
            # TODO: 从存储加载会话
            if not self.current_session:
                return {
                    "success": False,
                    "error": "没有可回放的会话"
                }
            
            self.player.play(self.current_session, speed)
            
            return {
                "success": True,
                "session_id": session_id,
                "speed": speed,
                "action_count": len(self.current_session.actions)
            }
        
        except Exception as e:
            return {
                "success": False,
                "error": str(e)
            }
    
    # ========== MCP Server 启动 ==========
    
    async def run(self):
        """运行 MCP Server"""
        if not MCP_AVAILABLE:
            print("❌ MCP SDK 未安装")
            return
        
        # 创建 MCP Server
        server = Server("nuwaclaw-gui-agent")
        
        # 注册工具
        @server.list_tools()
        async def list_tools():
            return [
                Tool(
                    name="gui_execute",
                    description="执行单个 GUI 操作（点击、输入、按键等）",
                    inputSchema={
                        "type": "object",
                        "properties": {
                            "action_type": {
                                "type": "string",
                                "enum": [e.value for e in ActionType]
                            },
                            "parameters": {
                                "type": "object"
                            }
                        },
                        "required": ["action_type", "parameters"]
                    }
                ),
                Tool(
                    name="gui_batch",
                    description="批量执行 GUI 操作",
                    inputSchema={
                        "type": "object",
                        "properties": {
                            "actions": {
                                "type": "array",
                                "items": {
                                    "type": "object",
                                    "properties": {
                                        "action_type": {"type": "string"},
                                        "parameters": {"type": "object"}
                                    }
                                }
                            }
                        },
                        "required": ["actions"]
                    }
                ),
                Tool(
                    name="gui_screenshot",
                    description="截取屏幕",
                    inputSchema={
                        "type": "object",
                        "properties": {
                            "region": {
                                "type": "object",
                                "properties": {
                                    "x": {"type": "number"},
                                    "y": {"type": "number"},
                                    "width": {"type": "number"},
                                    "height": {"type": "number"}
                                }
                            }
                        }
                    }
                ),
                Tool(
                    name="gui_locate",
                    description="在屏幕上定位图片",
                    inputSchema={
                        "type": "object",
                        "properties": {
                            "image_path": {"type": "string"},
                            "confidence": {"type": "number", "default": 0.8}
                        },
                        "required": ["image_path"]
                    }
                ),
                Tool(
                    name="gui_click_image",
                    description="查找并点击图片",
                    inputSchema={
                        "type": "object",
                        "properties": {
                            "image_path": {"type": "string"},
                            "confidence": {"type": "number", "default": 0.8},
                            "button": {"type": "string", "default": "left"},
                            "offset_x": {"type": "number", "default": 0},
                            "offset_y": {"type": "number", "default": 0}
                        },
                        "required": ["image_path"]
                    }
                ),
            ]
        
        @server.call_tool()
        async def call_tool(name: str, arguments: Dict[str, Any]):
            if name == "gui_execute":
                result = await self.gui_execute(**arguments)
            elif name == "gui_batch":
                result = await self.gui_batch(**arguments)
            elif name == "gui_screenshot":
                result = await self.gui_screenshot(**arguments)
            elif name == "gui_locate":
                result = await self.gui_locate(**arguments)
            elif name == "gui_click_image":
                result = await self.gui_click_image(**arguments)
            else:
                result = {"success": False, "error": f"Unknown tool: {name}"}
            
            return [TextContent(type="text", text=json.dumps(result, indent=2))]
        
        # 启动服务器
        async with stdio_server() as (read_stream, write_stream):
            await server.run(
                read_stream,
                write_stream,
                server.create_initialization_options()
            )


# ========== 主函数 ==========

if __name__ == "__main__":
    server = GUIAgentMCPServer()
    asyncio.run(server.run())
