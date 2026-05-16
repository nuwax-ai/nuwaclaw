#!/usr/bin/env node
/**
 * chat2response 国内模型厂商测试脚本
 * 
 * 用法:
 *   node test-providers.mjs                    # 测试所有厂商
 *   node test-providers.mjs mimo              # 测试指定厂商
 * 
 * 环境变量 (.env):
 *   DEEPSEEK_API_KEY, DEEPSEEK_BASE_URL
 *   GLM_API_KEY, GLM_BASE_URL
 *   MINIMAX_API_KEY, MINIMAX_BASE_URL
 *   MIMO_API_KEY, MIMO_BASE_URL
 */

import http from 'http';
import { readFileSync, existsSync } from 'fs';
import path from 'path';

// 配置
const TEST_PORT = 60010;

// 加载 .env
const envPath = path.join(process.cwd(), '.env');
if (existsSync(envPath)) {
  console.log(`[Env] Loading from: ${envPath}`);
  readFileSync(envPath, 'utf8').split('\n').forEach(line => {
    const [key, ...vals] = line.split('=');
    if (key && vals.length && !key.startsWith('#')) {
      process.env[key.trim()] = vals.join('=').trim();
    }
  });
}

const PROVIDERS = {
  deepseek: {
    name: 'DeepSeek',
    baseUrl: process.env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com/v1',
    apiKey: process.env.DEEPSEEK_API_KEY,
    models: ['deepseek-v4-flash', 'deepseek-v4-pro'],
  },
  glm: {
    name: 'GLM (Zhipu)',
    baseUrl: process.env.GLM_BASE_URL || 'https://open.bigmodel.cn/api/paas/v4',
    apiKey: process.env.GLM_API_KEY,
    models: ['glm-5', 'glm-4.6'],
  },
  minimax: {
    name: 'MiniMax',
    baseUrl: process.env.MINIMAX_BASE_URL || 'https://api.minimaxi.com/v1',
    apiKey: process.env.MINIMAX_API_KEY,
    models: ['MiniMax-M2.7', 'MiniMax-M2.5'],
  },
  mimo: {
    name: 'MiMo (小米)',
    baseUrl: process.env.MIMO_BASE_URL || 'https://token-plan-cn.xiaomimimo.com/v1',
    apiKey: process.env.MIMO_API_KEY,
    models: ['mimo-v2.5-pro', 'mimo-v2.5'],
  },
};

// 检测 provider
function detectProvider(model) {
  if (!model) return null;
  const m = model.toLowerCase();
  if (m.includes('minimax')) return 'minimax';
  if (m.includes('mimo')) return 'mimo';
  if (m.includes('glm')) return 'glm';
  if (m.includes('deepseek')) return 'deepseek';
  return null;
}

// 测试单个 provider
async function testProvider(name) {
  const provider = PROVIDERS[name];
  if (!provider) return { name, success: false, error: 'Unknown provider' };
  if (!provider.apiKey) return { name, success: false, error: 'No API key' };

  try {
    console.log(`  测试 ${provider.name} (${provider.models[0]})...`);
    
    const response = await fetch(`${provider.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${provider.apiKey}`,
      },
      body: JSON.stringify({
        model: provider.models[0],
        messages: [{ role: 'user', content: 'say hello' }],
      }),
    });

    const data = await response.json();
    
    if (data.error) {
      return { name, model: provider.models[0], success: false, error: data.error.message };
    }

    const content = data.choices?.[0]?.message?.content || '';
    return { name, model: provider.models[0], success: true, content: content.slice(0, 50) };
  } catch (e) {
    return { name, model: provider.models[0], success: false, error: e.message };
  }
}

// 创建测试服务器
function createTestServer() {
  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      if (req.url === '/health') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ status: 'ok', port: TEST_PORT, providers: Object.keys(PROVIDERS) }));
        return;
      }

      if (req.method === 'POST' && req.url === '/test') {
        let body = '';
        req.on('data', c => body += c);
        req.on('end', async () => {
          try {
            const reqBody = JSON.parse(body);
            const result = await testProvider(reqBody.provider);
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify(result));
          } catch (e) {
            res.writeHead(500, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ success: false, error: e.message }));
          }
        });
        return;
      }

      res.writeHead(404);
      res.end();
    });

    server.on('error', reject);
    server.listen(TEST_PORT, '127.0.0.1', () => {
      console.log(`[Test Server] Listening on 127.0.0.1:${TEST_PORT}`);
      resolve(server);
    });
  });
}

// 主测试流程
async function runTests(filterProvider) {
  console.log('\n========== chat2response 国内模型厂商测试 ==========\n');

  // 启动服务器
  let server;
  try {
    server = await createTestServer();
  } catch (e) {
    console.error(`启动测试服务器失败: ${e.message}`);
    process.exit(1);
  }

  // 准备测试列表
  const tests = [];
  for (const [name, config] of Object.entries(PROVIDERS)) {
    if (!filterProvider || filterProvider === name) {
      if (config.apiKey) {
        tests.push(name);
      } else {
        console.log(`⏭️  ${config.name}: 无 API Key，跳过`);
      }
    }
  }

  // 执行测试
  console.log(`\n开始测试 ${tests.length} 个厂商...\n`);
  const results = [];

  for (const name of tests) {
    const result = await testProvider(name);
    if (result.success) {
      console.log(`  ✅ ${PROVIDERS[name].name}: 通过`);
    } else {
      console.log(`  ❌ ${PROVIDERS[name].name}: ${result.error}`);
    }
    results.push({ ...result, name: PROVIDERS[name].name });
  }

  // 输出汇总
  console.log('\n========== 测试结果汇总 ==========\n');
  
  let passed = 0;
  let failed = 0;
  
  for (const r of results) {
    const status = r.success ? '✅ 通过' : '❌ 失败';
    console.log(`${status} - ${r.name}`);
    if (r.model) console.log(`       模型: ${r.model}`);
    if (r.error) console.log(`       错误: ${r.error}`);
    if (r.content) console.log(`       响应: ${r.content}...`);
    console.log('');
    
    if (r.success) passed++;
    else failed++;
  }

  console.log(`通过: ${passed}/${passed + failed}`);
  console.log('==========================================\n');

  // 清理
  server.close();
  
  // 返回退出码
  process.exit(failed > 0 ? 1 : 0);
}

// 入口
const filter = process.argv[2];
runTests(filter);