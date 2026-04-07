#!/usr/bin/env node
/**
 * Windows 代码签名工具模块
 *
 * 提供 Windows 平台代码签名功能，使用 signtool 对文件进行签名。
 * 支持从 Windows 证书存储（通过证书指纹）或 PFX 文件进行签名。
 *
 * 环境变量：
 * - WINDOWS_CERTIFICATE_SHA1: 证书指纹（优先使用证书存储）
 * - WINDOWS_CERTIFICATE_PATH: PFX 文件路径（可选）
 * - WINDOWS_CERTIFICATE_PASSWORD: PFX 文件密码（可选）
 * - WINDOWS_TIMESTAMP_URL: 时间戳服务器 URL（默认: http://timestamp.sectigo.com）
 * - WINDOWS_PUBLISHER_NAME: 发布者名称（可选，用于日志）
 *
 * 相关文件：
 * - sign-release-win.sh: 完整签名流程脚本
 * - ../docs/windows-signing.md: 使用文档
 *
 * @module sign-win
 */

const path = require('path');
const fs = require('fs');
const { execFileSync, execSync } = require('child_process');

/**
 * 可执行文件扩展名
 */
const EXECUTABLE_EXTENSIONS = new Set(['.exe', '.dll', '.sys', '.cab', '.msi', '.node']);

/**
 * 检查文件是否为可执行文件
 * @param {string} filePath - 文件路径
 * @returns {boolean}
 */
function isExecutable(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  return EXECUTABLE_EXTENSIONS.has(ext);
}

/**
 * 递归查找目录下所有可执行文件
 * @param {string} dir - 目录路径
 * @param {string[]} list - 结果列表
 * @returns {string[]}
 */
function findExecutables(dir, list = []) {
  if (!fs.existsSync(dir)) return list;

  for (const name of fs.readdirSync(dir)) {
    const fullPath = path.join(dir, name);
    try {
      const stat = fs.statSync(fullPath);
      if (stat.isDirectory()) {
        // 跳过某些目录
        if (name !== '.cache' && name !== 'node_modules' && name !== '.git') {
          findExecutables(fullPath, list);
        }
      } else if (stat.isFile() && isExecutable(fullPath)) {
        list.push(fullPath);
      }
    } catch (e) {
      // 忽略权限错误等，但记录日志
      if (process.env.DEBUG) {
        console.debug(`[sign-win] 跳过文件（错误）: ${fullPath} - ${e.message}`);
      }
    }
  }
  return list;
}

/**
 * 查找 signtool 工具
 * @returns {string|null} signtool 路径
 */
function findSigntool() {
  // 优先使用 PATH 中的 signtool（最可靠，自动适配版本）
  try {
    execSync('where signtool', { stdio: 'ignore' });
    return 'signtool';
  } catch (_) {
    // PATH 中没有，尝试常见安装路径
  }

  const possiblePaths = [
    // electron-builder 内置的 signtool
    path.join(process.cwd(), 'node_modules', 'app-builder-bin', 'win', 'signtool.exe'),
    // Windows SDK 安装路径（按版本从新到旧）
    'C:\\Program Files (x86)\\Windows Kits\\10\\bin\\10.0.26100.0\\x64\\signtool.exe',
    'C:\\Program Files (x86)\\Windows Kits\\10\\bin\\x64\\signtool.exe',
    'C:\\Program Files (x86)\\Windows Kits\\10\\bin\\10.0.22621.0\\x64\\signtool.exe',
    'C:\\Program Files (x86)\\Windows Kits\\10\\bin\\10.0.22000.0\\x64\\signtool.exe',
    'C:\\Program Files (x86)\\Windows Kits\\10\\bin\\10.0.19041.0\\x64\\signtool.exe',
    'C:\\Program Files (x86)\\Windows Kits\\8.1\\bin\\x64\\signtool.exe',
  ];

  for (const p of possiblePaths) {
    if (fs.existsSync(p)) {
      return p;
    }
  }

  return null;
}

/**
 * 获取签名配置
 * @returns {{ certSha1: string, certPath: string|null, certPassword: string|null, timestampUrl: string, publisherName: string }}
 */
