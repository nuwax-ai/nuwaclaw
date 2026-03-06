/**
 * 平台下载链接解析工具
 *
 * 从 OSS latest.json 的 platforms 字段中解析当前平台对应的下载链接
 */

/**
 * OSS latest.json 中的 platform key 定义
 */
export const WINDOWS_PLATFORM_KEYS_NSIS_FIRST = ['windows-x86_64', 'windows-x86_64-nsis', 'windows-x86_64-msi'];
export const WINDOWS_PLATFORM_KEYS_MSI_FIRST = ['windows-x86_64-msi', 'windows-x86_64', 'windows-x86_64-nsis'];

export const MACOS_PLATFORM_KEYS: Record<string, string[]> = {
  arm64: ['darwin-aarch64-zip', 'darwin-aarch64'],
  x64: ['darwin-x86_64-zip', 'darwin-x86_64'],
};

export const LINUX_PLATFORM_KEYS: Record<string, string[]> = {
  arm64: ['linux-aarch64-appimage', 'linux-aarch64'],
  x64: ['linux-x86_64-appimage', 'linux-x86_64'],
};

/**
 * platforms 字段类型
 */
export type Platforms = Record<string, { url: string; signature?: string; size?: number }>;

/**
 * 安装类型
 */
export type InstallerType = 'nsis' | 'msi' | 'mac' | 'linux' | 'dev';

/**
 * 从 platforms 中按优先级获取第一个可用的下载 URL
 */
export function getDownloadUrlByKeys(platforms: Platforms | undefined, keys: string[]): string {
  if (!platforms) return '';
  for (const key of keys) {
    const entry = platforms[key];
    if (entry?.url) return entry.url;
  }
  return '';
}

/**
 * 从 OSS latest.json 解析当前 Windows 安装类型对应的下载地址
 */
export function getWindowsDownloadUrl(
  platforms: Platforms | undefined,
  installerType: InstallerType,
): string {
  const keys = installerType === 'msi' ? WINDOWS_PLATFORM_KEYS_MSI_FIRST : WINDOWS_PLATFORM_KEYS_NSIS_FIRST;
  return getDownloadUrlByKeys(platforms, keys);
}

/**
 * 从 OSS latest.json 解析当前 macOS 对应的下载地址（根据架构选择 arm64/x64）
 * @param platforms - latest.json 中的 platforms 字段
 * @param arch - 架构，默认使用 process.arch
 */
export function getMacosDownloadUrl(
  platforms: Platforms | undefined,
  arch: string = process.arch,
): string {
  const keys = MACOS_PLATFORM_KEYS[arch] || MACOS_PLATFORM_KEYS.x64;
  return getDownloadUrlByKeys(platforms, keys);
}

/**
 * 从 OSS latest.json 解析当前 Linux 对应的下载地址（根据架构选择 arm64/x64）
 * @param platforms - latest.json 中的 platforms 字段
 * @param arch - 架构，默认使用 process.arch
 */
export function getLinuxDownloadUrl(
  platforms: Platforms | undefined,
  arch: string = process.arch,
): string {
  const keys = LINUX_PLATFORM_KEYS[arch] || LINUX_PLATFORM_KEYS.x64;
  return getDownloadUrlByKeys(platforms, keys);
}

/**
 * 获取当前平台的下载 URL
 * @param platform - 操作系统平台 (win32/darwin/linux)
 * @param arch - 架构
 * @param platforms - latest.json 中的 platforms 字段
 * @param installerType - Windows 安装类型
 */
export function getPlatformDownloadUrl(
  platform: NodeJS.Platform,
  arch: string,
  platforms: Platforms | undefined,
  installerType?: InstallerType,
): string {
  if (platform === 'win32') {
    return getWindowsDownloadUrl(platforms, installerType || 'nsis');
  } else if (platform === 'darwin') {
    return getMacosDownloadUrl(platforms, arch);
  } else {
    return getLinuxDownloadUrl(platforms, arch);
  }
}
