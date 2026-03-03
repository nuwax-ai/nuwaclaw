#!/usr/bin/env node
/* eslint-disable no-console */
const fs = require('fs');
const path = require('path');

const PROJECT_ROOT = process.env.NUWAX_BOUNDARY_PROJECT_ROOT
  ? path.resolve(process.env.NUWAX_BOUNDARY_PROJECT_ROOT)
  : path.resolve(__dirname, '..', '..');
const SRC_ROOT = path.join(PROJECT_ROOT, 'src');

const MAIN_ROOT = path.join(SRC_ROOT, 'main');
const RENDERER_ROOT = path.join(SRC_ROOT, 'renderer');
const PRELOAD_ROOT = path.join(SRC_ROOT, 'preload');

const BANNED_BRIDGE_FILES = [
  'src/main/startup.ts',
  'src/main/logConfig.ts',
  'src/main/serviceManager.ts',
  'src/main/trayManager.ts',
  'src/main/autoLaunchManager.ts',
  'src/main/preload.ts',
  'src/renderer/services/api.ts',
  'src/renderer/services/setup.ts',
  'src/renderer/services/auth.ts',
  'src/renderer/services/ai.ts',
  'src/renderer/services/fileServer.ts',
  'src/renderer/services/lanproxy.ts',
  'src/renderer/services/agentRunner.ts',
  'src/renderer/services/sandbox.ts',
  'src/renderer/services/permissions.ts',
  'src/renderer/services/skills.ts',
  'src/renderer/services/im.ts',
  'src/renderer/services/scheduler.ts',
  'src/renderer/services/logService.ts',
  'src/renderer/components/ClientPage.tsx',
  'src/renderer/components/SettingsPage.tsx',
  'src/renderer/components/DependenciesPage.tsx',
  'src/renderer/components/AboutPage.tsx',
  'src/renderer/components/PermissionsPage.tsx',
  'src/renderer/components/LogViewer.tsx',
  'src/renderer/components/MCPSettings.tsx',
  'src/renderer/components/AgentSettings.tsx',
  'src/renderer/components/AgentRunnerSettings.tsx',
  'src/renderer/components/LanproxySettings.tsx',
  'src/renderer/components/SkillsSync.tsx',
  'src/renderer/components/IMSettings.tsx',
  'src/renderer/components/TaskSettings.tsx',
  'src/renderer/components/SetupWizard.tsx',
  'src/renderer/components/SetupDependencies.tsx',
  'src/renderer/components/PermissionModal.tsx',
];

const BANNED_BRIDGE_PATHS = new Set(
  BANNED_BRIDGE_FILES.map((p) => path.normalize(path.join(PROJECT_ROOT, p)))
);

function isSourceFile(filePath) {
  return filePath.endsWith('.ts') || filePath.endsWith('.tsx');
}

function walk(dirPath) {
  const out = [];
  for (const entry of fs.readdirSync(dirPath, { withFileTypes: true })) {
    const fullPath = path.join(dirPath, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name === 'dist') continue;
      out.push(...walk(fullPath));
      continue;
    }
    if (isSourceFile(fullPath)) out.push(fullPath);
  }
  return out;
}

function existsFile(candidate) {
  try {
    return fs.statSync(candidate).isFile();
  } catch {
    return false;
  }
}

function resolveImport(specifier, fromFile) {
  let basePath = null;

  if (specifier.startsWith('.')) {
    basePath = path.resolve(path.dirname(fromFile), specifier);
  } else if (specifier.startsWith('@/')) {
    basePath = path.join(SRC_ROOT, specifier.slice(2));
  } else if (specifier.startsWith('@main/')) {
    basePath = path.join(MAIN_ROOT, specifier.slice('@main/'.length));
  } else if (specifier.startsWith('@renderer/')) {
    basePath = path.join(RENDERER_ROOT, specifier.slice('@renderer/'.length));
  } else if (specifier.startsWith('@preload/')) {
    basePath = path.join(PRELOAD_ROOT, specifier.slice('@preload/'.length));
  } else if (specifier.startsWith('@shared/')) {
    basePath = path.join(SRC_ROOT, 'shared', specifier.slice('@shared/'.length));
  } else {
    return null;
  }

  const candidates = [
    basePath,
    `${basePath}.ts`,
    `${basePath}.tsx`,
    `${basePath}.js`,
    path.join(basePath, 'index.ts'),
    path.join(basePath, 'index.tsx'),
    path.join(basePath, 'index.js'),
  ];

  for (const candidate of candidates) {
    if (existsFile(candidate)) return path.normalize(candidate);
  }
  return null;
}

