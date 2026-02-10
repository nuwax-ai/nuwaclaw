// ============================================
// 权限类型定义
// ============================================

// 权限状态
export type PermissionStatus = "granted" | "denied" | "pending" | "unknown";

// 权限类别（与 Rust system-permissions 的 SystemPermission 对齐）
export type PermissionCategory =
  | "accessibility" // 辅助功能（键盘鼠标控制）
  | "screen_recording" // 屏幕录制
  | "microphone" // 麦克风
  | "camera" // 摄像头
  | "location" // 位置信息
  | "notifications" // 通知
  | "file_access" // 文件访问
  | "network" // 网络访问
  | "clipboard" // 剪贴板
  | "speech" // 语音识别
  | "nuwaxcode" // NuwaxCode 编辑器集成
  | "claude_code" // Claude Code 编辑器集成
  | "keyboard_monitoring"; // 键盘监控（全局快捷键）

// 权限项接口
export interface PermissionItem {
  id: PermissionCategory;
  name: string;
  displayName: string;
  description: string;
  status: PermissionStatus;
  required: boolean; // 是否必需权限
  platform: string[]; // 支持的平台
}

// 权限统计摘要
export interface PermissionsSummary {
  total: number;
  granted: number;
  requiredGranted: number;
  requiredTotal: number;
}

// 权限状态数据
export interface PermissionsState {
  items: PermissionItem[];
  summary: PermissionsSummary;
}

// 平台类型
export type Platform = "macos" | "windows" | "linux" | "unknown";

// ============================================
// 平台检测
// ============================================

/**
 * 获取当前运行平台
 *
 * 通过 navigator.platform 判断浏览器/应用运行的环境。
 * 返回值用于决定使用哪些权限配置和系统设置 URL。
 *
 * @returns {Platform} 当前平台标识
 *
 * @example
 * getCurrentPlatform(); // 'macos' | 'windows' | 'linux' | 'unknown'
 */
export function getCurrentPlatform(): Platform {
  const platform = navigator.platform.toLowerCase();
  if (platform.includes("mac") || platform.includes("darwin")) {
    return "macos";
  }
  if (platform.includes("win")) {
    return "windows";
  }
  if (platform.includes("linux")) {
    return "linux";
  }
  return "unknown";
}

// ============================================
// 权限配置定义
// ============================================

/**
 * 所有支持的权限配置
 *
 * 每个权限项包含：
 * - id: 权限唯一标识
 * - name: 权限英文名称
 * - displayName: 显示名称（中文）
 * - description: 权限用途说明
 * - required: 是否为核心必需权限
 * - platform: 支持该权限的平台列表
 *
 * 注意：status 字段由运行时检测决定，不在此配置中定义
 */
const PERMISSION_CONFIGS_BASE: Record<
  PermissionCategory,
  Omit<PermissionItem, "status">
