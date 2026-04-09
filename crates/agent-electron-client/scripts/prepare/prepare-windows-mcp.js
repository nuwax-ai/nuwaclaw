#!/usr/bin/env node
/**
 * Prepare offline wheels for windows-mcp under resources/windows-mcp/wheels.
 *
 * Runtime installation will happen on end-user machine to avoid non-relocatable
 * uv tool launcher issues when app is installed in a different path.
 *
 * Note: Bundled uv no longer provides `uv pip download`; we use
 * `uv run ... python -m pip download` with a pinned Python (3.13+) so wheel tags
 * match package `Requires-Python` and typical `uv tool install` on Windows.
 */

const path = require('path');
const fs = require('fs');
const { execFileSync } = require('child_process');
const { getProjectRoot, resolveFromProject } = require('../utils/project-paths');

const projectRoot = getProjectRoot();
const resDir = path.join(projectRoot, 'resources', 'windows-mcp');
const wheelsDir = path.join(resDir, 'wheels');
const manifestPath = path.join(resDir, 'manifest.json');

const PACKAGE_NAME = 'windows-mcp';
/** Interpreter for pip download (windows-mcp currently requires Python >= 3.13). 若修改须同步 windowsMcp.ts 的 WINDOWS_MCP_UV_PYTHON。 */
const PIP_DOWNLOAD_PYTHON = '3.13';

function getUvBinPath() {
  const uvBinName = process.platform === 'win32' ? 'uv.exe' : 'uv';
  return resolveFromProject('resources', 'uv', 'bin', uvBinName);
}

function runPipDownload(uvBin, destDir, packageName, env) {
  execFileSync(
    uvBin,
    [
      'run',
      '--no-project',
      '--isolated',
      '--python',
      PIP_DOWNLOAD_PYTHON,
      '-w',
      'pip',
      'python',
      '-m',
      'pip',
      'download',
      '--dest',
      destDir,
      '--only-binary',
      ':all:',
      packageName,
    ],
    { stdio: 'inherit', env },
  );
}

function resolvePinnedVersion(files) {
  const wheel = files.find((name) => /^windows_mcp-([^-]+)-.*\.whl$/i.test(name));
  if (!wheel) {
    return null;
  }
  const match = wheel.match(/^windows_mcp-([^-]+)-.*\.whl$/i);
  return match ? match[1] : null;
}

function main() {
  if (process.platform !== 'win32') {
    console.log('[prepare-windows-mcp] Skipped: not Windows platform');
    return;
  }

  const uvBin = getUvBinPath();
  if (!fs.existsSync(uvBin)) {
    console.error('[prepare-windows-mcp] uv not found at:', uvBin);
    process.exit(1);
  }

  console.log('[prepare-windows-mcp] Using uv:', uvBin);

  if (fs.existsSync(resDir)) {
    console.log('[prepare-windows-mcp] Removing old resources/windows-mcp ...');
    fs.rmSync(resDir, { recursive: true, force: true });
  }
  fs.mkdirSync(wheelsDir, { recursive: true });

  console.log('[prepare-windows-mcp] Downloading wheels for offline installation ...');
  try {
    runPipDownload(uvBin, wheelsDir, PACKAGE_NAME, {
      ...process.env,
      UV_PYTHON_DOWNLOADS: process.env.UV_PYTHON_DOWNLOADS ?? 'automatic',
    });
  } catch (error) {
    console.error('[prepare-windows-mcp] Failed to download windows-mcp wheels:', error.message);
    process.exit(1);
  }

  const files = fs
    .readdirSync(wheelsDir)
    .filter((name) => {
      const full = path.join(wheelsDir, name);
      return fs.statSync(full).isFile() && name.toLowerCase().endsWith('.whl');
    })
    .sort();

  if (files.length === 0) {
    console.error('[prepare-windows-mcp] No files downloaded into wheels directory');
    process.exit(1);
  }

  const version = resolvePinnedVersion(files);
  if (!version) {
    console.error('[prepare-windows-mcp] Could not resolve pinned windows-mcp version from downloaded wheels');
    console.error('[prepare-windows-mcp] Downloaded files:', files.join(', '));
    process.exit(1);
  }

  const manifest = {
    packageName: PACKAGE_NAME,
    version,
    resolvedSpec: `${PACKAGE_NAME}==${version}`,
    generatedAt: new Date().toISOString(),
    files,
  };

  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), 'utf-8');

  console.log(`[prepare-windows-mcp] ✓ Downloaded ${files.length} files`);
  console.log(`[prepare-windows-mcp] ✓ Pinned ${manifest.resolvedSpec}`);
  console.log(`[prepare-windows-mcp] ✓ Wrote manifest: ${manifestPath}`);
  console.log('[prepare-windows-mcp] ✓ resources/windows-mcp ready');
}

main();
