import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const testFileDir = path.dirname(fileURLToPath(import.meta.url));
const projectRootByFs = path.resolve(testFileDir, '..', '..');
const require = createRequire(import.meta.url);
const { getProjectRoot, resolveFromProject } = require(path.join(
  projectRootByFs,
  'scripts',
  'utils',
  'project-paths.js',
));

describe('scripts project path contracts', () => {
  it('resolves Electron client root correctly', () => {
    const root = getProjectRoot();
    expect(root).toBe(projectRootByFs);
    expect(fs.existsSync(path.join(root, 'package.json'))).toBe(true);
    expect(fs.existsSync(path.join(root, 'scripts'))).toBe(true);
  });

  it('resolves resources and node_modules from project root', () => {
    expect(resolveFromProject('resources')).toBe(path.join(projectRootByFs, 'resources'));
    expect(resolveFromProject('node_modules')).toBe(path.join(projectRootByFs, 'node_modules'));
  });

  it('keeps moved scripts wired to shared project-path helper', () => {
    const scripts = [
      'scripts/prepare/prepare-uv.js',
      'scripts/prepare/prepare-node.js',
      'scripts/prepare/prepare-git.js',
      'scripts/prepare/prepare-lanproxy.js',
      'scripts/build/sign-uv-mac.js',
      'scripts/build/dist-current-platform.js',
      'scripts/tools/check-startup-ports.js',
      'scripts/tools/generate-tray-icons.js',
      'scripts/tools/test-integrated-node.js',
    ];

    const legacyPattern = /path\.resolve\(__dirname,\s*'\.\.'\)/;

    for (const relPath of scripts) {
      const fullPath = path.join(projectRootByFs, relPath);
      const content = fs.readFileSync(fullPath, 'utf8');
      expect(content).toContain('project-paths');
      expect(content).not.toMatch(legacyPattern);
    }
  });
});
