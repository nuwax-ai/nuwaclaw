/**
 * NuwaClaw GUI Agent - Demo
 * 
 * 演示整合后的 Agent 功能
 */

import { GUIAgent, createGUIAgent, EventType, ActionType } from '../packages/core';

async function main() {
  console.log('🦞 NuwaClaw GUI Agent - Unified Demo\n');

  // 创建 Agent（带 Hook 和事件监听）
  const agent = createGUIAgent({
    // beforeToolCall Hook: 权限控制
    beforeToolCall: async (ctx) => {
      console.log(`[Hook] 准备执行: ${ctx.toolName}`);
      
      // 示例：阻止危险操作
      if (ctx.toolName === 'click' && ctx.params.x && ctx.params.x > 5000) {
        return { block: true, reason: '坐标超出屏幕范围' };
      }
      
      // 可以修改参数
      // return { modified: { ...ctx.params, x: 100 } };
    },
    
    // afterToolCall Hook: 结果处理
    afterToolCall: async (ctx) => {
      console.log(`[Hook] 执行完成: ${ctx.toolName}`);
      // 可以修改结果
    },
    
    // 事件监听
    onEvent: (event) => {
      console.log(`[Event] ${event.type}`, event.data);
    },
  });

  console.log('📦 已注册工具:', agent.getTools().map(t => t.name).join(', '));
  console.log('');

  // 示例 1: 单个工具执行
  console.log('📝 示例 1: 执行单个工具');
  try {
    const result = await agent.executeTool('screenshot', { format: 'webp' });
    console.log('结果:', result);
  } catch (err) {
    console.log('错误:', err);
  }
  console.log('');

  // 示例 2: 批量执行
  console.log('📝 示例 2: 批量执行');
  try {
    const results = await agent.execute([
      { tool: 'click', params: { x: 100, y: 200 } },
      { tool: 'type_text', params: { text: 'Hello, NuwaClaw!' } },
      { tool: 'hotkey', params: { keys: ['command', 'enter'] } },
    ]);
    console.log('批量结果:', results.length, '个');
  } catch (err) {
    console.log('错误:', err);
  }
  console.log('');

  // 示例 3: 带进度的执行
  console.log('📝 示例 3: 带进度回调');
  try {
    const result = await agent.executeTool(
      'locate_image',
      { image: 'button.png', confidence: 0.9 },
      (update) => {
        console.log(`  进度: ${update.progress}% - ${update.status}`);
      }
    );
    console.log('结果:', result);
  } catch (err) {
    console.log('错误:', err);
  }
  console.log('');

  // 示例 4: Hook 阻止操作
  console.log('📝 示例 4: Hook 阻止危险操作');
  try {
    await agent.executeTool('click', { x: 99999, y: 99999 });
  } catch (err) {
    console.log('✅ 成功阻止:', (err as Error).message);
  }
  console.log('');

  // 示例 5: 自定义工具
  console.log('📝 示例 5: 注册自定义工具');
  agent.registerTool({
    name: 'custom_action',
    label: '🔧 自定义操作',
    description: '自定义操作示例',
    parameters: { type: 'object' },
    execute: async (callId, params, signal, onUpdate) => {
      onUpdate?.({ progress: 50, status: '执行中' });
      return { content: [{ type: 'text', text: '自定义操作完成' }] };
    },
  });
  
  const customResult = await agent.executeTool('custom_action', {});
  console.log('自定义结果:', customResult);

  console.log('\n✅ Demo 完成!');
}

main().catch(console.error);
