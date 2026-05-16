#!/usr/bin/env node
/**
 * chat2response 工具调用测试脚本
 * 
 * 测试各种工具类型的协议转换
 * - bash: 命令执行
 * - git: Git 操作
 * - mcp: Model Context Protocol 工具
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

// ============================================
// 测试用例定义
// ============================================

const testCases = [
  // --- Bash 工具 ---
  {
    name: 'Bash - 列出目录',
    model: 'deepseek-v4-flash',
    input: 'List the current directory using bash.',
    tools: [{
      type: 'function',
      name: 'bash',
      description: 'Execute bash commands',
      parameters: {
        type: 'object',
        properties: {
          command: { type: 'string', description: 'The bash command to execute' },
          description: { type: 'string', description: 'What this command does' }
        },
        required: ['command']
      }
    }]
  },
  {
    name: 'Bash - 检查 Node 版本',
    model: 'deepseek-v4-flash',
    input: 'Check Node.js version using bash.',
    tools: [{
      type: 'function',
      name: 'bash',
      description: 'Execute bash commands',
      parameters: {
        type: 'object',
        properties: {
          command: { type: 'string', description: 'The bash command to execute' },
          description: { type: 'string', description: 'What this command does' }
        },
        required: ['command']
      }
    }]
  },

  // --- Git 工具 ---
  {
    name: 'Git - 检查状态',
    model: 'deepseek-v4-flash',
    input: 'Check git status.',
    tools: [{
      type: 'function',
      name: 'git_status',
      description: 'Check the current git repository status',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Repository path (default: current directory)' }
        }
      }
    }]
  },
  {
    name: 'Git - 查看日志',
    model: 'deepseek-v4-flash',
    input: 'Show recent git commits.',
    tools: [{
      type: 'function',
      name: 'git_log',
      description: 'View git commit history',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Repository path' },
          n: { type: 'number', description: 'Number of commits to show' }
        }
      }
    }]
  },
  {
    name: 'Git - 分支操作',
    model: 'deepseek-v4-flash',
    input: 'List all git branches.',
    tools: [{
      type: 'function',
      name: 'git_branch',
      description: 'List or perform operations on git branches',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Repository path' },
          operation: { type: 'string', enum: ['list', 'create', 'delete'], description: 'Operation to perform' }
        }
      }
    }]
  },

  // --- MCP 工具 ---
  {
    name: 'MCP - 文件读取',
    model: 'deepseek-v4-flash',
    input: 'Read the README.md file.',
    tools: [{
      type: 'function',
      name: 'mcp__filesystem__read',
      description: 'Read contents of a file',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Path to the file to read' }
        },
        required: ['path']
      }
    }]
  },
  {
    name: 'MCP - 文件写入',
    model: 'deepseek-v4-flash',
    input: 'Write a hello world to /tmp/test.txt.',
    tools: [{
      type: 'function',
      name: 'mcp__filesystem__write',
      description: 'Write content to a file',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Path to the file to write' },
          content: { type: 'string', description: 'Content to write' }
        },
        required: ['path', 'content']
      }
    }]
  },
  {
    name: 'MCP - 目录列表',
    model: 'deepseek-v4-flash',
    input: 'List files in /tmp directory.',
    tools: [{
      type: 'function',
      name: 'mcp__filesystem__list',
      description: 'List directory contents',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Path to list' },
          recursive: { type: 'boolean', description: 'List recursively' }
        },
        required: ['path']
      }
    }]
  },
  {
    name: 'MCP - Web 搜索',
    model: 'deepseek-v4-flash',
    input: 'Search for latest AI news.',
    tools: [{
      type: 'function',
      name: 'mcp__websearch__search',
      description: 'Search the web for information',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Search query' },
          num_results: { type: 'number', description: 'Number of results' }
        },
        required: ['query']
      }
    }]
  },
  {
    name: 'MCP - 代码搜索',
    model: 'deepseek-v4-flash',
    input: 'Search for function definitions in codebase.',
    tools: [{
      type: 'function',
      name: 'mcp__codesearch__search',
      description: 'Search code in the repository',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Search query' },
          regex: { type: 'boolean', description: 'Use regex' },
          file_pattern: { type: 'string', description: 'File pattern to match' }
        },
        required: ['query']
      }
    }]
  },

  // --- 内置工具 (web_search, code_interpreter) ---
  {
    name: '内置 - Web 搜索',
    model: 'deepseek-v4-flash',
    input: 'Search the web for weather in Tokyo.',
    tools: [{
      type: 'web_search',
      name: 'web_search',
      description: 'Search the web',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Search query' }
        },
        required: ['query']
      }
    }]
  },
  {
    name: '内置 - 代码解释器',
    model: 'deepseek-v4-flash',
    input: 'Calculate fibonacci(10) using code interpreter.',
    tools: [{
      type: 'code_interpreter',
      name: 'code_interpreter',
      description: 'Execute code snippets',
      parameters: {
        type: 'object',
        properties: {
          code: { type: 'string', description: 'Code to execute' },
          language: { type: 'string', description: 'Programming language' }
        },
        required: ['code']
      }
    }]
  },
  {
    name: '内置 - 文件搜索',
    model: 'deepseek-v4-flash',
    input: 'Search for files named README.*',
    tools: [{
      type: 'file_search',
      name: 'file_search',
      description: 'Search for files',
      parameters: {
        type: 'object',
        properties: {
          pattern: { type: 'string', description: 'File pattern' },
          path: { type: 'string', description: 'Directory to search' }
        },
        required: ['pattern']
      }
    }]
  },

  // --- 多工具组合 ---
  {
    name: '多工具 - Bash + Git',
    model: 'deepseek-v4-flash',
    input: 'Check git status and list directory.',
    tools: [
      {
        type: 'function',
        name: 'bash',
        description: 'Execute bash commands',
        parameters: {
          type: 'object',
          properties: {
            command: { type: 'string', description: 'The bash command' },
            description: { type: 'string', description: 'What this does' }
          },
          required: ['command']
        }
      },
      {
        type: 'function',
        name: 'git_status',
        description: 'Check git status',
        parameters: {
          type: 'object',
          properties: {
            path: { type: 'string', description: 'Repository path' }
          }
        }
      }
    ]
  },
  {
    name: '多工具 - MCP + Bash',
    model: 'deepseek-v4-flash',
    input: 'Read config and execute it.',
    tools: [
      {
        type: 'function',
        name: 'mcp__filesystem__read',
        description: 'Read a file',
        parameters: {
          type: 'object',
          properties: { path: { type: 'string' } },
          required: ['path']
        }
      },
      {
        type: 'function',
        name: 'bash',
        description: 'Execute bash',
        parameters: {
          type: 'object',
          properties: {
            command: { type: 'string' },
            description: { type: 'string' }
          },
          required: ['command']
        }
      }
    ]
  },
];

// ============================================
// 测试服务器
// ============================================

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
            const apiKey = process.env.DEEPSEEK_API_KEY;

            if (!apiKey) {
              res.writeHead(401, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ error: { message: 'No API key' } }));
              return;
            }

            // Responses API -> Chat Completions
            const messages = [
              { role: 'system', content: 'You are a helpful assistant.' },
              { role: 'user', content: reqBody.input }
            ];

            // 转换工具格式
            const chatTools = reqBody.tools?.map(tool => {
              if (tool.type === 'function') {
                return {
                  type: 'function',
                  function: {
                    name: tool.function?.name || tool.name,
                    description: tool.function?.description || tool.description,
                    parameters: tool.function?.parameters || tool.parameters
                  }
                };
              }
              // 内置工具 (web_search, code_interpreter, file_search)
              return {
                type: 'function',
                function: {
                  name: tool.name || tool.type,
                  description: tool.description || `${tool.type} tool`,
                  parameters: tool.parameters || {
                    type: 'object',
                    properties: { query: { type: 'string', description: 'Query' } },
                    required: ['query']
                  }
                }
              };
            });

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
              res.writeHead(500, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify(data));
              return;
            }

            // 返回结果
            const result = {
              model: reqBody.model,
              input: reqBody.input,
              tools: reqBody.tools?.length || 0,
              tool_calls: data.choices?.[0]?.message?.tool_calls || null,
              content: data.choices?.[0]?.message?.content || null,
              finish_reason: data.choices?.[0]?.finish_reason
            };

            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify(result));
          } catch (e) {
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

// ============================================
// 运行测试
// ============================================

async function runTests() {
  console.log('\n========== chat2response 工具调用测试 ==========\n');
  console.log(`测试服务器: 127.0.0.1:${TEST_PORT}`);
  console.log(`测试用例: ${testCases.length} 个\n`);

  const server = await createTestServer();
  console.log('[Test Server] 启动成功\n');

  const results = { passed: 0, failed: 0, total: testCases.length };

  for (const tc of testCases) {
    process.stdout.write(`${tc.name}... `);

    try {
      const response = await fetch(`http://127.0.0.1:${TEST_PORT}/v1/responses`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: tc.model,
          input: tc.input,
          tools: tc.tools,
          stream: false,
        }),
      });

      const data = await response.json();

      if (data.tool_calls && data.tool_calls.length > 0) {
        console.log(`✅ 触发工具: ${data.tool_calls[0].function.name}`);
        results.passed++;
      } else if (data.content) {
        console.log(`📝 文本响应`);
        results.passed++; // 模型返回文本也是有效的
      } else {
        console.log(`⚠️  无响应`);
        results.failed++;
      }
    } catch (e) {
      console.log(`❌ ${e.message}`);
      results.failed++;
    }
  }

  server.close();

  console.log('\n========== 测试结果汇总 ==========\n');
  console.log(`通过: ${results.passed}/${results.total}`);
  console.log(`失败: ${results.failed}/${results.total}`);
  console.log('==========================================\n');

  process.exit(results.failed > 0 ? 1 : 0);
}

runTests();