function getSignConfig() {
  const certSha1 =
    process.env.WINDOWS_CERTIFICATE_SHA1 ||
    process.env.CS_CERT_SHA1 ||
    '';
  const certPath =
    process.env.WINDOWS_CERTIFICATE_PATH ||
    process.env.CS_CERT_PATH ||
    null;
  const certPassword =
    process.env.WINDOWS_CERTIFICATE_PASSWORD ||
    process.env.CS_CERT_PASSWORD ||
    null;
  const timestampUrl =
    process.env.WINDOWS_TIMESTAMP_URL ||
    process.env.CS_TIMESTAMP_URL ||
    'http://timestamp.sectigo.com';
  const publisherName =
    process.env.WINDOWS_PUBLISHER_NAME ||
    process.env.CS_PUBLISHER_NAME ||
    '';

  return { certSha1, certPath, certPassword, timestampUrl, publisherName };
}

/**
 * 仅用于日志：展示 signtool 参数并脱敏密码
 * @param {string[]} args
 * @returns {string}
 */
function formatSigntoolArgsForLog(args) {
  const masked = [];
  for (let i = 0; i < args.length; i++) {
    const current = args[i];
    masked.push(current);
    if (current === '/p' && i + 1 < args.length) {
      i += 1;
      masked.push('***');
    }
  }
  return masked
    .map((arg) => (/\s/.test(arg) ? `"${arg}"` : arg))
    .join(' ');
}

function normalizeTimestampUrl(url) {
  if (!url) return url;
  const trimmed = String(url).trim();
  if (!trimmed) return trimmed;

  // Some Windows SDK signtool builds reject RFC3161 `/tr` with https URLs
  // (e.g. "Invalid Timestamp URL: https://timestamp.sectigo.com").
  // Sectigo provides an http endpoint that is broadly compatible.
  try {
    const u = new URL(trimmed);
    if (u.hostname === 'timestamp.sectigo.com' && u.protocol === 'https:') {
      u.protocol = 'http:';
      return u.toString().replace(/\/$/, '');
    }
  } catch (_) {
    // If it's not a valid URL, keep it as-is and let signtool error out.
  }

  return trimmed;
}

function execSigntool(signtoolPath, args) {
  console.log(`[sign-win]   命令: "${signtoolPath}" ${formatSigntoolArgsForLog(args)}`);
  execFileSync(signtoolPath, args, { stdio: 'inherit' });
}

/**
 * 使用 signtool 对文件进行签名
 * @param {string} filePath - 要签名的文件路径
 * @param {Object} options - 签名选项
 * @param {string} [options.certSha1] - 证书指纹
 * @param {string} [options.certPath] - PFX 文件路径
 * @param {string} [options.certPassword] - PFX 文件密码
 * @param {string} [options.timestampUrl] - 时间戳服务器 URL
 * @param {string} [options.publisherName] - 发布者名称
 * @returns {{ success: boolean, message: string }}
 */
