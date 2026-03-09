/**
 * MCP Resilient Transport 重连测试
 *
 * 自动测试 Streamable HTTP 和 SSE 两种传输协议的 重连 + re-initialize 流程。
 *
 * 用法:
 *   node demo/test-reconnect.mjs                  # 跑全部（streamable-http + sse）
 *   node demo/test-reconnect.mjs streamable-http  # 只跑 streamable-http
 *   node demo/test-reconnect.mjs sse              # 只跑 sse
 *
 * 流程（每种协议）:
 *   1. 启动 demo MCP server
 *   2. 启动 mcp-proxy (convert 模式) 连接 server
 *   3. 发送 initialize + initialized + tools/list 验证连接
 *   4. 等心跳 OK
 *   5. SIGKILL 杀掉 server（模拟崩溃）
 *   6. 等 proxy 重试几轮
 *   7. 重启 server
 *   8. 验证 proxy 自动 re-initialize + 心跳恢复 + tools/list 正常
 */

import { fork, spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');

// ---- 配置 ----

const MODES = {
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
};

// ---- 工具函数 ----

function startServer(config) {
  const p = fork(config.serverScript, [String(config.port)], {
    stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
    cwd: ROOT,
  });
  p.stdout.on('data', d => {
    for (const line of d.toString().trim().split('\n')) {
      console.log(`    [SERVER] ${line}`);
    }
  });
  p.stderr.on('data', d => {
    for (const line of d.toString().trim().split('\n')) {
      console.log(`    [SERVER:err] ${line}`);
    }
  });
  return p;
}

function startProxy(config) {
  const args = [
    join(ROOT, 'dist/index.js'),
    'convert',
    config.url,
    '--protocol', config.protocol,
    '--ping-interval', '3000',
    '--ping-timeout', '2000',
  ];
  return spawn(process.execPath, args, {
    stdio: ['pipe', 'pipe', 'pipe'],
    cwd: ROOT,
    env: { ...process.env, MCP_PROXY_LOG_FILE: '' },
  });
}

function sendJsonrpc(proxy, message) {
  proxy.stdin.write(JSON.stringify(message) + '\n');
}

function ts() {
  return new Date().toISOString().slice(11, 23);
}

async function killProc(p) {
  if (!p || p.killed) return;
  p.kill('SIGTERM');
  await sleep(300);
  try { p.kill('SIGKILL'); } catch {}
}

// ---- 单轮测试 ----

async function runTest(modeName, config) {
  console.log(`\n  ${'─'.repeat(56)}`);
  console.log(`  测试: ${modeName}  (${config.url})`);
  console.log(`  ${'─'.repeat(56)}`);

  let serverProcess = null;
  let proxyProcess = null;
  const proxyLogs = [];

  try {
    // 1. 启动 server
    console.log(`    [${ts()}] STEP 1  启动 MCP Server`);
    serverProcess = startServer(config);
    await sleep(1500);

    // 2. 启动 proxy
    console.log(`    [${ts()}] STEP 2  启动 mcp-proxy (convert)`);
    proxyProcess = startProxy(config);

    proxyProcess.stderr.on('data', d => {
      for (const line of d.toString().trim().split('\n')) {
        proxyLogs.push(line);
        if (/Connected|Heartbeat|Re-initializ|re-initialized|Closed|Retrying|Connect failed|error/i.test(line)) {
          console.log(`    [${ts()}] PROXY   ${line.replace(/.*\[nuwax-mcp-proxy\]\s*/, '')}`);
        }
      }
    });

    proxyProcess.stdout.on('data', d => {
      for (const line of d.toString().trim().split('\n')) {
        if (!line.trim()) continue;
        try {
          const msg = JSON.parse(line);
          if (msg.result?.tools) {
            console.log(`    [${ts()}] RESP    tools/list -> ${msg.result.tools.length} tools: [${msg.result.tools.map(t => t.name).join(', ')}]`);
          } else if (msg.result?.protocolVersion) {
            console.log(`    [${ts()}] RESP    initialize OK -> protocol ${msg.result.protocolVersion}`);
          } else if (msg.error) {
            console.log(`    [${ts()}] RESP    ERROR: ${msg.error.message}`);
          }
        } catch {}
      }
    });

    await sleep(2000);

    // 3. initialize 握手
    console.log(`    [${ts()}] STEP 3  发送 initialize 握手`);
    sendJsonrpc(proxyProcess, {
      jsonrpc: '2.0', id: 'init-1', method: 'initialize',
      params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'test', version: '1.0' } },
    });
    await sleep(1000);
    sendJsonrpc(proxyProcess, { jsonrpc: '2.0', method: 'notifications/initialized' });
    await sleep(500);

    // 4. tools/list
    console.log(`    [${ts()}] STEP 4  发送 tools/list`);
    sendJsonrpc(proxyProcess, { jsonrpc: '2.0', id: 'list-1', method: 'tools/list', params: {} });
    await sleep(1000);

    // 5. 等心跳
    console.log(`    [${ts()}] STEP 5  等待首次心跳...`);
    await sleep(5000);

    // 6. 杀 server
    console.log(`    [${ts()}] STEP 6  SIGKILL 杀掉 server`);
    serverProcess.kill('SIGKILL');
    serverProcess = null;

    // 7. 等重连重试
    console.log(`    [${ts()}] STEP 7  等待 proxy 重试...`);
    await sleep(8000);

    // 8. 重启 server
    console.log(`    [${ts()}] STEP 8  重启 server`);
    serverProcess = startServer(config);
    await sleep(1500);

    // 9. 等 re-initialize + 心跳恢复
    console.log(`    [${ts()}] STEP 9  等待 re-initialize + 心跳恢复...`);
    await sleep(12000);

    // 10. 验证恢复
    console.log(`    [${ts()}] STEP 10 发送 tools/list 验证恢复`);
    sendJsonrpc(proxyProcess, { jsonrpc: '2.0', id: 'list-2', method: 'tools/list', params: {} });
    await sleep(2000);

    // ---- 分析 ----
    const checks = {
      reconnect:    proxyLogs.some(l => /Retrying|Closed/i.test(l)),
      reInitSent:   proxyLogs.some(l => l.includes('Re-initializ')),
      reInitOk:     proxyLogs.some(l => l.includes('MCP session re-initialized')),
      heartbeatOk:  proxyLogs.filter(l => l.includes('Heartbeat OK')).length >= 2,
    };

    return checks;

  } finally {
    await killProc(proxyProcess);
    await killProc(serverProcess);
    await sleep(500);
  }
}