function lineFromIndex(content, index) {
  let line = 1;
  for (let i = 0; i < index; i += 1) {
    if (content.charCodeAt(i) === 10) line += 1;
  }
  return line;
}

function collectImports(fileContent) {
  const specs = [];
  const patterns = [
    /\bimport\s+(?:[^'"]+from\s+)?['"]([^'"]+)['"]/g,
    /\bexport\s+[^'"]*from\s+['"]([^'"]+)['"]/g,
    /\brequire\(\s*['"]([^'"]+)['"]\s*\)/g,
    /\bimport\(\s*['"]([^'"]+)['"]\s*\)/g,
  ];
  for (const pattern of patterns) {
    let match;
    while ((match = pattern.exec(fileContent)) !== null) {
      specs.push({ specifier: match[1], index: match.index });
    }
  }
  return specs;
}

function isWithin(filePath, rootPath) {
  const rel = path.relative(rootPath, filePath);
  return rel && !rel.startsWith('..') && !path.isAbsolute(rel);
}

function checkFile(filePath) {
  const violations = [];
  const content = fs.readFileSync(filePath, 'utf8');
  const imports = collectImports(content);

  for (const imp of imports) {
    const resolved = resolveImport(imp.specifier, filePath);
    const line = lineFromIndex(content, imp.index);

    if (resolved && BANNED_BRIDGE_PATHS.has(resolved)) {
      violations.push({
        line,
        rule: 'no-bridge-imports',
        message: `Do not import bridge file '${imp.specifier}'. Import the new grouped path directly.`,
      });
      continue;
    }

    const inRenderer = isWithin(filePath, RENDERER_ROOT);
    const inMain = isWithin(filePath, MAIN_ROOT);

    if (inRenderer) {
      const directAliasViolation = imp.specifier.startsWith('@main/') || imp.specifier.startsWith('@preload/');
      const resolvedViolation = resolved && (isWithin(resolved, MAIN_ROOT) || isWithin(resolved, PRELOAD_ROOT));
      if (directAliasViolation || resolvedViolation) {
        violations.push({
          line,
          rule: 'renderer-process-boundary',
          message: `Renderer must not import main/preload code directly ('${imp.specifier}'). Use IPC bridge only.`,
        });
      }
    }

    if (inMain) {
      const directAliasViolation = imp.specifier.startsWith('@renderer/');
      const resolvedViolation = resolved && isWithin(resolved, RENDERER_ROOT);
      if (directAliasViolation || resolvedViolation) {
        violations.push({
          line,
          rule: 'main-process-boundary',
          message: `Main process must not import renderer code ('${imp.specifier}').`,
        });
      }
    }
  }

  return violations;
}

function runBoundaryCheck() {
  const files = walk(SRC_ROOT);
  const allViolations = [];

  for (const file of files) {
    const violations = checkFile(file);
    for (const v of violations) {
      allViolations.push({
        file: path.relative(PROJECT_ROOT, file),
        ...v,
      });
    }
  }

  return allViolations;
}

function main() {
  const allViolations = runBoundaryCheck();

  if (allViolations.length > 0) {
    console.error('Import boundary check failed:\n');
    for (const v of allViolations) {
      console.error(`- ${v.file}:${v.line} [${v.rule}] ${v.message}`);
    }
    console.error(`\nTotal violations: ${allViolations.length}`);
    process.exit(1);
  }

  console.log('Import boundary check passed.');
}

if (require.main === module) {
  main();
}

module.exports = {
  runBoundaryCheck,
};
