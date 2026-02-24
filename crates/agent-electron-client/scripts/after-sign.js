#!/usr/bin/env node
/**
 * Electron Builder afterSign 钩子
 *
 * 在 app 签名完成后，对 bundled 的原生二进制文件进行额外签名：
 * - better-sqlite3 .node 文件
 * - resources/uv 下的可执行文件
 * - resources/lanproxy 可执行文件
 *
 * 仅在 macOS 上执行，Windows/Linux 不需要额外签名。
 *
 * 环境变量：
 * - APPLE_SIGNING_IDENTITY: Developer ID Application 证书 identity
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
function codesign(filePath, identity) {
  try {
    execSync(`codesign --force --options runtime --timestamp --sign "${identity}" "${filePath}"`, {
      stdio: 'inherit',
    });
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
    return;
  }

  const identity = process.env.APPLE_SIGNING_IDENTITY;
  if (!identity) {
    // 没有证书，跳过额外签名
    return;
  }

  // 查找 .app 路径
  let appPath = null;
  if (context.appOutDir && fs.existsSync(context.appOutDir)) {
    const files = fs.readdirSync(context.appOutDir);
    const appFile = files.find(f => f.endsWith('.app'));
    if (appFile) {
      appPath = path.join(context.appOutDir, appFile);
    }
  }

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
      appPath = findApp(releaseDir);
    }
  }

  if (!appPath || !fs.existsSync(appPath)) {
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
        codesign(file, identity);
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
      codesign(file, identity);
    }
  }

  // 3. 签名 resources/lanproxy
  const lanproxyPath = path.join(resourcesPath, 'lanproxy', 'bin');
  if (fs.existsSync(lanproxyPath)) {
    const lanproxyFiles = findExecutables(lanproxyPath);
    console.log(`[after-sign] 找到 lanproxy 可执行文件: ${lanproxyFiles.length} 个`);
    for (const file of lanproxyFiles) {
      console.log(`[after-sign] 签名 lanproxy/${path.basename(file)}`);
      codesign(file, identity);
    }
  }

  // 4. 对主 .app 重新签名，恢复 seal（内部二进制被签过后包内容已变，必须整体再签一次）
  console.log('[after-sign] 对主 app 重新签名以恢复 seal...');
  codesign(appPath, identity);

  // 5. 验证整个 app 的签名
  console.log('[after-sign] 验证整个 app 签名...');
  try {
    execSync(`codesign --verify --deep --strict --verbose=2 "${appPath}"`, {
      stdio: 'inherit',
    });
    console.log('[after-sign] 签名验证通过');
  } catch (e) {
    console.warn('[after-sign] 签名验证失败（可能需要忽略特定项）');
  }

  // 6. 验证 app 可被 Gatekeeper 接受
  console.log('[after-sign] 验证 Gatekeeper 策略...');
  try {
    execSync(`spctl -a -vv "${appPath}"`, {
      stdio: 'inherit',
    });
    console.log('[after-sign] Gatekeeper 验证通过');
  } catch (e) {
    console.warn('[after-sign] Gatekeeper 验证失败（可能需要公证）');
  }

  console.log('[after-sign] 完成');
};
