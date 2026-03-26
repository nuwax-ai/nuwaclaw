#!/usr/bin/env node
/**
 * Windows 签名验证脚本
 *
 * 使用 signtool 验证 Windows 可执行文件的数字签名。
 *
 * 用法:
 *   node verify-sign-win.js <file|directory> [...]
 *
 * 示例:
 *   node verify-sign-win.js release/1.0.0/windows-x64/NuwaClaw Setup 1.0.0.exe
 *   node verify-sign-win.js release/1.0.0/windows-x64/
 *
 * @module verify-sign-win
 */

const path = require('path');
const fs = require('fs');
const { execSync } = require('child_process');

/**
 * 可执行文件扩展名
 */
const EXECUTABLE_EXTENSIONS = new Set(['.exe', '.dll', '.sys', '.cab', '.msi', '.node']);

/**
 * 检查文件是否为可执行文件
 */
function isExecutable(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  return EXECUTABLE_EXTENSIONS.has(ext);
}

/**
 * 递归查找目录下所有可执行文件
 */
function findExecutables(dir, list = []) {
  if (!fs.existsSync(dir)) return list;

  for (const name of fs.readdirSync(dir)) {
    const fullPath = path.join(dir, name);
    try {
      const stat = fs.statSync(fullPath);
      if (stat.isDirectory()) {
        if (name !== '.cache' && name !== 'node_modules' && name !== '.git') {
          findExecutables(fullPath, list);
        }
      } else if (stat.isFile() && isExecutable(fullPath)) {
        list.push(fullPath);
      }
    } catch (e) {
      // 忽略权限错误等，但记录日志
      if (process.env.DEBUG) {
        console.debug(`[verify-sign-win] 跳过文件（错误）: ${fullPath} - ${e.message}`);
      }
    }
  }
  return list;
}

/**
 * 查找 signtool 工具
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
 * 验证单个文件的签名
 */
function verifySignature(filePath) {
  if (!fs.existsSync(filePath)) {
    return { valid: false, error: '文件不存在' };
  }

  const signtoolPath = findSigntool();
  if (!signtoolPath) {
    return { valid: false, error: '未找到 signtool 工具' };
  }

  try {
    // 使用 signtool verify 验证签名
    const cmd = `"${signtoolPath}" verify /pa /v "${filePath}"`;
    const output = execSync(cmd, { encoding: 'utf-8', stdio: 'pipe' });

    // 解析输出
    const lines = output.split('\n');

    let signerName = '未知';
    let thumbprint = '未知';
    let valid = false;

    for (const line of lines) {
      if (line.includes('Signer Certificate:')) {
        const match = line.match(/Signer Certificate:\s*(.+)/);
        if (match) signerName = match[1].trim();
      }
      if (line.includes('Sha1:')) {
        const match = line.match(/Sha1:\s*([a-fA-F0-9]+)/);
        if (match) thumbprint = match[1];
      }
      if (line.includes('Successfully verified')) {
        valid = true;
      }
    }

    return {
      valid,
      signerName,
      thumbprint,
      output,
    };
  } catch (e) {
    // signtool 返回非 0 退出码表示验证失败
    const error = e.stderr || e.stdout || e.message;
    return {
      valid: false,
      error: error.includes('No signature found')
        ? '未找到签名'
        : '签名验证失败',
      output: error,
    };
  }
}

/**
 * 格式化输出签名信息
 */
function formatSignatureInfo(filePath, result) {
  const relativePath = path.relative(process.cwd(), filePath);
  console.log(`\n${relativePath}`);

  if (result.valid) {
    console.log(`  ✓ 签名有效`);
    console.log(`  签名者: ${result.signerName}`);
    console.log(`  指纹: ${result.thumbprint}`);
  } else {
    console.log(`  ✗ ${result.error || '签名无效'}`);
  }
}

/**
 * 主函数
 */
function main() {
  if (process.platform !== 'win32') {
    console.error('错误: 此脚本仅支持 Windows 平台');
    process.exit(1);
  }

  const args = process.argv.slice(2);
  if (args.length === 0) {
    console.log('用法: node verify-sign-win.js <file|directory> [...]');
    console.log('');
    console.log('示例:');
    console.log('  node verify-sign-win.js release/1.0.0/windows-x64/');
    console.log('  node verify-sign-win.js "NuwaClaw Setup 1.0.0.exe"');
    process.exit(1);
  }

  console.log('Windows 签名验证');
  console.log('=');

  let totalValid = 0;
  let totalInvalid = 0;

  for (const target of args) {
    if (!fs.existsSync(target)) {
      console.error(`\n错误: 路径不存在: ${target}`);
      totalInvalid++;
      continue;
    }

    const stat = fs.statSync(target);

    if (stat.isDirectory()) {
      console.log(`\n扫描目录: ${target}`);
      const files = findExecutables(target);
      console.log(`找到 ${files.length} 个可执行文件`);

      for (const file of files) {
        const result = verifySignature(file);
        formatSignatureInfo(file, result);

        if (result.valid) {
          totalValid++;
        } else {
          totalInvalid++;
        }
      }
    } else {
      const result = verifySignature(target);
      formatSignatureInfo(target, result);

      if (result.valid) {
        totalValid++;
      } else {
        totalInvalid++;
      }
    }
  }

  console.log('\n' + '=');
  console.log(`总计: ${totalValid} 个有效签名, ${totalInvalid} 个无效/未签名`);

  // 如果有无效签名，返回非 0 退出码
  if (totalInvalid > 0) {
    process.exit(1);
  }
}

// 如果直接运行此脚本
if (require.main === module) {
  main();
}

module.exports = {
  isExecutable,
  findExecutables,
  findSigntool,
  verifySignature,
};
