import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const testFileDir = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(testFileDir, '..', '..');
const checkerScript = path.join(projectRoot, 'scripts', 'tools', 'check-import-boundaries.js');

function writeFile(root: string, relPath: string, content: string) {
  const fullPath = path.join(root, relPath);
  fs.mkdirSync(path.dirname(fullPath), { recursive: true });
  fs.writeFileSync(fullPath, content, 'utf8');
}

function runChecker(tempProjectRoot: string) {
  return spawnSync('node', [checkerScript], {
    cwd: tempProjectRoot,
    env: {
      ...process.env,
      NUWAX_BOUNDARY_PROJECT_ROOT: tempProjectRoot,
    },
    encoding: 'utf8',
  });
}

function withTempProject(assertion: (root: string) => void) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nuwax-boundary-'));
  try {
    assertion(root);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

describe('check-import-boundaries script', () => {
  it('passes for valid main/renderer separation', () => {
    withTempProject((root) => {
      writeFile(root, 'src/main/bootstrap/startup.ts', 'export const start = () => 1;\n');
      writeFile(root, 'src/main/main.ts', "import { start } from './bootstrap/startup';\nstart();\n");
      writeFile(root, 'src/renderer/services/core/api.ts', 'export const call = () => 1;\n');
      writeFile(
        root,
        'src/renderer/components/pages/Home.tsx',
        "import { call } from '@renderer/services/core/api';\nexport const Home = () => call();\n",
      );

      const result = runChecker(root);
      expect(result.status).toBe(0);
      expect(result.stdout).toContain('Import boundary check passed.');
    });
  });

  it('fails when renderer imports main code directly', () => {
    withTempProject((root) => {
      writeFile(root, 'src/main/bootstrap/startup.ts', 'export const start = () => 1;\n');
      writeFile(
        root,
        'src/renderer/components/pages/Home.tsx',
        "import { start } from '@main/bootstrap/startup';\nexport const Home = () => start();\n",
      );

      const result = runChecker(root);
      expect(result.status).toBe(1);
      expect(result.stderr).toContain('[renderer-process-boundary]');
    });
  });

  it('fails when importing bridge files', () => {
    withTempProject((root) => {
      writeFile(root, 'src/main/bootstrap/startup.ts', 'export const start = () => 1;\n');
      writeFile(root, 'src/main/startup.ts', "export * from './bootstrap/startup';\n");
      writeFile(root, 'src/main/main.ts', "import { start } from '@/main/startup';\nstart();\n");

      const result = runChecker(root);
      expect(result.status).toBe(1);
      expect(result.stderr).toContain('[no-bridge-imports]');
    });
  });
});
