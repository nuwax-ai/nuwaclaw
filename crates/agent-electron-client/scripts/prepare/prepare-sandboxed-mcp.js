#!/usr/bin/env node
/**
 * Bundle sandboxed-bash / sandboxed-fs MCP servers for packaged installs.
 *
 * Production extraResources only copy .mjs sources; @modelcontextprotocol/sdk
 * is not available at runtime unless we bundle it here.
 *
 * Outputs:
 *   resources/sandboxed-bash-mcp/dist/sandboxed-bash-mcp.bundle.mjs
 *   resources/sandboxed-fs-mcp/dist/sandboxed-fs-mcp.bundle.mjs
 *   resources/sandboxed-*-mcp/.bundle-version (sdk version stamp)
 */

const path = require('path');
const fs = require('fs');
const { execSync } = require('child_process');
const { getProjectRoot } = require('../utils/project-paths');

const projectRoot = getProjectRoot();
const pkgJson = JSON.parse(
  fs.readFileSync(path.join(projectRoot, 'package.json'), 'utf8'),
);
const sdkVersion =
  (pkgJson.dependencies && pkgJson.dependencies['@modelcontextprotocol/sdk']) ||
  (pkgJson.devDependencies &&
    pkgJson.devDependencies['@modelcontextprotocol/sdk']) ||
  'unknown';

const BUNDLES = [
  {
    name: 'sandboxed-bash-mcp',
    entry: path.join(
      projectRoot,
      'resources',
      'sandboxed-bash-mcp',
      'sandboxed-bash-mcp.mjs',
    ),
    outfile: path.join(
      projectRoot,
      'resources',
      'sandboxed-bash-mcp',
      'dist',
      'sandboxed-bash-mcp.bundle.mjs',
    ),
  },
  {
    name: 'sandboxed-fs-mcp',
    entry: path.join(
      projectRoot,
      'resources',
      'sandboxed-fs-mcp',
      'sandboxed-fs-mcp.mjs',
    ),
    outfile: path.join(
      projectRoot,
      'resources',
      'sandboxed-fs-mcp',
      'dist',
      'sandboxed-fs-mcp.bundle.mjs',
    ),
  },
];

function resolveEsbuildCmd() {
  const candidates = [
    path.join(projectRoot, 'node_modules', '.bin', 'esbuild'),
    path.join(projectRoot, 'node_modules', 'esbuild', 'bin', 'esbuild'),
  ];
  for (const bin of candidates) {
    const cmd =
      process.platform === 'win32' && !bin.endsWith('.cmd') && !bin.endsWith('.exe')
        ? `${bin}.cmd`
        : bin;
    if (fs.existsSync(cmd)) return cmd;
    if (fs.existsSync(bin)) return bin;
  }
  console.error(
    '[prepare-sandboxed-mcp] esbuild not found; run npm install in crates/agent-electron-client',
  );
  process.exit(1);
}

function needsRebuild(outfile, versionStampPath) {
  if (!fs.existsSync(outfile) || !fs.existsSync(versionStampPath)) {
    return true;
  }
  try {
    const stamp = fs.readFileSync(versionStampPath, 'utf8').trim();
    return stamp !== sdkVersion;
  } catch {
    return true;
  }
}

function bundleOne(esbuildCmd, spec) {
  const { name, entry, outfile } = spec;
  const outDir = path.dirname(outfile);
  const versionStampPath = path.join(path.dirname(outfile), '..', '.bundle-version');

  if (!fs.existsSync(entry)) {
    console.error(`[prepare-sandboxed-mcp] missing entry: ${entry}`);
    process.exit(1);
  }

  if (!needsRebuild(outfile, versionStampPath)) {
    console.log(
      `[prepare-sandboxed-mcp] ${name} @modelcontextprotocol/sdk@${sdkVersion} already bundled, skip`,
    );
    return;
  }

  fs.mkdirSync(outDir, { recursive: true });
  const banner = '#!/usr/bin/env node';
  const cmd = [
    `"${esbuildCmd}"`,
    `"${entry}"`,
    '--bundle',
    '--platform=node',
    '--format=esm',
    '--target=node22',
    `--outfile="${outfile}"`,
    '--legal-comments=none',
    `--banner:js=${JSON.stringify(banner)}`,
  ].join(' ');

  console.log(`[prepare-sandboxed-mcp] bundling ${name}...`);
  execSync(cmd, { cwd: projectRoot, stdio: 'inherit' });
  fs.chmodSync(outfile, 0o755);
  fs.writeFileSync(versionStampPath, `${sdkVersion}\n`, 'utf8');
  const kb = (fs.statSync(outfile).size / 1024).toFixed(0);
  console.log(`[prepare-sandboxed-mcp] ✓ ${name} → dist (${kb} KB)`);
}

function main() {
  const sdkPkg = path.join(
    projectRoot,
    'node_modules',
    '@modelcontextprotocol',
    'sdk',
    'package.json',
  );
  if (!fs.existsSync(sdkPkg)) {
    console.error(
      '[prepare-sandboxed-mcp] @modelcontextprotocol/sdk not in node_modules',
    );
    console.error('[prepare-sandboxed-mcp] run: npm install');
    process.exit(1);
  }

  console.log(
    `[prepare-sandboxed-mcp] SDK dependency: @modelcontextprotocol/sdk@${sdkVersion}`,
  );
  const esbuildCmd = resolveEsbuildCmd();
  for (const spec of BUNDLES) {
    bundleOne(esbuildCmd, spec);
  }
  console.log('[prepare-sandboxed-mcp] done');
}

main();
