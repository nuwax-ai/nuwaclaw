#!/usr/bin/env node
/**
 * 启动前端口检查脚本（聚合逻辑的 CLI 入口）
 *
 * 端口默认值与解析规则与 src/shared/startupPorts.ts 保持一致，请同步修改。
 * 从 ~/.nuwaclaw/nuwaclaw.db（Windows: %USERPROFILE%\.nuwaclaw\）读取配置。
 * 端口占用检查：优先统一用 bash 执行 scripts/tools/check-port.sh（Windows 需先 npm run prepare:git 集成 Git Bash），
 * 无 bash 或脚本时回退到 Node 内联 netstat/lsof。
 * 依赖：Node；读取 DB 需系统 sqlite3（Windows 上多数未预装，无则用默认端口）。
 */

const path = require('path');
const fs = require('fs');
const { execSync, spawnSync } = require('child_process');
const { getProjectRoot } = require('../utils/project-paths');

const isWin = process.platform === 'win32';
const home = process.env.HOME || process.env.USERPROFILE;
const dbPath = path.join(home, '.nuwaclaw', 'nuwaclaw.db');
const projectRoot = getProjectRoot();
const checkPortShPath = path.join(__dirname, 'check-port.sh');
const winBashPath = path.join(projectRoot, 'resources', 'git', 'bin', 'bash.exe');

// 与 shared/constants + shared/startupPorts 保持一致
const DEFAULTS = {
  agent: 60001,
  fileServer: 60000,
  mcp: 18099,
  lanproxyLocal: 60002,
  vite: 60173,
};

const LABELS = {
  agent: 'Agent(ComputerServer)',
  fileServer: 'FileServer',
  mcp: 'MCP Proxy',
  lanproxyLocal: 'Lanproxy',
  vite: 'Vite',
};

function getSetting(dbPath, key) {
  try {
    // key 仅来自内部常量，仍做引号转义以防将来扩展；Windows 路径含反斜杠，双引号包裹路径即可
    const safeKey = String(key).replace(/'/g, "''");
    const quotedPath = dbPath.replace(/\\/g, '/'); // sqlite3 在 Windows 上通常也接受正斜杠
    const out = execSync(`sqlite3 "${quotedPath}" "SELECT value FROM settings WHERE key='${safeKey}';"`, {
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
      ...(isWin && { shell: true }), // Windows 下若 sqlite3 为 .cmd 或路径含空格，需 shell
    }).trim();
    if (!out) return null;
    try {
      return JSON.parse(out);
    } catch {
      return out;
    }
  } catch {
    return null;
  }
}

function resolvePortsFromSettings(getSettingFn) {
  const step1 = getSettingFn('step1_config');
  const agent = (step1 && step1.agentPort != null) ? step1.agentPort : DEFAULTS.agent;
  const fileServer = (step1 && step1.fileServerPort != null) ? step1.fileServerPort : DEFAULTS.fileServer;

  const mcpRaw = getSettingFn('mcp_proxy_port');
  let mcp = DEFAULTS.mcp;
  if (typeof mcpRaw === 'number' && Number.isInteger(mcpRaw)) mcp = mcpRaw;
  else if (typeof mcpRaw === 'string') { const n = parseInt(mcpRaw, 10); if (!Number.isNaN(n)) mcp = n; }

  return {
    agent,
    fileServer,
    mcp,
    lanproxyLocal: DEFAULTS.lanproxyLocal,
    vite: DEFAULTS.vite,
  };
}

function getPortsToCheck(ports, includeVite) {
  const list = [
    { name: 'agent', label: LABELS.agent, port: ports.agent },
    { name: 'fileServer', label: LABELS.fileServer, port: ports.fileServer },
    { name: 'mcp', label: LABELS.mcp, port: ports.mcp },
    { name: 'lanproxyLocal', label: LABELS.lanproxyLocal, port: ports.lanproxyLocal },
  ];
  if (includeVite) list.push({ name: 'vite', label: LABELS.vite, port: ports.vite });
  return list;
}

/** 优先用 bash 执行 scripts/tools/check-port.sh（与 main 进程一致），否则回退 Node 内联逻辑 */
function isPortInUse(port) {
  const bashPath = isWin ? (fs.existsSync(winBashPath) ? winBashPath : null) : 'bash';
  const scriptContent = fs.existsSync(checkPortShPath)
    ? fs.readFileSync(checkPortShPath, 'utf8')
    : null;

  if (bashPath && scriptContent) {
    const result = spawnSync(bashPath, ['-c', scriptContent, '_', String(port)], {
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    if (result.status === 0 && result.stdout) {
      const text = (result.stdout && String(result.stdout)).trim();
      const pid = text && /^\d+$/.test(text) ? parseInt(text, 10) : undefined;
      return { inUse: true, pid };
    }
    return { inUse: false };
  }

  // 回退：无 bash 或脚本时用 Node 内联 netstat/lsof
  try {
    if (isWin) {
      const out = execSync(`netstat -ano 2>nul | findstr ":${port} "`, {
        encoding: 'utf8',
        stdio: ['pipe', 'pipe', 'pipe'],
        shell: true,
      });
      const text = (out && String(out)).trim();
      const inUse = text.length > 0;
      let pid;
      if (inUse) {
        const firstLine = text.split(/\r?\n/)[0] || '';
        const lastCol = firstLine.split(/\s+/).filter(Boolean).pop();
        if (lastCol && /^\d+$/.test(lastCol)) pid = parseInt(lastCol, 10);
      }
      return { inUse, pid };
    }
    const out = execSync(`lsof -t -i :${port} 2>/dev/null`, { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] });
    const text = (out && String(out)).trim();
    const inUse = text.length > 0;
    const pid = inUse && /^\d+$/.test(text) ? parseInt(text.split('\n')[0], 10) : undefined;
    return { inUse, pid };
  } catch {
    return { inUse: false };
  }
}

function main() {
  const includeVite = process.argv.includes('--vite');
  const getSettingFn = (key) => getSetting(dbPath, key);

  let ports;
  let source = '';
  if (!fs.existsSync(dbPath)) {
    ports = { ...DEFAULTS };
    source = '未找到 DB，使用默认端口';
  } else {
    try {
      ports = resolvePortsFromSettings(getSettingFn);
      source = `已从 ${dbPath} 读取配置`;
    } catch (err) {
      ports = { ...DEFAULTS };
      source = '读取 DB 失败（如未安装 sqlite3），使用默认端口';
    }
  }
  console.log('端口来源:', source);

  const list = getPortsToCheck(ports, includeVite);
  console.log('检查端口:', list.map(({ label, port }) => `${label}=${port}`).join(', '));
  console.log('');

  let hasInUse = false;
  for (const { label, port } of list) {
    const { inUse, pid } = isPortInUse(port);
    if (inUse) {
      hasInUse = true;
      console.log(`  [占用] ${label} (${port}) ${pid ? `PID=${pid}` : ''}`);
    } else {
      console.log(`  [空闲] ${label} (${port})`);
    }
  }

  process.exit(hasInUse ? 1 : 0);
}

main();
