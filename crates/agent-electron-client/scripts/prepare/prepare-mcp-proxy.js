#!/usr/bin/env node
/**
 * 构建 nuwax-mcp-stdio-proxy 并集成到 resources/nuwax-mcp-stdio-proxy/
 *
 * 源码：crates/nuwax-mcp-stdio-proxy/（相对 monorepo root）
 *
 * 产物（3 个文件）：
 *   resources/nuwax-mcp-stdio-proxy/
 *     ├── dist/index.js       — CLI bundle（esbuild 单文件，含 shebang）
 *     ├── dist/lib.bundle.js  — 库 bundle（PersistentMcpBridge 等导出）
 *     └── package.json        — 精简版（name/version/bin/main）
 *
 * 打包时 electron-builder extraResources 会打包到
 *   .app/Contents/Resources/nuwax-mcp-stdio-proxy/
 */

const path = require('path');
const fs = require('fs');
const { execSync } = require('child_process');
const { getProjectRoot } = require('../utils/project-paths');

const projectRoot = getProjectRoot();
// monorepo root is two levels up from the electron client crate
const monorepoRoot = path.resolve(projectRoot, '..', '..');
const srcDir = path.join(monorepoRoot, 'crates', 'nuwax-mcp-stdio-proxy');
const destDir = path.join(projectRoot, 'resources', 'nuwax-mcp-stdio-proxy');

function main() {
  // 1. Validate source directory
  if (!fs.existsSync(path.join(srcDir, 'package.json'))) {
    console.error(`[prepare-mcp-proxy] 源码目录不存在: ${srcDir}`);
    console.error('[prepare-mcp-proxy] 请确保 crates/nuwax-mcp-stdio-proxy/ 存在');
    process.exit(1);
  }

  const srcPkg = JSON.parse(fs.readFileSync(path.join(srcDir, 'package.json'), 'utf8'));
  console.log(`[prepare-mcp-proxy] 源码版本: ${srcPkg.name}@${srcPkg.version}`);

  // 2. Check if dest is already up-to-date
  const destPkgPath = path.join(destDir, 'package.json');
  if (fs.existsSync(destPkgPath)) {
    try {
      const destPkg = JSON.parse(fs.readFileSync(destPkgPath, 'utf8'));
      if (destPkg.version === srcPkg.version) {
        // Check that all expected files exist
        const indexJs = path.join(destDir, 'dist', 'index.js');
        const libJs = path.join(destDir, 'dist', 'lib.bundle.js');
        if (fs.existsSync(indexJs) && fs.existsSync(libJs)) {
          console.log(`[prepare-mcp-proxy] ${srcPkg.version} 已是最新，跳过`);
          return;
        }
      }
    } catch {
      // corrupted dest, rebuild
    }
  }

  // 3. Build source (tsc + esbuild for CLI bundle)
  console.log('[prepare-mcp-proxy] 构建源码 (npm run build)...');
  execSync('npm run build', { cwd: srcDir, stdio: 'inherit' });

  // 4. Bundle lib.ts → dist/lib.bundle.js (single file with all deps)
  console.log('[prepare-mcp-proxy] 构建 lib bundle (esbuild)...');
  const esbuildBin = path.join(srcDir, 'node_modules', '.bin', 'esbuild');
  const libEntry = path.join(srcDir, 'dist', 'lib.js');

  if (!fs.existsSync(libEntry)) {
    console.error(`[prepare-mcp-proxy] tsc 产物不存在: ${libEntry}`);
    console.error('[prepare-mcp-proxy] 请检查 nuwax-mcp-stdio-proxy 的 build 配置');
    process.exit(1);
  }

  execSync(
    `"${esbuildBin}" "${libEntry}" --bundle --platform=node --target=node22 --format=cjs --outfile="${path.join(srcDir, 'dist', 'lib.bundle.js')}" --legal-comments=none`,
    { cwd: srcDir, stdio: 'inherit' },
  );

  // 5. Copy to resources/nuwax-mcp-stdio-proxy/
  console.log('[prepare-mcp-proxy] 复制到 resources/nuwax-mcp-stdio-proxy/...');

  // Clean dest
  if (fs.existsSync(destDir)) {
    fs.rmSync(destDir, { recursive: true });
  }
  fs.mkdirSync(path.join(destDir, 'dist'), { recursive: true });

  // Copy dist/index.js (CLI bundle)
  const srcIndexJs = path.join(srcDir, 'dist', 'index.js');
  const destIndexJs = path.join(destDir, 'dist', 'index.js');
  fs.copyFileSync(srcIndexJs, destIndexJs);
  fs.chmodSync(destIndexJs, 0o755);
  console.log(`  dist/index.js (${(fs.statSync(destIndexJs).size / 1024).toFixed(0)} KB)`);

  // Copy dist/lib.bundle.js (library bundle)
  const srcLibJs = path.join(srcDir, 'dist', 'lib.bundle.js');
  const destLibJs = path.join(destDir, 'dist', 'lib.bundle.js');
  fs.copyFileSync(srcLibJs, destLibJs);
  console.log(`  dist/lib.bundle.js (${(fs.statSync(destLibJs).size / 1024).toFixed(0)} KB)`);

  // 6. Generate slim package.json
  const slimPkg = {
    name: srcPkg.name,
    version: srcPkg.version,
    bin: { 'nuwax-mcp-stdio-proxy': './dist/index.js' },
    main: './dist/lib.bundle.js',
  };
  fs.writeFileSync(destPkgPath, JSON.stringify(slimPkg, null, 2) + '\n');
  console.log('  package.json (slim)');

  console.log(`[prepare-mcp-proxy] ✓ resources/nuwax-mcp-stdio-proxy/ (${srcPkg.version})`);
}

main();