> = {
  accessibility: {
    id: "accessibility",
    name: "accessibility",
    displayName: "辅助功能",
    description: "用于远程控制时模拟键盘鼠标输入",
    required: true,
    platform: ["macos", "windows", "linux"],
  },
  screen_recording: {
    id: "screen_recording",
    name: "screen_recording",
    displayName: "屏幕录制",
    description: "用于远程桌面实时画面传输",
    required: true,
    platform: ["macos", "windows", "linux"],
  },
  microphone: {
    id: "microphone",
    name: "microphone",
    displayName: "麦克风",
    description: "用于语音通话和音频输入",
    required: false,
    platform: ["macos", "windows", "linux"],
  },
  camera: {
    id: "camera",
    name: "camera",
    displayName: "摄像头",
    description: "用于视频通话功能",
    required: false,
    platform: ["macos", "windows", "linux"],
  },
  location: {
    id: "location",
    name: "location",
    displayName: "位置信息",
    description: "用于定位相关功能",
    required: false,
    platform: ["macos", "windows", "linux"],
  },
  notifications: {
    id: "notifications",
    name: "notifications",
    displayName: "通知",
    description: "用于发送系统通知",
    required: false,
    platform: ["macos", "windows"],
  },
  file_access: {
    id: "file_access",
    name: "file_access",
    displayName: "完全磁盘访问",
    description:
      "用于文件传输和本地文件操作，需要在系统设置中授予完全磁盘访问权限",
    required: true,
    platform: ["macos", "windows", "linux"],
  },
  network: {
    id: "network",
    name: "network",
    displayName: "网络访问",
    description: "用于与服务器建立通信连接",
    required: true,
    platform: ["macos", "windows", "linux"],
  },
  clipboard: {
    id: "clipboard",
    name: "clipboard",
    displayName: "剪贴板",
    description: "用于跨设备剪贴板同步",
    required: false,
    platform: ["macos", "windows"],
  },
  speech: {
    id: "speech",
    name: "speech",
    displayName: "语音识别",
    description: "用于语音命令输入",
    required: false,
    platform: ["macos", "windows"],
  },
  nuwaxcode: {
    id: "nuwaxcode",
    name: "nuwaxcode",
    displayName: "NuwaxCode",
    description: "用于 NuwaxCode 编辑器集成与自动化",
    required: false,
    platform: ["macos", "windows", "linux"],
  },
  claude_code: {
    id: "claude_code",
    name: "claude_code",
    displayName: "Claude Code",
    description: "用于 Claude Code 编辑器集成与自动化",
    required: false,
    platform: ["macos", "windows", "linux"],
  },
  keyboard_monitoring: {
    id: "keyboard_monitoring",
    name: "keyboard_monitoring",
    displayName: "键盘监控",
    description: "用于全局快捷键监听",
    required: false,
    platform: ["macos", "windows", "linux"],
  },
};

/**
 * 获取当前平台支持的权限配置
 *
 * 根据检测到的平台过滤权限配置，返回仅包含当前平台支持的权限列表。
 *
 * @returns {Record<PermissionCategory, Omit<PermissionItem, "status">>} 当前平台的权限配置
 *
 * @example
 * const configs = getPlatformPermissionConfigs();
 * console.log(configs.accessibility); // 当前平台支持则返回，否则 undefined
 */
export function getPlatformPermissionConfigs(): Record<
  PermissionCategory,
  Omit<PermissionItem, "status">
> {
  const platform = getCurrentPlatform();
  const result: Record<
    PermissionCategory,
    Omit<PermissionItem, "status">
  > = {} as Record<PermissionCategory, Omit<PermissionItem, "status">>;

  for (const [key, value] of Object.entries(PERMISSION_CONFIGS_BASE)) {
    if (value.platform.includes(platform)) {
      result[key as PermissionCategory] = value;
    }
  }

  return result;
}

/**
 * 获取所有权限配置（不区分平台）
 *
 * @returns {Record<PermissionCategory, Omit<PermissionItem, "status">>} 所有平台权限配置
 */
export function getAllPermissionConfigs(): Record<
  PermissionCategory,
  Omit<PermissionItem, "status">
> {
  return { ...PERMISSION_CONFIGS_BASE };
}

// ============================================
// 多平台系统设置 URL 映射
// ============================================

/**
 * macOS 系统设置 URL Scheme
 *
 * 使用 x-apple.systempreferences:// 协议打开系统偏好设置中的特定面板。
 * 该协议在 macOS 系统中可直接打开对应的设置页面。
 */
const MACOS_SETTINGS_URLS: Record<PermissionCategory, string> = {
  accessibility: "x-apple.systempreferences:com.apple.security.accessibility",
  screen_recording:
    "x-apple.systempreferences:com.apple.security.screenRecording",
  microphone: "x-apple.systempreferences:com.apple.security.privacy-microphone",
  camera: "x-apple.systempreferences:com.apple.security.privacy-camera",
  location: "x-apple.systempreferences:com.apple.security.privacy-location",
  notifications:
    "x-apple.systempreferences:com.apple.security.privacy-notifications",
  file_access: "x-apple.systempreferences:com.apple.security.privacy.files",
  network: "x-apple.systempreferences:com.apple.security.firewall",
  clipboard: "x-apple.systempreferences:com.apple.security.accessibility",
  speech:
    "x-apple.systempreferences:com.apple.security.privacy-speechRecognition",
  nuwaxcode: "x-apple.systempreferences:com.apple.security.privacy.all",
  claude_code: "x-apple.systempreferences:com.apple.security.privacy.all",
  keyboard_monitoring:
    "x-apple.systempreferences:com.apple.security.privacy.inputMonitoring",
};

