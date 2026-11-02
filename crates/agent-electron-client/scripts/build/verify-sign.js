#!/usr/bin/env node
/**
 * 验证已打包应用的签名状态
 *
 * 用法: npm run verify:sign <app-path>
 *
 * 示例: npm run verify:sign release/mac-universal/Nuwax Agent.app
 */

const path = require('path');
const fs = require('fs');
const { execSync } = require('child_process');

// 仅在 macOS 上执行
if (process.platform !== 'darwin') {
  console.error('[verify-sign] 此脚本仅在 macOS 上可用');
  process.exit(1);
}

const appPath = process.argv[2];
if (!appPath) {
  // 自动查找最新的 .app
  const releaseDir = path.join(process.cwd(), 'release');
  if (!fs.existsSync(releaseDir)) {
    console.error('[verify-sign] release 目录不存在');
    console.error('[verify-sign] 用法: npm run verify:sign <app-path>');
    process.exit(1);
  }

  // 查找所有 .app
  const apps = [];
  function findApps(dir) {
    for (const name of fs.readdirSync(dir)) {
      const full = path.join(dir, name);
      const st = fs.lstatSync(full);
      if (st.isDirectory()) {
        if (name.endsWith('.app')) {
          apps.push(full);
        } else if (name !== 'Builder' && name !== '.cache') {
          findApps(full);
        }
      }
    }
  }
  findApps(releaseDir);

  if (apps.length === 0) {
    console.error('[verify-sign] 未找到已打包的应用');
    console.error('[verify-sign] 请先执行 npm run dist:mac');
    process.exit(1);
  }

  // 使用最新的（按修改时间排序）
  apps.sort((a, b) => {
    const statA = fs.statSync(a);
    const statB = fs.statSync(b);
    return statB.mtimeMs - statA.mtimeMs;
  });

  // eslint-disable-next-line no-param-reassign
  appPath = apps[0];
  console.log(`[verify-sign] 自动检测到: ${appPath}\n`);
}

if (!fs.existsSync(appPath)) {
  console.error(`[verify-sign] 应用不存在: ${appPath}`);
  process.exit(1);
}

console.log(`========================================`);
console.log(`签名验证: ${path.basename(appPath)}`);
console.log(`========================================\n`);

// 1. 验证整体签名
console.log('1. 验证整体签名 (codesign --verify --deep)');
try {
  const output = execSync(
    `codesign --verify --deep --strict --verbose=2 "${appPath}" 2>&1 || true`,
    { encoding: 'utf-8' }
  );
  console.log(output);
  if (output.includes('valid on disk') || output.includes('satisfies its Designated Requirement')) {
    console.log('✅ 整体验证通过\n');
  } else if (output.includes('code object is not signed at all')) {
    console.log('⚠️  应用未签名\n');
  } else {
    console.log('⚠️  签名验证存在警告（见上方输出）\n');
  }
} catch (e) {
  console.log(`❌ 验证失败: ${e.message}\n`);
}

// 2. 显示签名信息
console.log('2. 显示签名信息 (codesign --display --verbose=4)');
try {
  const output = execSync(`codesign --display --verbose=4 "${appPath}" 2>&1`, {
    encoding: 'utf-8',
  });
  console.log(output);
} catch (e) {
  console.error(`❌ 获取签名信息失败: ${e.message}\n`);
}

// 3. 检查特定文件的签名
console.log('\n3. 检查 bundled 二进制文件签名:');

const resourcesPath = path.join(appPath, 'Contents', 'Resources');

// better-sqlite3
const sqlitePath = path.join(
  resourcesPath,
  'app.asar.unpacked',
  'node_modules',
  'better-sqlite3',
  'build',
  'Release'
);
if (fs.existsSync(sqlitePath)) {
  console.log('\n  better-sqlite3:');
  const files = fs.readdirSync(sqlitePath).filter((f) => f.endsWith('.node'));
  for (const file of files) {
    const filePath = path.join(sqlitePath, file);
    try {
      const info = execSync(`codesign -dr - "${filePath}" 2>&1`, { encoding: 'utf-8' });
      console.log(`    ✅ ${file}: 已签名`);
    } catch {
      console.log(`    ❌ ${file}: 未签名或签名无效`);
    }
  }
}

