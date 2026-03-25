/**
 * NuwaClaw GUI Agent - Tools with Python Bridge
 * 
 * 真正调用 Python 桥接的工具实现
 */

import type { Tool, ActionParameters, ProgressUpdate } from './types';
import { PythonBridge } from './bridge';

/**
 * 创建连接 Python 桥接的工具集
 */
export function createBridgeTools(bridge: PythonBridge): Tool[] {
  return [
    {
      name: 'screenshot',
      label: '📸 截取屏幕',
      description: '截取屏幕或指定区域，返回 base64 图片',
      parameters: {
        type: 'object',
        properties: {
          region: {
            type: 'object',
            description: '截图区域',
            properties: {
              x: { type: 'number' },
              y: { type: 'number' },
              width: { type: 'number' },
              height: { type: 'number' },
            },
          },
          format: {
            type: 'string',
            enum: ['png', 'webp', 'jpeg'],
            description: '图片格式',
          },
        },
      },
      execute: async (callId, params, signal, onUpdate) => {
        onUpdate?.({ progress: 20, status: 'capturing' });
        
        const result = await bridge.screenshot({
          region: params.region as any,
          format: params.format as 'png' | 'webp' | 'jpeg',
        });
        
        onUpdate?.({ progress: 100, status: 'done' });
        
        return {
          content: [
            {
              type: 'image',
              data: result.image,
              mimeType: `image/${result.format}`,
            },
          ],
          details: { width: result.width, height: result.height },
        };
      },
    },

    {
      name: 'click',
      label: '🖱️ 点击',
      description: '点击屏幕指定位置',
      parameters: {
        type: 'object',
        properties: {
          x: { type: 'number', description: 'X 坐标' },
          y: { type: 'number', description: 'Y 坐标' },
          button: { type: 'string', enum: ['left', 'right', 'middle'], default: 'left' },
          num_clicks: { type: 'number', default: 1 },
        },
        required: ['x', 'y'],
      },
      execute: async (callId, params, signal, onUpdate) => {
        onUpdate?.({ progress: 20, status: 'clicking' });
        
        const result = await bridge.executeAction('CLICK', params);
        
        onUpdate?.({ progress: 100, status: 'done' });
        
        return {
          content: [{ type: 'text', text: result.message || `Clicked at (${params.x}, ${params.y})` }],
          details: { success: result.success },
        };
      },
    },

    {
      name: 'double_click',
      label: '🖱️🖱️ 双击',
      description: '双击屏幕指定位置',
      parameters: {
        type: 'object',
        properties: {
          x: { type: 'number' },
          y: { type: 'number' },
        },
        required: ['x', 'y'],
      },
      execute: async (callId, params, signal, onUpdate) => {
        onUpdate?.({ progress: 20, status: 'double clicking' });
        
        const result = await bridge.executeAction('DOUBLE_CLICK', params);
        
        onUpdate?.({ progress: 100, status: 'done' });
        
        return {
          content: [{ type: 'text', text: result.message || `Double clicked at (${params.x}, ${params.y})` }],
          details: { success: result.success },
        };
      },
    },

    {
      name: 'right_click',
      label: '🖱️ 右键点击',
      description: '右键点击屏幕指定位置',
      parameters: {
        type: 'object',
        properties: {
          x: { type: 'number' },
          y: { type: 'number' },
        },
        required: ['x', 'y'],
      },
      execute: async (callId, params, signal, onUpdate) => {
        onUpdate?.({ progress: 20, status: 'right clicking' });
        
        const result = await bridge.executeAction('RIGHT_CLICK', params);
        
        onUpdate?.({ progress: 100, status: 'done' });
        
        return {
          content: [{ type: 'text', text: result.message || `Right clicked at (${params.x}, ${params.y})` }],
          details: { success: result.success },
        };
      },
    },

    {
      name: 'move_to',
      label: '🖱️ 移动鼠标',
      description: '移动鼠标到指定位置',
      parameters: {
        type: 'object',
        properties: {
          x: { type: 'number' },
          y: { type: 'number' },
        },
        required: ['x', 'y'],
      },
      execute: async (callId, params, signal, onUpdate) => {
        onUpdate?.({ progress: 20, status: 'moving' });
        
        const result = await bridge.executeAction('MOVE_TO', params);
        
        onUpdate?.({ progress: 100, status: 'done' });
        
        return {
          content: [{ type: 'text', text: result.message || `Moved to (${params.x}, ${params.y})` }],
          details: { success: result.success },
        };
      },
    },

    {
      name: 'drag_to',
      label: '🖱️ 拖拽',
      description: '拖拽到指定位置',
      parameters: {
        type: 'object',
        properties: {
          x: { type: 'number' },
          y: { type: 'number' },
        },
        required: ['x', 'y'],
      },
      execute: async (callId, params, signal, onUpdate) => {
        onUpdate?.({ progress: 20, status: 'dragging' });
        
        const result = await bridge.executeAction('DRAG_TO', params);
        
        onUpdate?.({ progress: 100, status: 'done' });
        
        return {
          content: [{ type: 'text', text: result.message || `Dragged to (${params.x}, ${params.y})` }],
          details: { success: result.success },
        };
      },
    },

    {
      name: 'scroll',
      label: '📜 滚动',
      description: '滚动屏幕',
      parameters: {
        type: 'object',
        properties: {
          dx: { type: 'number', description: '水平滚动量' },
          dy: { type: 'number', description: '垂直滚动量' },
        },
        required: ['dy'],
      },
      execute: async (callId, params, signal, onUpdate) => {
        onUpdate?.({ progress: 20, status: 'scrolling' });
        
        const result = await bridge.executeAction('SCROLL', params);
        
        onUpdate?.({ progress: 100, status: 'done' });
        
        return {
          content: [{ type: 'text', text: result.message || `Scrolled (${params.dx || 0}, ${params.dy})` }],
          details: { success: result.success },
        };
      },
    },

    {
      name: 'type_text',
      label: '⌨️ 输入文本',
      description: '输入文本到当前位置',
      parameters: {
        type: 'object',
        properties: {
          text: { type: 'string', description: '要输入的文本' },
        },
        required: ['text'],
      },
      execute: async (callId, params, signal, onUpdate) => {
        onUpdate?.({ progress: 20, status: 'typing' });
        
        const result = await bridge.executeAction('TYPING', params);
        
        onUpdate?.({ progress: 100, status: 'done' });
        
        return {
          content: [{ type: 'text', text: result.message || `Typed: ${params.text}` }],
          details: { success: result.success, length: params.text?.length },
        };
      },
    },

    {
      name: 'press',
      label: '⌨️ 按键',
      description: '按下指定按键',
      parameters: {
        type: 'object',
        properties: {
          key: { type: 'string', description: '按键名称' },
        },
        required: ['key'],
      },
      execute: async (callId, params, signal, onUpdate) => {
        onUpdate?.({ progress: 20, status: 'pressing' });
        
        const result = await bridge.executeAction('PRESS', params);
        
        onUpdate?.({ progress: 100, status: 'done' });
        
        return {
          content: [{ type: 'text', text: result.message || `Pressed: ${params.key}` }],
          details: { success: result.success },
        };
      },
    },

    {
      name: 'hotkey',
      label: '🎹 快捷键',
      description: '按下快捷键组合',
      parameters: {
        type: 'object',
        properties: {
          keys: {
            type: 'array',
            items: { type: 'string' },
            description: '按键组合，如 ["command", "c"]',
          },
        },
        required: ['keys'],
      },
      execute: async (callId, params, signal, onUpdate) => {
        onUpdate?.({ progress: 20, status: 'pressing hotkey' });
        
        const result = await bridge.executeAction('HOTKEY', params);
        
        onUpdate?.({ progress: 100, status: 'done' });
        
        return {
          content: [{ type: 'text', text: result.message || `Hotkey: ${params.keys?.join('+')}` }],
          details: { success: result.success },
        };
      },
    },

    {
      name: 'locate_image',
      label: '🔍 定位图像',
      description: '在屏幕上定位指定图像',
      parameters: {
        type: 'object',
        properties: {
          image: { type: 'string', description: '图像文件路径或 base64' },
          confidence: { type: 'number', description: '匹配置信度 (0-1)', default: 0.9 },
        },
        required: ['image'],
      },
      execute: async (callId, params, signal, onUpdate) => {
        onUpdate?.({ progress: 20, status: 'locating' });
        
        const result = await bridge.locateImage(params.image as string, params.confidence);
        
        onUpdate?.({ progress: 100, status: 'done' });
        
        if (result) {
          return {
            content: [
              {
                type: 'text',
                text: `Found at (${result.x}, ${result.y}), size: ${result.width}x${result.height}`,
              },
            ],
            details: result,
          };
        } else {
          return {
            content: [{ type: 'text', text: 'Image not found' }],
            details: { found: false },
          };
        }
      },
    },

    {
      name: 'get_mouse_position',
      label: '📍 获取鼠标位置',
      description: '获取当前鼠标位置',
      parameters: { type: 'object' },
      execute: async (callId, params, signal, onUpdate) => {
        const result = await bridge.getMousePosition();
        
        return {
          content: [{ type: 'text', text: `Mouse at (${result.x}, ${result.y})` }],
          details: result,
        };
      },
    },

    {
      name: 'wait',
      label: '⏳ 等待',
      description: '等待指定时间',
      parameters: {
        type: 'object',
        properties: {
          duration: { type: 'number', description: '等待秒数', default: 5 },
        },
      },
      execute: async (callId, params, signal, onUpdate) => {
        const duration = (params.duration as number) || 5;
        onUpdate?.({ progress: 0, status: 'waiting' });
        
        await bridge.executeAction('WAIT', params);
        
        onUpdate?.({ progress: 100, status: 'done' });
        
        return {
          content: [{ type: 'text', text: `Waited ${duration} seconds` }],
        };
      },
    },
  ];
}

/**
 * 创建完整的 GUI Agent（带 Python 桥接）
 */
export async function createFullGUIAgent(
  bridgeConfig?: ConstructorParameters<typeof PythonBridge>[0]
): Promise<{ agent: any; bridge: PythonBridge }> {
  const { GUIAgent } = await import('./agent');
  
  const bridge = new PythonBridge(bridgeConfig);
  await bridge.start();
  
  const tools = createBridgeTools(bridge);
  
  const agent = new GUIAgent({ tools });
  
  return { agent, bridge };
}