function signWithSigntool(filePath, options = {}) {
  const config = getSignConfig();
  const certSha1 = options.certSha1 || config.certSha1;
  const certPath = options.certPath || config.certPath;
  const certPassword = options.certPassword || config.certPassword;
  const timestampUrl = normalizeTimestampUrl(options.timestampUrl || config.timestampUrl);
  const publisherName = options.publisherName || config.publisherName;

  if (!fs.existsSync(filePath)) {
    return { success: false, message: `文件不存在: ${filePath}` };
  }

  const signtoolPath = findSigntool();
  if (!signtoolPath) {
    return { success: false, message: '未找到 signtool 工具' };
  }

  try {
    // 构建签名参数（使用参数数组避免 shell 转义问题）
    const baseArgs = ['sign', '/v', '/fd', 'sha256'];

    // 使用证书指纹（推荐）
    if (certSha1) {
      baseArgs.push('/sha1', certSha1);
    }
    // 使用 PFX 文件（CI 环境）
    else if (certPath) {
      if (!fs.existsSync(certPath)) {
        return { success: false, message: `证书文件不存在: ${certPath}` };
      }
      baseArgs.push('/f', certPath);
      if (certPassword) {
        baseArgs.push('/p', certPassword);
      }
    } else {
      return { success: false, message: '未配置证书：需要 WINDOWS_CERTIFICATE_SHA1 或 WINDOWS_CERTIFICATE_PATH' };
    }

    console.log(`[sign-win] 签名: ${path.basename(filePath)}`);
    if (publisherName) {
      console.log(`[sign-win]   发布者: ${publisherName}`);
    }

    const tryArgsList = [];
    if (timestampUrl) {
      // Preferred: RFC3161 timestamping (sha256)
      tryArgsList.push([...baseArgs, '/tr', timestampUrl, '/td', 'sha256', filePath]);
      // Fallback for older signtool / url parsing quirks: Authenticode timestamping
      tryArgsList.push([...baseArgs, '/t', timestampUrl, filePath]);
    } else {
      tryArgsList.push([...baseArgs, filePath]);
    }

    let lastError = null;
    for (const args of tryArgsList) {
      try {
        execSigntool(signtoolPath, args);
        lastError = null;
        break;
      } catch (e) {
        lastError = e;
        const msg = String(e && e.message ? e.message : e);
        const looksLikeInvalidTimestampUrl =
          /Invalid Timestamp URL/i.test(msg) ||
          /timestamp/i.test(msg) && /URL/i.test(msg);
        if (!looksLikeInvalidTimestampUrl) {
          break;
        }
        console.warn(`[sign-win]   时间戳失败，将尝试降级重试（上一条错误: ${msg}）`);
      }
    }

    if (lastError) {
      throw lastError;
    }

    return { success: true, message: `签名成功: ${filePath}` };
  } catch (e) {
    return { success: false, message: `签名失败: ${e.message}` };
  }
}

/**
 * 批量签名目录中的所有可执行文件
 * @param {string} dir - 目录路径
 * @param {Object} options - 签名选项（同 signWithSigntool）
 * @returns {{ success: number, failed: number, results: Array }}
 */
function signDirectory(dir, options = {}) {
  console.log(`[sign-win] 扫描目录: ${dir}`);
  const executables = findExecutables(dir);
  console.log(`[sign-win] 找到 ${executables.length} 个可执行文件`);

  const results = [];
  let success = 0;
  let failed = 0;

  for (const file of executables) {
    const result = signWithSigntool(file, options);
    results.push({ file, ...result });
    if (result.success) {
      success++;
    } else {
      failed++;
      console.error(`[sign-win] ${result.message}`);
    }
  }

  console.log(`[sign-win] 签名完成: 成功 ${success}, 失败 ${failed}`);
  return { success, failed, results };
}

// 导出
module.exports = {
  isExecutable,
  findExecutables,
  findSigntool,
  getSignConfig,
  signWithSigntool,
  signDirectory,
};

// 如果直接运行此脚本
if (require.main === module) {
  const args = process.argv.slice(2);
  if (args.length === 0) {
    console.log('用法:');
    console.log('  node sign-win.js <file|directory> [...]');
    console.log('');
    console.log('环境变量:');
    console.log('  WINDOWS_CERTIFICATE_SHA1  - 证书指纹（推荐）');
    console.log('  WINDOWS_CERTIFICATE_PATH  - PFX 文件路径');
    console.log('  WINDOWS_CERTIFICATE_PASSWORD - PFX 文件密码');
    console.log('  WINDOWS_TIMESTAMP_URL     - 时间戳服务器');
    process.exit(1);
  }

  const config = getSignConfig();
  if (!config.certSha1 && !config.certPath) {
    console.error('错误: 需要设置 WINDOWS_CERTIFICATE_SHA1 或 WINDOWS_CERTIFICATE_PATH');
    process.exit(1);
  }

  let hasError = false;

  for (const target of args) {
    if (!fs.existsSync(target)) {
      console.error(`错误: 路径不存在: ${target}`);
      hasError = true;
      continue;
    }

    const stat = fs.statSync(target);
    if (stat.isDirectory()) {
      const result = signDirectory(target);
      if (result.failed > 0) {
        hasError = true;
      }
    } else {
      const result = signWithSigntool(target);
      if (!result.success) {
        console.error(result.message);
        hasError = true;
      }
    }
  }

  if (hasError) {
    process.exit(1);
  }
}
