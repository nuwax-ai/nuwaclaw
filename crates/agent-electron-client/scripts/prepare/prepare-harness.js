#!/usr/bin/env node
/**
 * 将 ACP 适配器和它锁定的 Harness 引擎一起放入 Electron extraResources。
 * 原生文件清单、下载和缓存都由引擎 npm 包管理。
 */
const fs = require('node:fs');
const path = require('node:path');
const { createRequire } = require('node:module');
const { pathToFileURL } = require('node:url');
const { execFileSync } = require('node:child_process');
const { getProjectRoot } = require('../utils/project-paths');

const ADAPTER = '@nuwax-ai/nuwax-harness-acp-ts';
const ENGINE = '@nuwax-ai/nuwax-harness';

async function main() {
  const targetArch = process.env.TARGET_ARCH || process.arch;
  if (targetArch !== process.arch) {
    throw new Error(`Harness requires a ${targetArch} Node runtime to prepare its native files (current: ${process.arch})`);
  }
  const projectRoot = getProjectRoot();
  const projectRequire = createRequire(path.join(projectRoot, 'package.json'));
  const adapterManifest = projectRequire.resolve(`${ADAPTER}/package.json`);
  const adapter = projectRequire(adapterManifest);
  const entry = path.join(path.dirname(adapterManifest), 'dist', 'index.js');
  fs.accessSync(entry, fs.constants.R_OK);

  const adapterRequire = createRequire(entry);
  const engineManifest = adapterRequire.resolve(`${ENGINE}/package.json`);
  const engine = adapterRequire(engineManifest);
  const runtimePath = path.join(path.dirname(engineManifest), 'bin', 'runtime.js');
  const runtime = await import(pathToFileURL(runtimePath).href);
  const cacheDir = path.dirname(await runtime.ensureBinary());
  const engineFiles = runtime.requiredBundleFiles();
  const bundleFiles = [...engineFiles, 'SHA256SUMS'];

  const resources = path.join(projectRoot, 'resources');
  const dest = path.join(resources, 'nuwax-harness-acp-ts');
  fs.mkdirSync(resources, { recursive: true });
  const staging = fs.mkdtempSync(path.join(resources, '.prepare-harness-'));
  try {
    fs.mkdirSync(path.join(staging, 'dist'));
    fs.copyFileSync(entry, path.join(staging, 'dist', 'index.js'));

    const vendorDir = path.join(staging, 'vendor', 'nuwax-harness', engine.version);
    for (const file of bundleFiles) {
      const destFile = path.join(vendorDir, file);
      fs.mkdirSync(path.dirname(destFile), { recursive: true });
      fs.copyFileSync(path.join(cacheDir, file), destFile);
    }
    for (const file of engineFiles) {
      const destFile = path.join(vendorDir, file);
      fs.chmodSync(destFile, 0o755);
      // 正式 Developer ID 签名由 after-sign.js 覆盖。
      if (process.platform === 'darwin') {
        execFileSync('codesign', ['--force', '--sign', '-', destFile]);
      }
    }

    fs.writeFileSync(
      path.join(staging, 'package.json'),
      JSON.stringify({
        name: ADAPTER,
        version: adapter.version,
        harnessEngineVersion: engine.version,
        type: 'module',
        main: './dist/index.js',
      }, null, 2) + '\n',
    );
    fs.chmodSync(staging, 0o755);
    fs.rmSync(dest, { recursive: true, force: true });
    fs.renameSync(staging, dest);
    console.log(`[prepare-harness] adapter ${adapter.version}, engine ${engine.version} (${runtime.getTargetTriple()})`);
  } finally {
    fs.rmSync(staging, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error('[prepare-harness]', error);
  process.exitCode = 1;
});
