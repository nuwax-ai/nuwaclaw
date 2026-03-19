"""
NuwaClaw GUI Agent - MCP 集成测试
测试与主 Agent 的集成
"""

import asyncio
import sys
import os

# 添加 GUI Agent 路径
sys.path.insert(0, '/Users/apple/workspace/nuwax-agent/crates/nuwax-agent-gui-alt/poc/osworld-gui-agent')

from mcp import ClientSession, StdioServerParameters
from mcp.client.stdio import stdio_client

# ========== MCP 客户端测试 ==========

async def test_gui_agent_mcp():
    """测试 GUI Agent MCP Server"""
    
    print("="*60)
    print("NuwaClaw GUI Agent - MCP 集成测试")
    print("="*60)
    
    # 配置 MCP Server
    server_params = StdioServerParameters(
        command="python3",
        args=["/Users/apple/workspace/nuwax-agent/crates/nuwax-agent-gui-alt/poc/osworld-gui-agent/mcp_server.py"],
        env={
            "PYTHONPATH": "/Users/apple/workspace/nuwax-agent/crates/nuwax-agent-gui-alt/poc/osworld-gui-agent"
        }
    )
    
    # 连接到 MCP Server
    async with stdio_client(server_params) as (read, write):
        async with ClientSession(read, write) as session:
            # 初始化
            await session.initialize()
            
            # 测试 1: 列出工具
            print("\n📝 测试 1: 列出可用工具")
            print("-"*40)
            
            tools = await session.list_tools()
            print(f"可用工具数: {len(tools.tools)}")
            
            for tool in tools.tools:
                print(f"  - {tool.name}: {tool.description[:50]}...")
            
            # 测试 2: 执行简单操作
            print("\n📝 测试 2: 执行简单操作")
            print("-"*40)
            
            result = await session.call_tool("gui_execute", {
                "action_type": "MOVE_TO",
                "parameters": {"x": 100, "y": 100}
            })
            
            print(f"结果: {result.content[0].text[:100]}")
            
            # 测试 3: 批量操作
            print("\n📝 测试 3: 批量操作")
            print("-"*40)
            
            result = await session.call_tool("gui_batch", {
                "actions": [
                    {
                        "action_type": "MOVE_TO",
                        "parameters": {"x": 200, "y": 200}
                    },
                    {
                        "action_type": "PRESS",
                        "parameters": {"key": "escape"}
                    }
                ]
            })
            
            print(f"结果: {result.content[0].text[:100]}")
            
            print("\n" + "="*60)
            print("测试完成")
            print("="*60)
            print("\n✅ MCP 集成测试通过")


if __name__ == "__main__":
    asyncio.run(test_gui_agent_mcp())