/**
 * Windows 系统设置 URI Scheme
 *
 * 使用 ms-settings: 协议打开 Windows 系统设置中的特定页面。
 * 该协议在 Windows 10/11 系统中可直接打开对应的设置页面。
 *
 * 注意：部分设置页面可能在不同 Windows 版本中路径略有不同。
 */
const WINDOWS_SETTINGS_URLS: Record<PermissionCategory, string> = {
  accessibility: "ms-settings:accessibility",
  screen_recording: "ms-settings:privacy-webcam",
  microphone: "ms-settings:privacy-microphone",
  camera: "ms-settings:privacy-webcam",
  location: "ms-settings:privacy-location",
  notifications: "ms-settings:notifications",
  file_access: "ms-settings:privacy-broadfileaccess",
  network: "ms-settings:network-proxy",
  clipboard: "ms-settings:clipboard",
  speech: "ms-settings:speech",
  nuwaxcode: "ms-settings:appsfeatures",
  claude_code: "ms-settings:appsfeatures",
  keyboard_monitoring: "ms-settings:keyboard",
};

/**
 * Linux 系统设置 URI Scheme
 *
 * Linux 桌面环境众多，使用 xdg-open 打开通用设置页面。
 * 不同桌面环境（GNOME、KDE、XFCE 等）会打开各自的设置应用。
 */
const LINUX_SETTINGS_URLS: Record<PermissionCategory, string> = {
  accessibility: "xdg-open preferences://Accessibility",
  screen_recording: "xdg-open gnome-control-center privacy",
  microphone: "xdg-open gnome-control-center privacy",
  camera: "xdg-open gnome-control-center privacy",
  location: "xdg-open gnome-control-center privacy",
  notifications: "xdg-open gnome-control-center notifications",
  file_access: "xdg-open gnome-control-center privacy",
  network: "xdg-open gnome-control-center network",
  clipboard: "xdg-open gnome-control-center keyboard",
  speech: "xdg-open gnome-control-center privacy",
  nuwaxcode: "xdg-open applications://",
  claude_code: "xdg-open applications://",
  keyboard_monitoring: "xdg-open gnome-control-center keyboard",
};

/**
 * 完全磁盘访问面板 URL（macOS 专用）
 *
 * 该 URL 直接指向 macOS 系统设置中的「完全磁盘访问权限」面板。
 * 用于文件传输等需要深度文件系统访问的功能。
 */
export const MACOS_FULL_DISK_ACCESS_URL =
  "x-apple.systempreferences:com.apple.preference.security?Privacy_AllFiles";

/**
 * 获取当前平台的系统设置 URL
 *
 * 根据检测到的平台返回对应权限的系统设置页面 URL。
 * 如果平台未知或权限不支持，返回 undefined。
 *
 * @param {PermissionCategory} category - 权限类别
 * @returns {string | undefined} 系统设置 URL，未知时返回 undefined
 *
 * @example
 * const url = getSettingsUrl('accessibility');
 * if (url) openUrl(url);
 */
export function getSettingsUrl(
  category: PermissionCategory,
): string | undefined {
  const platform = getCurrentPlatform();

  switch (platform) {
    case "macos":
      return MACOS_SETTINGS_URLS[category];
    case "windows":
      return WINDOWS_SETTINGS_URLS[category];
    case "linux":
      return LINUX_SETTINGS_URLS[category];
    default:
      return undefined;
  }
}

/**
 * 获取当前平台的完全磁盘访问设置 URL
 *
 * @returns {string} 平台对应的完全磁盘访问设置 URL
 */
export function getFullDiskAccessUrl(): string {
  const platform = getCurrentPlatform();

  switch (platform) {
    case "macos":
      return MACOS_FULL_DISK_ACCESS_URL;
    case "windows":
      return WINDOWS_SETTINGS_URLS.file_access;
    case "linux":
      return LINUX_SETTINGS_URLS.file_access;
    default:
      return "";
  }
}