// uv
const uvPath = path.join(resourcesPath, 'uv');
if (fs.existsSync(uvPath)) {
  console.log('\n  resources/uv:');
  const uvBinPath = path.join(uvPath, 'bin', 'uv');
  if (fs.existsSync(uvBinPath)) {
    try {
      execSync(`codesign -v "${uvBinPath}"`, { stdio: 'ignore' });
      console.log(`    ✅ uv: 已签名`);
    } catch {
      console.log(`    ❌ uv: 未签名或签名无效`);
    }
  }
}

// lanproxy（bin/ 与 binaries/ 下可执行文件均需验证）
const lanproxyRoot = path.join(resourcesPath, 'lanproxy');
if (fs.existsSync(lanproxyRoot)) {
  console.log('\n  resources/lanproxy:');
  for (const subdir of ['bin', 'binaries']) {
    const dir = path.join(lanproxyRoot, subdir);
    if (!fs.existsSync(dir)) continue;
    for (const name of fs.readdirSync(dir)) {
      const full = path.join(dir, name);
      if (!fs.statSync(full).isFile()) continue;
      try {
        execSync(`codesign -v "${full}"`, { stdio: 'ignore' });
        console.log(`    ✅ ${subdir}/${name}: 已签名`);
      } catch {
        console.log(`    ❌ ${subdir}/${name}: 未签名或签名无效`);
      }
    }
  }
}

// 4. 检查 Hardened Runtime
console.log('\n4. 检查 Hardened Runtime 状态');
try {
  const output = execSync(`codesign -d --entitlements - "${appPath}" 2>&1`, {
    encoding: 'utf-8',
  });
  if (output.includes('com.apple.security.get-task-allow') && !output.includes('<false/>')) {
    console.log('⚠️  Hardened Runtime 未启用 (get-task-allow = true)');
  } else {
    console.log('✅ Hardened Runtime 已启用');
  }
} catch (e) {
  console.log(`⚠️  无法检查 Hardened Runtime: ${e.message}`);
}

// 5. 检查 Gatekeeper 状态
console.log('\n5. 检查 Gatekeeper 预期状态');
try {
  const output = execSync(`spctl -a -vv "${appPath}" 2>&1`, { encoding: 'utf-8' });
  console.log(output);
  if (output.includes('accepted')) {
    console.log('✅ Gatekeeper 验证通过');
  } else {
    console.log('⚠️  Gatekeeper 验证结果见上方');
  }
} catch (e) {
  console.log(`⚠️  Gatekeeper 验证失败: ${e.message}`);
  console.log('   注意: 未公证的应用在第一次打开时会受到 Gatekeeper 限制');
}

console.log('\n========================================');
console.log('验证完成');
console.log('========================================\n');

// 6. 显示说明
console.log('签名说明:');
console.log('  - 开发阶段可使用 Ad-hoc 签名 (无证书)');
console.log('  - 分发需要使用 Developer ID Application 证书签名');
console.log('  - 公证 (Notarization) 需要 Apple Developer 账号');
console.log('\n环境变量（与 workflow Secrets 统一）:');
console.log('  - APPLE_TEAM_ID: Team ID');
console.log('  - APPLE_SIGNING_IDENTITY: 签名证书 identity');
console.log('  - APPLE_CERTIFICATE: .p12 Base64');
console.log('  - APPLE_CERTIFICATE_PASSWORD: .p12 密码');
console.log('  - APPLE_API_KEY_ID: API Key ID');
console.log('  - APPLE_ISSUER_ID: Issuer ID');
console.log('  - APPLE_API_KEY: .p8 内容 (Base64)\n');
