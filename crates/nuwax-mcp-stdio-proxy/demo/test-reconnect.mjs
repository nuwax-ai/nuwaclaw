/**
 * 自动化测试: 重连 + re-initialize 验证
 *
 * 流程:
 *   1. 启动 demo MCP server
 *   2. 启动 mcp-proxy (convert 模式) 连接 server
 *   3. 通过 stdin 发送 initialize + initialized + tools/list
 *   4. 等待心跳 OK
 *   5. 杀掉 server → proxy 进入重连
 *   6. 等待几秒后重启 server
 *   7. 观察 proxy 自动 re-initialize + heartbeat 恢复
 *   8. 输出结果
 *
 * 用法:
 *   node demo/test-reconnect.mjs [streamable-http|sse]
 */

import { fork, spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');

const mode = process.argv[2] || 'streamable-http';

const config = {
  'streamable-http': {
    serverScript: join(__dirname, 'streamable-http-server.mjs'),
    port: 18080,
    url: 'http://127.0.0.1:18080/mcp',
    protocol: 'stream',
  },
  'sse': {
    serverScript: join(__dirname, 'sse-server.mjs'),
    port: 18081,
    url: 'http://127.0.0.1:18081/sse',
    protocol: 'sse',
  },
}[mode];

if (!config) {
  console.error(`❌ Unknown mode: ${mode}. Use "streamable-http" or "sse"`);
  process.exit(1);
}

console.log(`\n${'='.repeat(60)}`);
console.log(`  测试模式: ${mode}`);
console.log(`  Server URL: ${config.url}`);
console.log(`${'='.repeat(60)}\n`);

// ---- Helpers ----

function startServer() {
  const p = fork(config.serverScript, [String(config.port)], {
    stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
    cwd: ROOT,
  });
  p.stdout.on('data', d => {
    for (const line of d.toString().trim().split('\n')) {
      console.log(`  [SERVER] ${line}`);
    }
  });
  p.stderr.on('data', d => {
    for (const line of d.toString().trim().split('\n')) {
      console.log(`  [SERVER:err] ${line}`);
    }
  });
  return p;
}

function startProxy() {
  // 使用 convert 模式，低心跳间隔加速测试
  const args = [
    join(ROOT, 'dist/index.js'),
    'convert',
    config.url,
    '--protocol', config.protocol,
    '--ping-interval', '3000',
    '--ping-timeout', '2000',
  ];

  const p = spawn(process.execPath, args, {
    stdio: ['pipe', 'pipe', 'pipe'],
    cwd: ROOT,
    env: { ...process.env, MCP_PROXY_LOG_FILE: '' },
  });

  return p;
}

/** Send a JSONRPC message to proxy stdin, read response from stdout */
function sendToProxy(proxy, message) {
  const json = JSON.stringify(message);
  proxy.stdin.write(json + '\n');
}

// ---- Main ----

const events = [];
function log(tag, msg) {
  const ts = new Date().toISOString().slice(11, 23);
  events.push({ ts, tag, msg });
  console.log(`  [${ts}] [${tag}] ${msg}`);
}

let serverProcess = null;
let proxyProcess = null;

try {
  // Step 1: 启动 server
  log('STEP', '1. 启动 MCP Server');
  serverProcess = startServer();
  await sleep(1500);

  // Step 2: 启动 proxy
  log('STEP', '2. 启动 mcp-proxy (convert 模式)');
  proxyProcess = startProxy();

  // Collect proxy stderr (logs)
  const proxyLogs = [];
  proxyProcess.stderr.on('data', d => {
    for (const line of d.toString().trim().split('\n')) {
      proxyLogs.push(line);
      // 只打印关键日志
      if (line.includes('Connected') || line.includes('Heartbeat') ||
          line.includes('Re-initializ') || line.includes('Closed') ||
          line.includes('Retrying') || line.includes('re-initialized') ||
          line.includes('Connect failed') || line.includes('error')) {
        log('PROXY', line.replace(/.*\[nuwax-mcp-proxy\]\s*/, ''));
      }
    }
  });

  // Collect proxy stdout (JSONRPC responses)
  proxyProcess.stdout.on('data', d => {
    for (const line of d.toString().trim().split('\n')) {
      if (line.trim()) {
        try {
          const msg = JSON.parse(line);
          if (msg.result?.tools) {
            log('RESPONSE', `tools/list → ${msg.result.tools.length} tools: [${msg.result.tools.map(t => t.name).join(', ')}]`);
          } else if (msg.result?.protocolVersion) {
            log('RESPONSE', `initialize OK → protocol ${msg.result.protocolVersion}, server: ${msg.result.serverInfo?.name}`);
          } else if (msg.error) {
            log('RESPONSE', `ERROR: ${msg.error.message}`);
          }
        } catch {}
      }
    }
  });

  await sleep(2000);

  // Step 3: 发送 initialize 握手
  log('STEP', '3. 发送 initialize 握手');
  sendToProxy(proxyProcess, {
    jsonrpc: '2.0',
    id: 'init-1',
    method: 'initialize',
    params: {
      protocolVersion: '2024-11-05',
      capabilities: {},
      clientInfo: { name: 'test-client', version: '1.0.0' },
    },
  });
  await sleep(1000);

  sendToProxy(proxyProcess, {
    jsonrpc: '2.0',
    method: 'notifications/initialized',
  });
  await sleep(500);

  // Step 4: 发送 tools/list 验证连接正常
  log('STEP', '4. 发送 tools/list 验证连接');
  sendToProxy(proxyProcess, {
    jsonrpc: '2.0',
    id: 'list-1',
    method: 'tools/list',
    params: {},
  });
  await sleep(1000);

  // Step 5: 等待心跳
  log('STEP', '5. 等待首次心跳...');
  await sleep(5000);

  // Step 6: 杀掉 server
  log('STEP', '6. ⚡ 杀掉 MCP Server (模拟崩溃)');
  serverProcess.kill('SIGKILL');
  serverProcess = null;

  // Step 7: 等待 proxy 检测到断连并尝试重连
  log('STEP', '7. 等待 proxy 检测断连并重试...');
  await sleep(8000);

  // Step 8: 重启 server
  log('STEP', '8. 重启 MCP Server');
  serverProcess = startServer();
  await sleep(1500);

  // Step 9: 等待 proxy 自动重连 + re-initialize + heartbeat 恢复
  log('STEP', '9. 等待 proxy 自动重连 + re-initialize...');
  await sleep(12000);

  // Step 10: 验证连接恢复——再发一次 tools/list
  log('STEP', '10. 发送 tools/list 验证恢复');
  sendToProxy(proxyProcess, {
    jsonrpc: '2.0',
    id: 'list-2',
    method: 'tools/list',
    params: {},
  });
  await sleep(2000);

  // ---- 结果分析 ----
  console.log(`\n${'='.repeat(60)}`);
  console.log('  测试结果分析');
  console.log(`${'='.repeat(60)}`);

  const hasReInit = proxyLogs.some(l => l.includes('Re-initializ'));
  const hasReInitOk = proxyLogs.some(l => l.includes('re-initialized') || l.includes('MCP session re-initialized'));
  const hasHeartbeatAfterReconnect = proxyLogs.filter(l => l.includes('Heartbeat OK')).length >= 2;
  const hasReconnect = proxyLogs.some(l => l.includes('Retrying') || l.includes('Closed'));

  console.log(`  重连触发:          ${hasReconnect ? '✅ YES' : '❌ NO'}`);
  console.log(`  Re-initialize 发送: ${hasReInit ? '✅ YES' : '❌ NO'}`);
  console.log(`  Re-initialize 成功: ${hasReInitOk ? '✅ YES' : '❌ NO'}`);
  console.log(`  心跳恢复:          ${hasHeartbeatAfterReconnect ? '✅ YES' : '❌ NO'}`);

  const allPass = hasReconnect && hasReInit && hasReInitOk && hasHeartbeatAfterReconnect;
  console.log(`\n  总结: ${allPass ? '✅ 全部通过!' : '❌ 存在失败项'}`);
  console.log(`${'='.repeat(60)}\n`);

} finally {
  // Cleanup
  if (proxyProcess) {
    proxyProcess.kill('SIGTERM');
    await sleep(500);
    try { proxyProcess.kill('SIGKILL'); } catch {}
  }
  if (serverProcess) {
    serverProcess.kill('SIGTERM');
    await sleep(500);
    try { serverProcess.kill('SIGKILL'); } catch {}
  }
}
