/**
 * 单元测试: updatePlatformUtils
 *
 * 测试平台下载链接解析逻辑
 */

import { describe, it, expect } from 'vitest';
import {
  getDownloadUrlByKeys,
  getWindowsDownloadUrl,
  getMacosDownloadUrl,
  getLinuxDownloadUrl,
  getPlatformDownloadUrl,
  WINDOWS_PLATFORM_KEYS_NSIS_FIRST,
  WINDOWS_PLATFORM_KEYS_MSI_FIRST,
  MACOS_PLATFORM_KEYS,
  LINUX_PLATFORM_KEYS,
} from './updatePlatformUtils';
import type { Platforms, InstallerType } from './updatePlatformUtils';

describe('updatePlatformUtils', () => {
  // 测试数据：模拟 OSS latest.json 中的 platforms 字段
  const mockPlatforms: Platforms = {
    'windows-x86_64': { url: 'https://example.com/app-0.7.0.exe', signature: 'sig1', size: 100 },
    'windows-x86_64-nsis': { url: 'https://example.com/app-0.7.0-nsis.exe', signature: 'sig2', size: 101 },
    'windows-x86_64-msi': { url: 'https://example.com/app-0.7.0.msi', signature: 'sig3', size: 102 },
    'darwin-aarch64-zip': { url: 'https://example.com/app-0.7.0-arm64.zip', signature: 'sig4', size: 103 },
    'darwin-x86_64-zip': { url: 'https://example.com/app-0.7.0-x64.zip', signature: 'sig5', size: 104 },
    'linux-x86_64-appimage': { url: 'https://example.com/app-0.7.0-x64.AppImage', signature: 'sig6', size: 105 },
    'linux-aarch64-appimage': { url: 'https://example.com/app-0.7.0-arm64.AppImage', signature: 'sig7', size: 106 },
  };

  describe('getDownloadUrlByKeys', () => {
    it('should return first matching URL', () => {
      const url = getDownloadUrlByKeys(mockPlatforms, ['windows-x86_64', 'windows-x86_64-nsis']);
      expect(url).toBe('https://example.com/app-0.7.0.exe');
    });

    it('should return second URL if first key not found', () => {
      const url = getDownloadUrlByKeys(mockPlatforms, ['nonexistent', 'windows-x86_64-nsis']);
      expect(url).toBe('https://example.com/app-0.7.0-nsis.exe');
    });

    it('should return empty string if no keys match', () => {
      const url = getDownloadUrlByKeys(mockPlatforms, ['nonexistent1', 'nonexistent2']);
      expect(url).toBe('');
    });

    it('should return empty string if platforms is undefined', () => {
      const url = getDownloadUrlByKeys(undefined, ['windows-x86_64']);
      expect(url).toBe('');
    });

    it('should return empty string if platforms is empty', () => {
      const url = getDownloadUrlByKeys({}, ['windows-x86_64']);
      expect(url).toBe('');
    });

    it('should skip entries without url', () => {
      const platforms: Platforms = {
        'key1': { signature: 'sig', size: 100 } as any,
        'key2': { url: 'https://example.com/valid', signature: 'sig', size: 100 },
      };
      const url = getDownloadUrlByKeys(platforms, ['key1', 'key2']);
      expect(url).toBe('https://example.com/valid');
    });
  });

  describe('getWindowsDownloadUrl', () => {
    it('should return NSIS URL for NSIS installer type', () => {
      const url = getWindowsDownloadUrl(mockPlatforms, 'nsis');
      // NSIS_FIRST: ['windows-x86_64', 'windows-x86_64-nsis', 'windows-x86_64-msi']
      expect(url).toBe('https://example.com/app-0.7.0.exe');
    });

    it('should return MSI URL for MSI installer type', () => {
      const url = getWindowsDownloadUrl(mockPlatforms, 'msi');
      // MSI_FIRST: ['windows-x86_64-msi', 'windows-x86_64', 'windows-x86_64-nsis']
      expect(url).toBe('https://example.com/app-0.7.0.msi');
    });

    it('should fallback to exe if MSI not available', () => {
      const platformsWithoutMsi: Platforms = {
        'windows-x86_64': { url: 'https://example.com/app.exe', signature: 'sig', size: 100 },
      };
      const url = getWindowsDownloadUrl(platformsWithoutMsi, 'msi');
      expect(url).toBe('https://example.com/app.exe');
    });
  });

  describe('getMacosDownloadUrl', () => {
    it('should return arm64 URL for arm64 architecture', () => {
      const url = getMacosDownloadUrl(mockPlatforms, 'arm64');
      expect(url).toBe('https://example.com/app-0.7.0-arm64.zip');
    });

    it('should return x64 URL for x64 architecture', () => {
      const url = getMacosDownloadUrl(mockPlatforms, 'x64');
      expect(url).toBe('https://example.com/app-0.7.0-x64.zip');
    });

    it('should fallback to x64 for unknown architecture', () => {
      const url = getMacosDownloadUrl(mockPlatforms, 'ia32');
      expect(url).toBe('https://example.com/app-0.7.0-x64.zip');
    });

    it('should use process.arch as default', () => {
      // 这个测试验证默认参数行为
      const url = getMacosDownloadUrl(mockPlatforms);
      // 结果取决于当前测试环境的 process.arch
      expect(['https://example.com/app-0.7.0-arm64.zip', 'https://example.com/app-0.7.0-x64.zip']).toContain(url);
    });
  });

  describe('getLinuxDownloadUrl', () => {
    it('should return arm64 URL for arm64 architecture', () => {
      const url = getLinuxDownloadUrl(mockPlatforms, 'arm64');
      expect(url).toBe('https://example.com/app-0.7.0-arm64.AppImage');
    });

    it('should return x64 URL for x64 architecture', () => {
      const url = getLinuxDownloadUrl(mockPlatforms, 'x64');
      expect(url).toBe('https://example.com/app-0.7.0-x64.AppImage');
    });

    it('should fallback to x64 for unknown architecture', () => {
      const url = getLinuxDownloadUrl(mockPlatforms, 'ia32');
      expect(url).toBe('https://example.com/app-0.7.0-x64.AppImage');
    });
  });

  describe('getPlatformDownloadUrl', () => {
    it('should return Windows NSIS URL for win32 platform', () => {
      const url = getPlatformDownloadUrl('win32', 'x64', mockPlatforms, 'nsis');
      expect(url).toBe('https://example.com/app-0.7.0.exe');
    });

    it('should return Windows MSI URL for win32 platform with MSI type', () => {
      const url = getPlatformDownloadUrl('win32', 'x64', mockPlatforms, 'msi');
      expect(url).toBe('https://example.com/app-0.7.0.msi');
    });

    it('should return macOS arm64 URL for darwin platform with arm64', () => {
      const url = getPlatformDownloadUrl('darwin', 'arm64', mockPlatforms);
      expect(url).toBe('https://example.com/app-0.7.0-arm64.zip');
    });

    it('should return macOS x64 URL for darwin platform with x64', () => {
      const url = getPlatformDownloadUrl('darwin', 'x64', mockPlatforms);
      expect(url).toBe('https://example.com/app-0.7.0-x64.zip');
    });

    it('should return Linux x64 URL for linux platform with x64', () => {
      const url = getPlatformDownloadUrl('linux', 'x64', mockPlatforms);
      expect(url).toBe('https://example.com/app-0.7.0-x64.AppImage');
    });

    it('should return Linux arm64 URL for linux platform with arm64', () => {
      const url = getPlatformDownloadUrl('linux', 'arm64', mockPlatforms);
      expect(url).toBe('https://example.com/app-0.7.0-arm64.AppImage');
    });

    it('should default to nsis for Windows without installerType', () => {
      const url = getPlatformDownloadUrl('win32', 'x64', mockPlatforms);
      expect(url).toBe('https://example.com/app-0.7.0.exe');
    });
  });

  describe('platform key constants', () => {
    it('WINDOWS_PLATFORM_KEYS_NSIS_FIRST should have correct order', () => {
      expect(WINDOWS_PLATFORM_KEYS_NSIS_FIRST).toEqual([
        'windows-x86_64',
        'windows-x86_64-nsis',
        'windows-x86_64-msi',
      ]);
    });

    it('WINDOWS_PLATFORM_KEYS_MSI_FIRST should have correct order', () => {
      expect(WINDOWS_PLATFORM_KEYS_MSI_FIRST).toEqual([
        'windows-x86_64-msi',
        'windows-x86_64',
        'windows-x86_64-nsis',
      ]);
    });

    it('MACOS_PLATFORM_KEYS should have arm64 and x64', () => {
      expect(MACOS_PLATFORM_KEYS.arm64).toBeDefined();
      expect(MACOS_PLATFORM_KEYS.x64).toBeDefined();
    });

    it('LINUX_PLATFORM_KEYS should have arm64 and x64', () => {
      expect(LINUX_PLATFORM_KEYS.arm64).toBeDefined();
      expect(LINUX_PLATFORM_KEYS.x64).toBeDefined();
    });
  });
});
