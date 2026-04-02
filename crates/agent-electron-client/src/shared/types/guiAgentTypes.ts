/**
 * GUI Agent 共享类型定义
 *
 * Agent 通过 bash curl 调用本地 HTTP 服务完成截图和键鼠操作，
 * 支持 Windows/macOS/Linux 三平台（含权限授权）。
 */

// ==================== 配置 ====================

export interface GuiAgentConfig {
  /** 是否启用 GUI Agent */
  enabled: boolean;
  /** HTTP 服务端口 */
  port: number;
  /** 截图默认缩放比例 (0.1 - 1.0) */
  screenshotScale: number;
  /** 截图默认格式 */
  screenshotFormat: "png" | "jpeg";
  /** JPEG 质量 (1-100) */
  screenshotQuality: number;
  /** 速率限制 (ops/s) */
  rateLimit: number;
}

export const DEFAULT_GUI_AGENT_CONFIG: GuiAgentConfig = {
  enabled: false,
  port: 60010,
  screenshotScale: 0.5,
  screenshotFormat: "jpeg",
  screenshotQuality: 80,
  rateLimit: 10,
};

// ==================== 截图 ====================

export interface ScreenshotRequest {
  /** 缩放比例 (0.1 - 1.0)，默认使用配置值 */
  scale?: number;
  /** 输出格式 */
  format?: "png" | "jpeg";
  /** JPEG 质量 (1-100) */
  quality?: number;
  /** 裁剪区域 */
  region?: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
  /** 显示器索引 (默认 0 = 主屏幕) */
  displayIndex?: number;
}

export interface ScreenshotResponse {
  /** base64 编码的图片数据 */
  image: string;
  /** MIME 类型 */
  mimeType: string;
  /** 原始屏幕宽度 */
  width: number;
  /** 原始屏幕高度 */
  height: number;
  /** 缩放后宽度 */
  scaledWidth: number;
  /** 缩放后高度 */
  scaledHeight: number;
  /** 截图耗时 (ms) */
  elapsed: number;
}

// ==================== 键鼠输入 ====================

export type MouseButton = "left" | "right" | "middle";

export type InputAction =
  | { type: "mouse_move"; x: number; y: number }
  | { type: "mouse_click"; x: number; y: number; button?: MouseButton }
  | { type: "mouse_double_click"; x: number; y: number; button?: MouseButton }
  | {
      type: "mouse_drag";
      startX: number;
      startY: number;
      endX: number;
      endY: number;
      button?: MouseButton;
    }
  | {
      type: "mouse_scroll";
      x: number;
      y: number;
      deltaX?: number;
      deltaY: number;
    }
  | { type: "keyboard_type"; text: string }
  | { type: "keyboard_press"; key: string }
  | { type: "keyboard_hotkey"; keys: string[] };

export interface InputRequest {
  /** 要执行的操作 */
  action: InputAction;
  /** 操作前延迟 (ms) */
  delay?: number;
}

export interface InputResponse {
  /** 是否成功 */
  success: boolean;
  /** 操作类型 */
  action: string;
  /** 执行耗时 (ms) */
  elapsed: number;
}

// ==================== 权限 ====================

export type GuiPermissionState =
  | "granted"
  | "denied"
  | "not_determined"
  | "not_needed"
  | "unknown";

export interface GuiPermissionInfo {
  /** 截图权限 */
  screenCapture: GuiPermissionState;
  /** 辅助功能权限 (键鼠控制) */
  accessibility: GuiPermissionState;
  /** 当前平台 */
  platform: NodeJS.Platform;
  /** 显示环境 (Linux: x11 / wayland) */
  displayServer?: "x11" | "wayland" | "unknown";
  /** xdotool 是否可用 (Linux) */
  xdotoolAvailable?: boolean;
}

// ==================== 服务状态 ====================

export interface GuiAgentStatus {
  /** 服务是否运行中 */
  running: boolean;
  /** 监听端口 */
  port?: number;
  /** 认证 Token */
  token?: string;
  /** 错误信息 */
  error?: string;
}

// ==================== 审计日志 ====================

export interface AuditLogEntry {
  /** 时间戳 */
  timestamp: number;
  /** 操作路径 */
  path: string;
  /** 操作类型 */
  action: string;
  /** 是否成功 */
  success: boolean;
  /** 耗时 (ms) */
  elapsed?: number;
  /** 错误信息 */
  error?: string;
}
