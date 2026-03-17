/**
 * NuwaClaw GUI Agent - PoC 测试入口
 */

import { GUIAgent } from './agent.js';
import { guiTools } from './tools.js';
import type { AgentEvent } from './types.js';

// 创建 Agent
const agent = new GUIAgent({
  tools: guiTools,

  // Hook: 执行前确认
  beforeToolCall: async (context, signal) => {
    console.log(`\n[HOOK] beforeToolCall: ${context.toolName}`);
    console.log(`  参数:`, JSON.stringify(context.params, null, 2));

    // 模拟用户确认
    const dangerousTools = ['click', 'type_text'];
    if (dangerousTools.includes(context.toolName)) {
      console.log(`\n  ⚠️  危险操作: ${context.toolName}`);
      console.log(`  在实际应用中，这里会弹出确认对话框`);
      // return { block: true, reason: '用户拒绝' };
    }

    return undefined; // 继续执行
  },

  // Hook: 执行后处理
  afterToolCall: async (context, signal) => {
    console.log(`\n[HOOK] afterToolCall: ${context.toolName}`);
    console.log(`  成功: ${!context.isError}`);

    if (context.toolName === 'screenshot' && !context.isError) {
      console.log(`  截图大小: ${(context.result.details as any).size} bytes`);
    }

    return undefined; // 不修改结果
  },

  // 事件监听
  onEvent: (event: AgentEvent) => {
    const timestamp = new Date().toISOString();
    switch (event.type) {
      case 'agent_start':
        console.log(`\n[${timestamp}] 🤖 Agent 开始执行`);
        break;

      case 'agent_end':
        console.log(`\n[${timestamp}] 🏁 Agent 执行结束`);
        console.log(`  成功: ${event.success}`);
        if (event.error) console.log(`  错误: ${event.error}`);
        break;

      case 'tool_execution_start':
        console.log(`\n[${timestamp}] 🔧 开始执行工具: ${event.toolName}`);
        break;

      case 'tool_execution_update':
        console.log(`[${timestamp}] ⏳ 进度更新: ${JSON.stringify(event.partialResult)}`);
        break;

      case 'tool_execution_end':
        console.log(`[${timestamp}] ✅ 工具执行完成: ${event.toolName}`);
        console.log(`  错误: ${event.isError}`);
        break;
    }
  },
});

// 测试用例
async function runTests() {
  console.log('='.repeat(60));
  console.log('NuwaClaw GUI Agent - PoC 测试');
  console.log('='.repeat(60));

  // 测试 1: 截图
  console.log('\n\n📝 测试 1: 截图工具');
  console.log('-'.repeat(40));
  const screenshotResult = await agent.executeTool('screenshot', {
    format: 'webp',
    quality: 80,
  });
  console.log('\n结果:');
  console.log(`  类型: ${screenshotResult.content[0].type}`);
  console.log(`  详情:`, screenshotResult.details);

  // 测试 2: 点击
  console.log('\n\n📝 测试 2: 点击工具');
  console.log('-'.repeat(40));
  const clickResult = await agent.executeTool('click', {
    x: 100,
    y: 200,
    button: 'left',
    numClicks: 1,
  });
  console.log('\n结果:');
  console.log(`  内容: ${(clickResult.content[0] as any).text}`);
  console.log(`  详情:`, clickResult.details);

  // 测试 3: 输入文本
  console.log('\n\n📝 测试 3: 输入文本工具（流式）');
  console.log('-'.repeat(40));
  const typeResult = await agent.executeTool('type_text', {
    text: 'Hello, NuwaClaw!',
    typingSpeed: 50,
  });
  console.log('\n结果:');
  console.log(`  内容: ${(typeResult.content[0] as any).text}`);
  console.log(`  详情:`, typeResult.details);

  // 测试 4: 批量执行
  console.log('\n\n📝 测试 4: 批量执行');
  console.log('-'.repeat(40));
  const batchResults = await agent.execute([
    { tool: 'screenshot', params: { format: 'webp', quality: 60 } },
    { tool: 'click', params: { x: 500, y: 300 } },
    { tool: 'type_text', params: { text: '批量测试', typingSpeed: 30 } },
  ]);

  console.log('\n批量执行结果:');
  batchResults.forEach((result, i) => {
    console.log(`  ${i + 1}. isError: ${result.isError}`);
  });

  // 最终状态
  console.log('\n\n📊 Agent 状态:');
  console.log('-'.repeat(40));
  const state = agent.getState();
  console.log(JSON.stringify(state, null, 2));
}

// 运行测试
runTests().catch(console.error);
