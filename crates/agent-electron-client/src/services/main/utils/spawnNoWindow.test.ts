/**
 * Unit tests for spawnNoWindow utility
 *
 * Tests the cross-platform spawn functionality:
 * - Windows: Uses Electron's bundled Node with ELECTRON_RUN_AS_NODE=1
 * - macOS/Linux: Uses system node to avoid Dock icon issue
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as path from 'path';
import * as fs from 'fs';
import { resolveNpmPackageEntry, spawnJsFile, spawnNpmPackage, isWindows, isMacOS, getNodePath, findSystemNode } from './spawnNoWindow';

// Mock child_process
const mockSpawn = vi.fn();
const mockExecSync = vi.fn();
vi.mock('child_process', () => ({
  spawn: (...args: unknown[]) => mockSpawn(...args),
  execSync: (...args: unknown[]) => mockExecSync(...args),
}));

// Mock fs
const mockExistsSync = vi.fn();
const mockReadFileSync = vi.fn();
vi.mock('fs', () => ({
  existsSync: (p: string) => mockExistsSync(p),
  readFileSync: (p: string) => mockReadFileSync(p),
}));

// Store original platform
const originalPlatform = process.platform;

describe('spawnNoWindow', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Default mocks
    mockSpawn.mockReturnValue({
      pid: 12345,
      on: vi.fn(),
      stdout: { on: vi.fn() },
      stderr: { on: vi.fn() },
    });
    mockExecSync.mockReturnValue('__PATH__=/usr/local/bin:/opt/homebrew/bin');
    mockExistsSync.mockImplementation((p: string) => {
      if (p.includes('node')) return true;
      return false;
    });
  });

  afterEach(() => {
    vi.resetAllMocks();
  });

  describe('isWindows', () => {
    it('should return boolean based on platform', () => {
      const result = isWindows();
      expect(typeof result).toBe('boolean');
    });
  });

  describe('isMacOS', () => {
    it('should return boolean based on platform', () => {
      const result = isMacOS();
      expect(typeof result).toBe('boolean');
    });
  });

  describe('getNodePath', () => {
    it('should return process.execPath', () => {
      const result = getNodePath();
      expect(result).toBe(process.execPath);
    });
  });

  describe('resolveNpmPackageEntry', () => {
    it('should return null if package.json not found', () => {
      mockExistsSync.mockReturnValue(false);

      const result = resolveNpmPackageEntry('/nonexistent/package');

      expect(result).toBeNull();
      expect(mockExistsSync).toHaveBeenCalledWith('/nonexistent/package/package.json');
    });

    it('should resolve entry from string bin field', () => {
      mockExistsSync.mockImplementation((p: string) => {
        if (p.endsWith('package.json')) return true;
        if (p.endsWith('cli.js')) return true;
        return false;
      });
      mockReadFileSync.mockReturnValue(JSON.stringify({
        name: 'test-package',
        bin: './cli.js',
      }));

      const result = resolveNpmPackageEntry('/packages/test-package');

      expect(result).toBe('/packages/test-package/cli.js');
    });

    it('should resolve entry from object bin field', () => {
      mockExistsSync.mockImplementation((p: string) => {
        if (p.endsWith('package.json')) return true;
        if (p.endsWith('dist/index.js')) return true;
        return false;
      });
      mockReadFileSync.mockReturnValue(JSON.stringify({
        name: 'test-package',
        bin: {
          'test-command': './dist/index.js',
        },
      }));

      const result = resolveNpmPackageEntry('/packages/test-package', 'test-command');

      expect(result).toBe('/packages/test-package/dist/index.js');
    });

    it('should fallback to common locations if bin not found', () => {
      mockExistsSync.mockImplementation((p: string) => {
        if (p.endsWith('package.json')) return true;
        if (p.endsWith('index.js')) return true;
        return false;
      });
      mockReadFileSync.mockReturnValue(JSON.stringify({
        name: 'test-package',
        // No bin field
      }));

      const result = resolveNpmPackageEntry('/packages/test-package');

      expect(result).toBe('/packages/test-package/index.js');
    });

    it('should handle malformed package.json', () => {
      mockExistsSync.mockImplementation((p: string) => {
        if (p.endsWith('package.json')) return true;
        return false;
      });
      mockReadFileSync.mockReturnValue('not valid json');

      const result = resolveNpmPackageEntry('/packages/test-package');

      expect(result).toBeNull();
    });
  });

  describe('spawnJsFile - Windows behavior', () => {
    it('should use ELECTRON_RUN_AS_NODE=1 on Windows', () => {
      // This test verifies Windows behavior
      // On Windows, process.execPath is used with ELECTRON_RUN_AS_NODE=1
      const originalPlatform = Object.getOwnPropertyDescriptor(process, 'platform');
      Object.defineProperty(process, 'platform', { value: 'win32' });

      try {
        spawnJsFile('/path/to/script.js');

        const callArgs = mockSpawn.mock.calls[0];
        // On Windows, should use process.execPath
        expect(callArgs[0]).toBe(process.execPath);
        // On Windows, should set ELECTRON_RUN_AS_NODE
        expect(callArgs[2].env.ELECTRON_RUN_AS_NODE).toBe('1');
        expect(callArgs[2].windowsHide).toBe(true);
      } finally {
        Object.defineProperty(process, 'platform', originalPlatform!);
      }
    });

    it('should merge custom environment variables on Windows', () => {
      const originalPlatform = Object.getOwnPropertyDescriptor(process, 'platform');
      Object.defineProperty(process, 'platform', { value: 'win32' });

      try {
        spawnJsFile('/path/to/script.js', [], {
          env: { CUSTOM_VAR: 'custom_value' },
        });

        const callArgs = mockSpawn.mock.calls[0];
        expect(callArgs[2].env.CUSTOM_VAR).toBe('custom_value');
        expect(callArgs[2].env.ELECTRON_RUN_AS_NODE).toBe('1');
      } finally {
        Object.defineProperty(process, 'platform', originalPlatform!);
      }
    });
  });

  describe('spawnJsFile - macOS/Linux behavior', () => {
    it('should use system node on macOS (no ELECTRON_RUN_AS_NODE)', () => {
      const originalPlatform = Object.getOwnPropertyDescriptor(process, 'platform');
      Object.defineProperty(process, 'platform', { value: 'darwin' });

      // Mock fs.existsSync to find node
      mockExistsSync.mockImplementation((p: string) => {
        if (p === '/usr/local/bin/node') return true;
        return false;
      });

      try {
        spawnJsFile('/path/to/script.js');

        const callArgs = mockSpawn.mock.calls[0];
        // On macOS, should use system node (not process.execPath)
        expect(callArgs[0]).toBe('/usr/local/bin/node');
        // On macOS, should NOT set ELECTRON_RUN_AS_NODE
        expect(callArgs[2].env.ELECTRON_RUN_AS_NODE).toBeUndefined();
        expect(callArgs[2].windowsHide).toBe(true);
      } finally {
        Object.defineProperty(process, 'platform', originalPlatform!);
      }
    });

    it('should use system node on Linux (no ELECTRON_RUN_AS_NODE)', () => {
      const originalPlatform = Object.getOwnPropertyDescriptor(process, 'platform');
      Object.defineProperty(process, 'platform', { value: 'linux' });

      // Mock fs.existsSync to find node
      mockExistsSync.mockImplementation((p: string) => {
        if (p === '/usr/local/bin/node') return true;
        return false;
      });

      try {
        spawnJsFile('/path/to/script.js');

        const callArgs = mockSpawn.mock.calls[0];
        // On Linux, should use system node
        expect(callArgs[0]).toBe('/usr/local/bin/node');
        // On Linux, should NOT set ELECTRON_RUN_AS_NODE
        expect(callArgs[2].env.ELECTRON_RUN_AS_NODE).toBeUndefined();
      } finally {
        Object.defineProperty(process, 'platform', originalPlatform!);
      }
    });

    it('should allow custom node path on macOS', () => {
      const originalPlatform = Object.getOwnPropertyDescriptor(process, 'platform');
      Object.defineProperty(process, 'platform', { value: 'darwin' });

      try {
        spawnJsFile('/path/to/script.js', [], {
          nodePath: '/custom/node',
        });

        const callArgs = mockSpawn.mock.calls[0];
        expect(callArgs[0]).toBe('/custom/node');
      } finally {
        Object.defineProperty(process, 'platform', originalPlatform!);
      }
    });
  });

  describe('spawnNpmPackage', () => {
    it('should return null if entry not found', () => {
      mockExistsSync.mockReturnValue(false);

      const result = spawnNpmPackage('/nonexistent/package');

      expect(result).toBeNull();
      expect(mockSpawn).not.toHaveBeenCalled();
    });

    it('should spawn with resolved entry', () => {
      const originalPlatform = Object.getOwnPropertyDescriptor(process, 'platform');
      Object.defineProperty(process, 'platform', { value: 'win32' });

      mockExistsSync.mockImplementation((p: string) => {
        if (p.endsWith('package.json')) return true;
        if (p.endsWith('cli.js')) return true;
        return false;
      });
      mockReadFileSync.mockReturnValue(JSON.stringify({
        name: 'test-package',
        bin: './cli.js',
      }));

      try {
        const result = spawnNpmPackage('/packages/test-package', ['--port', '8080']);

        expect(result).not.toBeNull();
        expect(mockSpawn).toHaveBeenCalledWith(
          process.execPath,
          ['/packages/test-package/cli.js', '--port', '8080'],
          expect.objectContaining({
            windowsHide: true,
          })
        );
      } finally {
        Object.defineProperty(process, 'platform', originalPlatform!);
      }
    });

    it('should pass binName for resolution', () => {
      const originalPlatform = Object.getOwnPropertyDescriptor(process, 'platform');
      Object.defineProperty(process, 'platform', { value: 'win32' });

      mockExistsSync.mockImplementation((p: string) => {
        if (p.endsWith('package.json')) return true;
        if (p.endsWith('dist/bin.js')) return true;
        return false;
      });
      mockReadFileSync.mockReturnValue(JSON.stringify({
        name: 'test-package',
        bin: {
          'custom-bin': './dist/bin.js',
        },
      }));

      try {
        const result = spawnNpmPackage('/packages/test-package', [], {}, 'custom-bin');

        expect(result).not.toBeNull();
        const callArgs = mockSpawn.mock.calls[0];
        expect(callArgs[1][0]).toBe('/packages/test-package/dist/bin.js');
      } finally {
        Object.defineProperty(process, 'platform', originalPlatform!);
      }
    });
  });

  describe('findSystemNode', () => {
    it('should return process.execPath on Windows', () => {
      const originalPlatform = Object.getOwnPropertyDescriptor(process, 'platform');
      Object.defineProperty(process, 'platform', { value: 'win32' });

      try {
        const result = findSystemNode();
        expect(result).toBe(process.execPath);
      } finally {
        Object.defineProperty(process, 'platform', originalPlatform!);
      }
    });

    it('should find node in user PATH on macOS', () => {
      const originalPlatform = Object.getOwnPropertyDescriptor(process, 'platform');
      Object.defineProperty(process, 'platform', { value: 'darwin' });

      mockExecSync.mockReturnValue('__PATH__=/opt/homebrew/bin:/usr/local/bin');
      mockExistsSync.mockImplementation((p: string) => {
        if (p === '/opt/homebrew/bin/node') return true;
        return false;
      });

      try {
        const result = findSystemNode();
        expect(result).toBe('/opt/homebrew/bin/node');
      } finally {
        Object.defineProperty(process, 'platform', originalPlatform!);
      }
    });

    it('should fallback to common paths if not in PATH', () => {
      const originalPlatform = Object.getOwnPropertyDescriptor(process, 'platform');
      Object.defineProperty(process, 'platform', { value: 'darwin' });

      mockExecSync.mockReturnValue('__PATH__=/some/path/without/node');
      mockExistsSync.mockImplementation((p: string) => {
        if (p === '/usr/local/bin/node') return true;
        return false;
      });

      try {
        const result = findSystemNode();
        expect(result).toBe('/usr/local/bin/node');
      } finally {
        Object.defineProperty(process, 'platform', originalPlatform!);
      }
    });

    it('should return "node" as final fallback', () => {
      const originalPlatform = Object.getOwnPropertyDescriptor(process, 'platform');
      Object.defineProperty(process, 'platform', { value: 'darwin' });

      mockExecSync.mockImplementation(() => {
        throw new Error('Shell failed');
      });
      mockExistsSync.mockReturnValue(false);

      try {
        const result = findSystemNode();
        expect(result).toBe('node');
      } finally {
        Object.defineProperty(process, 'platform', originalPlatform!);
      }
    });
  });
});
