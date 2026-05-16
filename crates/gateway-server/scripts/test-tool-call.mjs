#!/usr/bin/env node
/**
 * chat2response 工具调用测试脚本
 * 
 * 测试 Responses API 格式的工具调用转换
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

const TEST_PORT = 60011;

// 简单文本请求
const simpleRequest = {
  model: 'deepseek-v4-flash',
  input: 'Say hello in one word',
  stream: false,
};

// 带工具的请求 (Responses API 格式)
const toolRequest = {
  model: 'deepseek-v4-flash',
  input: 'What is 2 + 2? Use the calculator tool.',
  tools: [
    {
      type: 'function',
      function: {
        name: 'calculator',
        description: 'A simple calculator',
        parameters: {
          type: 'object',
          properties: {
            expression: { type: 'string', description: 'Math expression' }
          },
          required: ['expression']
        }
      }
    }
  ],
  stream: false,
};

// 创建测试服务器
function createTestServer() {
  return new Promise((resolve, reject) => {
    const server = http.createServer(async (req, res) => {
      if (req.url === '/health') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ status: 'ok', service: 'test-tool-call' }));
        return;
      }
      
      if (req.method === 'POST' && req.url === '/v1/responses') {
        let body = '';
        req.on('data', c => body += c);
        req.on('end', async () => {
          try {
            const reqBody = JSON.parse(body);
            console.log('\n收到 Responses 请求:');
            console.log('  model:', reqBody.model);
            console.log('  input:', reqBody.input);
            console.log('  tools:', reqBody.tools ? reqBody.tools.length + '个工具' : '无');
            
            const apiKey = process.env.DEEPSEEK_API_KEY;
            if (!apiKey) {
              res.writeHead(401, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ error: { message: 'No API key' } }));
              return;
            }
            
            // 转换为 Chat Completions 格式 (模拟 converter.ts 的行为)
            const messages = [
              { role: 'system', content: 'You are a helpful assistant.' },
              { role: 'user', content: reqBody.input }
            ];
            
            // Chat Completions 工具格式
            const chatTools = reqBody.tools?.map(tool => ({
              type: 'function',
              function: {
                name: tool.function?.name || tool.name,
                description: tool.function?.description || tool.description,
                parameters: tool.function?.parameters || tool.parameters
              }
            }));
            
            console.log('\n转换为 Chat Completions:');
            console.log('  messages:', messages.length);
            console.log('  tools:', chatTools?.length || 0);
            
            const response = await fetch('https://api.deepseek.com/v1/chat/completions', {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${apiKey}`,
              },
              body: JSON.stringify({
                model: reqBody.model,
                messages,
                tools: chatTools,
                tool_choice: 'auto',
                stream: false,
              }),
            });
            
            const data = await response.json();
            
            if (data.error) {
              console.log('\n❌ 厂商返回错误:', data.error.message);
              res.writeHead(500, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify(data));
              return;
            }
            
            console.log('\n厂商响应:');
            if (data.choices?.[0]?.message?.tool_calls) {
              console.log('✅ 工具调用被触发!');
              console.log('  Tool:', JSON.stringify(data.choices[0].message.tool_calls, null, 2));
            } else if (data.choices?.[0]?.message?.content) {
              console.log('📝 文本响应:', data.choices[0].message.content.slice(0, 150));
            }
            
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify(data));
          } catch (e) {
            console.error('Error:', e);
            res.writeHead(500, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: { message: e.message } }));
          }
        });
        return;
      }
      
      res.writeHead(404);
      res.end();
    });
    
    server.on('error', reject);
    server.listen(TEST_PORT, '127.0.0.1', () => resolve(server));
  });
}

async function runTests() {
  console.log('\n========== 工具调用测试 ==========\n');
  
  const server = await createTestServer();
  console.log(`[Test Server] Listening on 127.0.0.1:${TEST_PORT}`);
  
  // 测试 1: 简单请求
  console.log('\n--- 测试 1: 简单文本请求 ---');
  try {
    const response = await fetch(`http://127.0.0.1:${TEST_PORT}/v1/responses`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(simpleRequest),
    });
    const data = await response.json();
    const content = data.choices?.[0]?.message?.content;
    console.log('✅ 响应:', content ? content.slice(0, 100) : '无');
  } catch (e) {
    console.log('❌ 失败:', e.message);
  }
  
  // 测试 2: 带工具请求
  console.log('\n--- 测试 2: 带工具请求 ---');
  try {
    const response = await fetch(`http://127.0.0.1:${TEST_PORT}/v1/responses`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(toolRequest),
    });
    const data = await response.json();
    
    if (data.choices?.[0]?.message?.tool_calls) {
      console.log('✅ 工具调用被触发!');
      console.log('   Tool:', data.choices[0].message.tool_calls[0]?.function?.name);
    } else if (data.choices?.[0]?.message?.content) {
      console.log('📝 模型选择返回文本 (未触发工具):');
      console.log('   ', data.choices[0].message.content.slice(0, 100));
    } else {
      console.log('⚠️  无响应内容');
    }
  } catch (e) {
    console.log('❌ 失败:', e.message);
  }
  
  server.close();
  console.log('\n========== 测试完成 ==========\n');
}

runTests();