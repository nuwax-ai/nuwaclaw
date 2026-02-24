#!/usr/bin/env node
/**
 * Electron Builder afterSign 钩子
 *
 * 在 app 签名完成后，对 bundled 的原生二进制文件进行额外签名：
 * - better-sqlite3 .node 文件
 * - resources/uv 下的可执行文件
 * - resources/lanproxy 可执行文件
 *
 * 环境变量：
 * - APPLE_SIGNING_IDENTITY: Developer ID Application 证书 identity (如 "Developer ID Application: Team Name (HASH)")
 * - 若未设置，跳过额外签名（仅使用 electron-builder 默认签名）
 *
 * @param {Object} context - electron-builder 上下文
 */

const path = require('path');
const fs = require('fs');
const { execSync } = require('child_process');

/**
 * 检查文件是否为可执行文件
 */
function isExecutable(filePath) {
  try {
    const st = fs.statSync(filePath);
    if (!st.isFile()) return false;
    const mode = st.mode;
    return (mode & 0o111) !== 0;
  } catch {
    return false;
  }
}

/**
 * 递归查找目录下所有可执行文件
 */
function findExecutables(dir, list = []) {
  if (!fs.existsSync(dir)) return list;
  for (const name of fs.readdirSync(dir)) {
    const full = path.join(dir, name);
    try {
      const st = fs.statSync(full);
      if (st.isDirectory()) {
        findExecutables(full, list);
      } else if (st.isFile() && isExecutable(full)) {
        list.push(full);
      }
    } catch (_) {}
  }
  return list;
}

/**
 * 使用 codesign 对文件进行签名
 */
function codesign(filePath, options = {}) {
  const {
    force = true,
    optionsRuntime = true,
    timestamp = true,
  } = options;

  const args = [];
  if (force) args.push('--force');
  if (optionsRuntime) args.push('--options', 'runtime');
  if (timestamp) args.push('--timestamp');
  args.push('--sign', options.identity);
  args.push(filePath);

  try {
    execSync(`codesign ${args.join(' ')}`, { stdio: 'inherit' });
    return true;
  } catch (e) {
    console.error(`[after-sign] 签名失败: ${filePath}`);
    console.error(e.message);
    return false;
  }
}

/**
 * 主函数 (导出给 electron-builder)
 */
exports.default = async function (context) {
  // 仅在 macOS 上执行
  if (process.platform !== 'darwin') {
    console.log('[after-sign] 非 macOS 平台，跳过');
    return;
  }

  const appPath = context.appOutDir && fs.existsSync(context.appOutDir)
    ? path.join(context.appOutDir, fs.readdirSync(context.appOutDir).find(f => f.endsWith('.app')))
    : null;

  if (!appPath || !fs.existsSync(appPath)) {
    // 回退：在 release 目录中查找最新的 .app
    const releaseDir = path.join(process.cwd(), 'release');
    if (fs.existsSync(releaseDir)) {
      const findApp = (dir) => {
        const entries = fs.readdirSync(dir, { withFileTypes: true });
        for (const entry of entries) {
          const full = path.join(dir, entry.name);
          if (entry.isDirectory()) {
            if (entry.name.endsWith('.app')) {
              return full;
            }
            if (entry.name !== 'Builder' && entry.name !== '.cache') {
              const found = findApp(full);
              if (found) return found;
            }
          }
        }
        return null;
      };
      const foundApp = findApp(releaseDir);
      if (foundApp) {
        appPath = foundApp;
      }
    }
  }

  if (!appPath || !fs.existsSync(appPath)) {
    console.warn('[after-sign] 未找到 app 路径，跳过额外签名');
    return;
  }

  const identity = process.env.APPLE_SIGNING_IDENTITY;
  if (!identity) {
    console.log('[after-sign] 未设置 APPLE_SIGNING_IDENTITY，使用 electron-builder 默认签名');
    return;
  }

  console.log(`[after-sign] 开始额外签名，identity: ${identity}`);
  console.log(`[after-sign] App path: ${appPath}`);

  const resourcesPath = path.join(appPath, 'Contents', 'Resources');

  // 1. 签名 better-sqlite3
  const sqlitePath = path.join(resourcesPath, 'app.asar.unpacked', 'node_modules', 'better-sqlite3', 'build', 'Release');
  if (fs.existsSync(sqlitePath)) {
    const sqliteFiles = findExecutables(sqlitePath);
    console.log(`[after-sign] 找到 better-sqlite3 可执行文件: ${sqliteFiles.length} 个`);
    for (const file of sqliteFiles) {
      if (file.endsWith('.node')) {
        console.log(`[after-sign] 签名: ${path.basename(file)}`);
        codesign(file, { identity });
      }
    }
  }

  // 2. 签名 resources/uv
  const uvPath = path.join(resourcesPath, 'uv');
  if (fs.existsSync(uvPath)) {
    const uvExecutables = findExecutables(uvPath);
    console.log(`[after-sign] 找到 uv 可执行文件: ${uvExecutables.length} 个`);
    for (const file of uvExecutables) {
      if (file.includes('.cache')) continue;
      const relative = path.relative(uvPath, file);
      console.log(`[after-sign] 签名 uv/${relative}`);
      codesign(file, { identity });
    }
  }

  // 3. 签名 resources/lanproxy
  const lanproxyPath = path.join(resourcesPath, 'lanproxy', 'bin');
  if (fs.existsSync(lanproxyPath)) {
    const lanproxyFiles = findExecutables(lanproxyPath);
    console.log(`[after-sign] 找到 lanproxy 可执行文件: ${lanproxyFiles.length} 个`);
    for (const file of lanproxyFiles) {
      console.log(`[after-sign] 签名 lanproxy/${path.basename(file)}`);
      codesign(file, { identity });
    }
  }

  // 4. 验证整个 app 的签名
  console.log('[after-sign] 验证整个 app 签名...');
  try {
    execSync(`codesign --verify --deep --strict --verbose=2 "${appPath}"`, {
      stdio: 'inherit',
    });
    console.log('[after-sign] 签名验证通过');
  } catch (e) {
    console.warn('[after-sign] 签名验证失败（可能需要忽略特定项）');
  }

  console.log('[after-sign] 完成');
};
