/**
 * NuwaClaw GUI Tools - PoC 实现
 * 借鉴 OSWorld ACTION_SPACE 和 UI-TARS BrowserGUIAgent
 */

import { Type } from '@sinclair/typebox';
import type { Tool, ToolResult } from './types.js';
import screenshot from 'screenshot-desktop';
import sharp from 'sharp';

// 模拟 robotjs（实际需要安装）
// import * as robot from 'robotjs';
const robot = {
  moveMouse: async (x: number, y: number) => {
    console.log(`[MOCK] moveMouse(${x}, ${y})`);
  },
  mouseClick: async (button: 'left' | 'right' | 'middle' = 'left') => {
    console.log(`[MOCK] mouseClick(${button})`);
  },
  typeString: async (text: string) => {
    console.log(`[MOCK] typeString("${text}")`);
  },
};

/**
 * 生成唯一调用 ID
 */
function generateCallId(): string {
  return `call_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
}

/**
 * 延迟函数
 */
function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 ========== 工具 1: screenshot ==========
 */
export const screenshotTool: Tool = {
  name: 'screenshot',
  label: '📸 截取屏幕',
  description: '截取屏幕或指定区域，返回 base64 图片',

  parameters: Type.Object({
    region: Type.Optional(Type.Object({
      x: Type.Number({ minimum: 0 }),
      y: Type.Number({ minimum: 0 }),
      width: Type.Number({ minimum: 1 }),
      height: Type.Number({ minimum: 1 }),
    })),
    format: Type.Optional(Type.Union([
      Type.Literal('png'),
      Type.Literal('jpeg'),
      Type.Literal('webp'),
    ])),
    quality: Type.Optional(Type.Number({ minimum: 1, maximum: 100 })),
  }),

  execute: async (callId, params, signal, onUpdate) => {
    try {
      onUpdate?.({ details: { status: 'capturing', progress: 0 } });

      // 截图
      const buffer = await screenshot({ format: 'png' });

      onUpdate?.({ details: { status: 'capturing', progress: 50 } });

      // 压缩图片（借鉴 UI-TARS）
      let processedBuffer = buffer;
      const format = params.format || 'webp';
      const quality = params.quality || 80;

      if (format !== 'png' || quality < 100) {
        processedBuffer = await sharp(buffer)
          .toFormat(format, { quality })
          .toBuffer();
      }

      onUpdate?.({ details: { status: 'capturing', progress: 100 } });

      const base64 = processedBuffer.toString('base64');

      return {
        content: [{
          type: 'image',
          data: base64,
          mimeType: `image/${format}`,
        }],
        details: {
          size: processedBuffer.length,
          format,
          quality,
          timestamp: Date.now(),
        },
      };
    } catch (error) {
      return {
        content: [{
          type: 'text',
          text: `截图失败: ${error instanceof Error ? error.message : String(error)}`,
        }],
        details: {},
        isError: true,
      };
    }
  },
};

/**
 ========== 工具 2: click ==========
 */
export const clickTool: Tool = {
  name: 'click',
  label: '👆 点击',
  description: '点击屏幕指定位置',

  parameters: Type.Object({
    x: Type.Number({ minimum: 0 }),
    y: Type.Number({ minimum: 0 }),
    button: Type.Optional(Type.Union([
      Type.Literal('left'),
      Type.Literal('right'),
      Type.Literal('middle'),
    ])),
    numClicks: Type.Optional(Type.Number({ minimum: 1, maximum: 3 })),
  }),

  execute: async (callId, params, signal) => {
    try {
      // 移动鼠标
      await robot.moveMouse(params.x, params.y);
      await sleep(50);

      // 点击
      const button = params.button || 'left';
      const numClicks = params.numClicks || 1;

      for (let i = 0; i < numClicks; i++) {
        await robot.mouseClick(button);
        if (i < numClicks - 1) {
          await sleep(100);
        }
      }

      return {
        content: [{
          type: 'text',
          text: `已点击 (${params.x}, ${params.y})，按钮: ${button}，次数: ${numClicks}`,
        }],
        details: {
          x: params.x,
          y: params.y,
          button,
          numClicks,
        },
      };
    } catch (error) {
      return {
        content: [{
          type: 'text',
          text: `点击失败: ${error instanceof Error ? error.message : String(error)}`,
        }],
        details: {},
        isError: true,
      };
    }
  },
};

/**
 ========== 工具 3: type_text ==========
 */
export const typeTextTool: Tool = {
  name: 'type_text',
  label: '⌨️ 输入文本',
  description: '输入文本（支持流式进度）',

  parameters: Type.Object({
    text: Type.String({ minLength: 1 }),
    typingSpeed: Type.Optional(Type.Number({ minimum: 0, maximum: 1000 })),
  }),

  execute: async (callId, params, signal, onUpdate) => {
    try {
      const chars = params.text.length;
      const speed = params.typingSpeed || 50; // ms per char

      for (let i = 0; i < chars; i++) {
        // 检查取消信号
        if (signal?.aborted) {
          throw new Error('Typing aborted by user');
        }

        // 输入字符
        await robot.typeString(params.text[i]);

        // 流式进度更新
        if (i % 10 === 0 || i === chars - 1) {
          onUpdate?.({
            details: {
              progress: (i / chars) * 100,
              charsTyped: i + 1,
              totalChars: chars,
            },
          });
        }

        // 延迟
        if (speed > 0) {
          await sleep(speed);
        }
      }

      return {
        content: [{
          type: 'text',
          text: `已输入 ${chars} 个字符`,
        }],
        details: {
          length: chars,
          speed,
          text: params.text.substring(0, 50) + (chars > 50 ? '...' : ''),
        },
      };
    } catch (error) {
      return {
        content: [{
          type: 'text',
          text: `输入失败: ${error instanceof Error ? error.message : String(error)}`,
        }],
        details: {},
        isError: true,
      };
    }
  },
};

/**
 ========== 导出所有工具 ==========
 */
export const guiTools = [
  screenshotTool,
  clickTool,
  typeTextTool,
];
