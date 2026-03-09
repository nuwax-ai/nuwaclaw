#!/usr/bin/env node
/**
 * Electron Builder afterSign 钩子
 *
 * 在 app 签名完成后：
 * 1. 对 bundled 的原生二进制文件进行额外签名（附带 JIT entitlements）
 * 2. 重新签名主 app 以恢复 seal
 * 3. 调用 Apple Notary API 进行公证
 *
 * 重要：Node.js、uv 等子进程二进制必须带 allow-jit entitlement，
 * 否则 V8 引擎无法分配 JIT 内存，导致 "Failed to reserve virtual memory for CodeRange" 崩溃。
 *
 * 仅在 macOS 上执行，Windows/Linux 不需要额外签名。
 *
 * 环境变量（与 workflow Secrets 统一）：
 * - APPLE_TEAM_ID: Team ID（可选，Electron 公证未使用）
 * - APPLE_SIGNING_IDENTITY: Developer ID Application 证书 identity
 * - APPLE_CERTIFICATE / APPLE_CERTIFICATE_PASSWORD: 由 workflow 导入 keychain，本脚本不直接读取
 * - APPLE_API_KEY: AuthKey .p8 文件路径（公证用，workflow 中由 Base64 解码得到）
 * - APPLE_API_KEY_ID: API Key ID（公证用）
 * - APPLE_ISSUER_ID: Issuer ID（公证用）
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
 * @param {string} filePath - 要签名的文件路径
 * @param {string} identity - 签名证书 identity
 * @param {string|null} entitlementsPath - entitlements 文件路径
 */
function codesign(filePath, identity, entitlementsPath = null) {
  try {
    let cmd = `codesign --force --options runtime --timestamp --sign "${identity}"`;
    if (entitlementsPath && fs.existsSync(entitlementsPath)) {
      cmd += ` --entitlements "${entitlementsPath}"`;
    }
    cmd += ` "${filePath}"`;
    execSync(cmd, { stdio: 'inherit' });
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

  // 子进程 entitlements（Node.js/uv 等需要 JIT 权限）
  const childEntitlements = path.join(process.cwd(), 'build', 'entitlements.child.plist');
  if (fs.existsSync(childEntitlements)) {
    console.log(`[after-sign] 子进程 entitlements: ${childEntitlements}`);
  } else {
    console.warn(`[after-sign] ⚠️ 子进程 entitlements 不存在: ${childEntitlements}`);
    console.warn('[after-sign] Node.js 等子进程将无法使用 V8 JIT！');
  }

  // 1. 签名 better-sqlite3（.node 文件不需要 JIT entitlements）
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

  // 2. 签名 resources/node（需要 JIT entitlements — V8 依赖 allow-jit）
  const nodePath = path.join(resourcesPath, 'node');
  if (fs.existsSync(nodePath)) {
    const nodeExecutables = findExecutables(nodePath);
    console.log(`[after-sign] 找到 Node.js 可执行文件: ${nodeExecutables.length} 个`);
    for (const file of nodeExecutables) {
      if (file.includes('.cache')) continue;
      const relative = path.relative(nodePath, file);
      console.log(`[after-sign] 签名 node/${relative} (with JIT entitlements)`);
      codesign(file, identity, childEntitlements);
    }
  }

  // 3. 签名 resources/uv（不需要 JIT，但需要 runtime 签名）
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

  // 4. 签名 resources/lanproxy（bin/ 与 binaries/ 均可能被运行时使用）
  const lanproxyPath = path.join(resourcesPath, 'lanproxy');
  if (fs.existsSync(lanproxyPath)) {
    const lanproxyFiles = findExecutables(lanproxyPath);
    console.log(`[after-sign] 找到 lanproxy 可执行文件: ${lanproxyFiles.length} 个`);
    for (const file of lanproxyFiles) {
      const relative = path.relative(lanproxyPath, file);
      console.log(`[after-sign] 签名 lanproxy/${relative}`);
      codesign(file, identity);
    }
  }

  // 5. 对主 .app 重新签名，恢复 seal（内部二进制被签过后包内容已变，必须整体再签一次）
  console.log('[after-sign] 对主 app 重新签名以恢复 seal...');
  const entitlementsPath = path.join(process.cwd(), 'build', 'entitlements.mac.plist');
  codesign(appPath, identity, entitlementsPath);

  // 6. 验证整个 app 的签名
  console.log('[after-sign] 验证整个 app 签名...');
  try {
    execSync(`codesign --verify --deep --strict --verbose=2 "${appPath}"`, {
      stdio: 'inherit',
    });
    console.log('[after-sign] 签名验证通过');
  } catch (e) {
    console.warn('[after-sign] 签名验证失败（可能需要忽略特定项）');
  }

  // 7. Apple 公证（Notarization）
  const appleApiKey = process.env.APPLE_API_KEY;
  const appleApiKeyId = process.env.APPLE_API_KEY_ID;
  const appleIssuerId = process.env.APPLE_ISSUER_ID;

  if (appleApiKey && appleApiKeyId && appleIssuerId) {
    console.log('[after-sign] 开始 Apple 公证...');
    console.log(`[after-sign]   API Key ID: ${appleApiKeyId}`);
    console.log(`[after-sign]   Issuer ID: ${appleIssuerId}`);
    console.log(`[after-sign]   Key file: ${appleApiKey} (exists=${fs.existsSync(appleApiKey)})`);
    try {
      const { notarize } = require('@electron/notarize');
      await notarize({
        appPath,
        appleApiKey,
        appleApiKeyId,
        appleApiIssuer: appleIssuerId,
      });
      console.log('[after-sign] 公证成功！');
    } catch (e) {
      console.error('[after-sign] 公证失败:', e.message || e);
      // 当公证凭据已配置时，失败应中止构建
      if (process.env.NOTARIZE_ALLOW_FAILURE !== '1') {
        throw e;
      }
      console.warn('[after-sign] NOTARIZE_ALLOW_FAILURE=1，继续构建');
    }
  } else {
    console.log('[after-sign] 跳过公证（缺少环境变量）:');
    console.log(`[after-sign]   APPLE_API_KEY: ${appleApiKey ? '✓' : '✗ 未设置'}`);
    console.log(`[after-sign]   APPLE_API_KEY_ID: ${appleApiKeyId ? '✓' : '✗ 未设置'}`);
    console.log(`[after-sign]   APPLE_ISSUER_ID: ${appleIssuerId ? '✓' : '✗ 未设置'}`);
  }

  // 8. 验证 Gatekeeper（公证后应该通过）
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
