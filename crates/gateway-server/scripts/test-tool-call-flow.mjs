#!/usr/bin/env node
/**
 * chat2response 工具调用完整流程测试
 * 
 * 测试工具调用的完整多轮对话流程:
 * 1. 发送带工具的请求
 * 2. 模型返回 reasoning + function_call
 * 3. 执行工具
 * 4. 返回工具结果 + reasoning_content 给模型
 * 5. 模型生成最终回复
 */

import http from 'http';
import { readFileSync, existsSync } from 'fs';
import path from 'path';

// 加载 .env
const envPath = path.join(process.cwd(), '.env');
if (existsSync(envPath)) {
  readFileSync(envPath, 'utf8').split('\n').forEach(line => {
    const [key, ...vals] = line.split('=');
    if (key && vals.length && !key.startsWith('#')) {
      process.env[key.trim()] = vals.join('=').trim();
    }
  });
}

const SERVER_URL = process.env.SERVER_URL || 'http://127.0.0.1:60012';

// 模拟工具执行
async function executeTool(name, args) {
  console.log(`\n[工具执行] ${name}(${JSON.stringify(args)})`);
  
  try {
    switch (name) {
      case 'bash': {
        const { command } = args;
        const { execSync } = await import('child_process');
        const result = execSync(command, { encoding: 'utf8', timeout: 10000 });
        return { success: true, output: result };
      }
      case 'git_status': {
        const { execSync } = await import('child_process');
        const result = execSync('git status --short', { encoding: 'utf8', cwd: process.cwd() });
        return { success: true, output: result || '(clean)' };
      }
      default:
        return { success: false, output: `Unknown tool: ${name}` };
    }
  } catch (e) {
    return { success: false, output: e.message };
  }
}

// 发送请求
async function sendRequest(body) {
  const response = await fetch(`${SERVER_URL}/v1/responses`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return response.json();
}

// 提取 reasoning content
function extractReasoning(output) {
  const reasoning = output.find(item => item.type === 'reasoning');
  if (reasoning?.content) {
    return reasoning.content.map(c => c.text).join('');
  }
  return null;
}

// 提取工具调用
function extractToolCalls(output) {
  return output.filter(item => item.type === 'function_call');
}

// 提取文本回复
function extractTextReply(output) {
  const msg = output.find(item => item.type === 'message');
  if (msg?.content) {
    return msg.content.map(c => c.text).join('');
  }
  return null;
}

// 测试用例
const testCases = [
  {
    name: 'Bash - 简单计算',
    input: 'What is 2+2? Use bash to calculate it.',
    tools: [{
      type: 'function',
      name: 'bash',
      description: 'Execute bash commands',
      parameters: {
        type: 'object',
        properties: {
          command: { type: 'string', description: 'The bash command to execute' }
        },
        required: ['command']
      }
    }]
  },
  {
    name: 'Bash - 列出目录',
    input: 'List files in current directory using bash.',
    tools: [{
      type: 'function',
      name: 'bash',
      description: 'Execute bash commands',
      parameters: {
        type: 'object',
        properties: {
          command: { type: 'string', description: 'The bash command to execute' }
        },
        required: ['command']
      }
    }]
  },
];

async function runTests() {
  console.log('\n========== 工具调用完整流程测试 ==========\n');
  console.log(`服务器: ${SERVER_URL}\n`);

  let passed = 0;
  let failed = 0;

  for (const tc of testCases) {
    console.log(`\n${'='.repeat(50)}`);
    console.log(`测试: ${tc.name}`);
    console.log('='.repeat(50));

    try {
      // Step 1: 发送带工具的请求
      console.log('\n[Step 1] 发送带工具的请求...');
      const step1Result = await sendRequest({
        model: 'deepseek-v4-flash',
        input: tc.input,
        tools: tc.tools,
        stream: false,
      });

      console.log(`  状态: ${step1Result.status}`);
      console.log(`  输出类型: ${(step1Result.output || []).map(o => o.type).join(', ')}`);
      
      // 提取 reasoning_content (用于思考模型如 DeepSeek)
      const reasoningContent = extractReasoning(step1Result.output || []);
      console.log(`  reasoning: ${reasoningContent?.slice(0, 50) || '(无)'}...`);
      
      const toolCalls = extractToolCalls(step1Result.output || []);
      
      if (toolCalls.length === 0) {
        const textReply = extractTextReply(step1Result.output || []);
        console.log(`  ⚠️  模型未触发工具，直接返回文本`);
        console.log(`  回复: ${textReply?.slice(0, 100) || '(无)'}`);
        passed++;
        continue;
      }

      console.log(`  ✅ 模型触发工具: ${toolCalls.length} 个`);

      // Step 2-3: 处理每个工具调用
      for (const toolCall of toolCalls) {
        console.log(`\n[Step 2] 执行工具: ${toolCall.name}`);
        
        // 解析参数
        let args = {};
        try {
          args = JSON.parse(toolCall.arguments || '{}');
        } catch (e) {
          args = { raw: toolCall.arguments };
        }
        
        const execResult = await executeTool(toolCall.name, args);
        console.log(`  执行结果: ${execResult.output?.slice(0, 100) || '(空)'}...`);

        // Step 3: 返回工具结果给模型 (包含 reasoning_content)
        console.log(`\n[Step 3] 返回工具结果给模型 (带 reasoning_content)...`);
        
        const step3Input = [
          { type: 'message', role: 'user', content: tc.input },
        ];
        
        // 添加带 reasoning_content 的 function_call
        const functionCallItem = {
          type: 'function_call',
          name: toolCall.name,
          arguments: toolCall.arguments,
          call_id: toolCall.call_id,
        };
        
        // 如果有 reasoning_content，需要传递
        if (reasoningContent) {
          functionCallItem.reasoning_content = reasoningContent;
        }
        
        step3Input.push(functionCallItem);
        step3Input.push({
          type: 'function_call_output',
          call_id: toolCall.call_id,
          output: execResult.output
        });
        
        const step3Result = await sendRequest({
          model: 'deepseek-v4-flash',
          input: step3Input,
          tools: tc.tools,
          stream: false,
        });

        console.log(`  状态: ${step3Result.status}`);
        
        if (step3Result.error) {
          console.log(`  ❌ 错误: ${step3Result.error.message}`);
          failed++;
          continue;
        }
        
        const textReply = extractTextReply(step3Result.output || []);
        if (textReply) {
          console.log(`  ✅ 最终回复: ${textReply.slice(0, 150)}...`);
        } else {
          const nextToolCalls = extractToolCalls(step3Result.output || []);
          if (nextToolCalls.length > 0) {
            console.log(`  📝 模型触发更多工具: ${nextToolCalls.map(t => t.name).join(', ')}`);
          } else {
            console.log(`  ⚠️  无文本回复`);
          }
        }
      }

      passed++;
    } catch (e) {
      console.log(`\n  ❌ 测试失败: ${e.message}`);
      failed++;
    }
  }

  console.log('\n' + '='.repeat(50));
  console.log('测试结果汇总');
  console.log('='.repeat(50));
  console.log(`通过: ${passed}/${passed + failed}`);
  console.log(`失败: ${failed}/${passed + failed}`);
  console.log('==========================================\n');

  process.exit(failed > 0 ? 1 : 0);
}

runTests();