// ---- 主流程 ----

const arg = process.argv[2];
const modesToRun = arg ? [arg] : Object.keys(MODES);

for (const m of modesToRun) {
  if (!MODES[m]) {
    console.error(`\n  未知模式: ${m}  (可选: ${Object.keys(MODES).join(', ')})`);
    process.exit(1);
  }
}

console.log(`\n${'='.repeat(60)}`);
console.log(`  MCP Resilient Transport 重连测试`);
console.log(`  模式: ${modesToRun.join(', ')}`);
console.log(`${'='.repeat(60)}`);

const results = {};
for (const m of modesToRun) {
  results[m] = await runTest(m, MODES[m]);
}

// ---- 汇总表格 ----

const labels = {
  reconnect:   '重连触发',
  reInitSent:  'Re-init 发送',
  reInitOk:    'Re-init 成功',
  heartbeatOk: '心跳恢复',
};
const allPass = modesToRun.every(m => Object.values(results[m]).every(Boolean));

// 计算列宽: 第一列=检查项, 后续列=每个 mode
const col0W = 14; // "Re-init 发送" 占 12 中文宽度，留余量
const colW = modesToRun.map(m => Math.max(m.length, 7)); // 至少 "✅ PASS".length
const totalW = col0W + colW.reduce((a, b) => a + b + 3, 0) + 1; // +3 " | ", +1 边框

const pad = (s, w) => {
  // 中文字符算 2 宽度
  const vis = [...s].reduce((n, c) => n + (c.charCodeAt(0) > 0x7f ? 2 : 1), 0);
  return s + ' '.repeat(Math.max(0, w - vis));
};

const hline = (ch = '─', joint = '┼') => {
  const segs = [ch.repeat(col0W + 2), ...colW.map(w => ch.repeat(w + 2))];
  return `├${segs.join(joint)}┤`;
};

const topline = () => {
  const segs = [' '.repeat(col0W + 2), ...colW.map(w => '─'.repeat(w + 2))];
  return `┌${segs.join('┬')}┐`;
};

const botline = () => {
  const segs = [' '.repeat(col0W + 2), ...colW.map(w => '─'.repeat(w + 2))];
  return `└${segs.join('┴')}┘`;
};

console.log(`\n  测试结果汇总\n`);

// 表头
console.log(`  ${topline()}`);
const headerCols = modesToRun.map((m, i) => ` ${pad(m, colW[i])} `);
console.log(`  │ ${pad('检查项', col0W)} │${headerCols.join('│')}│`);
console.log(`  ${hline()}`);

// 数据行
for (const [key, label] of Object.entries(labels)) {
  const dataCols = modesToRun.map((m, i) => {
    const v = results[m][key] ? '✅ PASS' : '❌ FAIL';
    return ` ${pad(v, colW[i])} `;
  });
  console.log(`  │ ${pad(label, col0W)} │${dataCols.join('│')}│`);
}

console.log(`  ${botline()}`);
console.log(`\n  总结: ${allPass ? '✅ 全部通过!' : '❌ 存在失败项'}\n`);

process.exit(allPass ? 0 : 1);
