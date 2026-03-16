/**
 * GUI Agent 跨平台截图服务
 *
 * 使用 Electron desktopCapturer API 截取屏幕，
 * 支持缩放、区域裁剪、多格式输出。
 */

import { desktopCapturer, screen } from 'electron';
import log from 'electron-log';
import type { ScreenshotRequest, ScreenshotResponse } from '@shared/types/guiAgentTypes';

const TAG = '[GuiScreenshot]';

/**
 * 截取屏幕
 *
 * @param opts 截图参数
 * @param defaultScale 默认缩放比例 (来自配置)
 * @param defaultFormat 默认格式
 * @param defaultQuality 默认 JPEG 质量
 */
export async function takeScreenshot(
  opts: ScreenshotRequest = {},
  defaultScale = 0.5,
  defaultFormat: 'png' | 'jpeg' = 'jpeg',
  defaultQuality = 80,
): Promise<ScreenshotResponse> {
  const t0 = Date.now();

  const scale = Math.max(0.1, Math.min(1.0, opts.scale ?? defaultScale));
  const format = opts.format ?? defaultFormat;
  const quality = opts.quality ?? defaultQuality;

  // Get display info
  const displays = screen.getAllDisplays();
  const displayIndex = opts.displayIndex ?? 0;
  const targetDisplay = displays[displayIndex] || displays[0];

  if (!targetDisplay) {
    throw new Error('No display available');
  }

  const { width: screenWidth, height: screenHeight } = targetDisplay.size;
  const scaleFactor = targetDisplay.scaleFactor || 1;

  // Calculate thumbnail size (physical pixels → logical pixels scaled)
  const thumbnailWidth = Math.round(screenWidth * scaleFactor * scale);
  const thumbnailHeight = Math.round(screenHeight * scaleFactor * scale);

  log.debug(`${TAG} Capturing: display=${displayIndex}, size=${screenWidth}x${screenHeight}, scale=${scale}, thumbnailSize=${thumbnailWidth}x${thumbnailHeight}`);

  // Capture using desktopCapturer
  const sources = await desktopCapturer.getSources({
    types: ['screen'],
    thumbnailSize: { width: thumbnailWidth, height: thumbnailHeight },
  });

  if (!sources || sources.length === 0) {
    throw new Error('No screen sources available. Check screen capture permissions.');
  }

  // Match the target display
  const source = sources[displayIndex] || sources[0];
  let image = source.thumbnail;

  if (image.isEmpty()) {
    throw new Error('Screenshot is empty. Screen capture permission may not be granted.');
  }

  // Crop region if specified
  if (opts.region) {
    const { x, y, width, height } = opts.region;
    // Scale region coordinates to match the thumbnail
    const cropX = Math.round(x * scale);
    const cropY = Math.round(y * scale);
    const cropW = Math.round(width * scale);
    const cropH = Math.round(height * scale);
    image = image.crop({ x: cropX, y: cropY, width: cropW, height: cropH });
  }

  // Encode to base64
  let base64: string;
  let mimeType: string;
  if (format === 'jpeg') {
    base64 = image.toJPEG(quality).toString('base64');
    mimeType = 'image/jpeg';
  } else {
    base64 = image.toPNG().toString('base64');
    mimeType = 'image/png';
  }

  const elapsed = Date.now() - t0;
  const scaledSize = image.getSize();

  log.debug(`${TAG} Screenshot captured: ${scaledSize.width}x${scaledSize.height}, format=${format}, size=${Math.round(base64.length / 1024)}KB, elapsed=${elapsed}ms`);

  return {
    image: base64,
    mimeType,
    width: screenWidth,
    height: screenHeight,
    scaledWidth: scaledSize.width,
    scaledHeight: scaledSize.height,
    elapsed,
  };
}

/**
 * 获取所有显示器信息
 */
export function getDisplaysInfo(): Array<{
  id: number;
  label: string;
  width: number;
  height: number;
  scaleFactor: number;
  isPrimary: boolean;
}> {
  const displays = screen.getAllDisplays();
  const primary = screen.getPrimaryDisplay();

  return displays.map((d, i) => ({
    id: d.id,
    label: `Display ${i}${d.id === primary.id ? ' (Primary)' : ''}`,
    width: d.size.width,
    height: d.size.height,
    scaleFactor: d.scaleFactor,
    isPrimary: d.id === primary.id,
  }));
}
