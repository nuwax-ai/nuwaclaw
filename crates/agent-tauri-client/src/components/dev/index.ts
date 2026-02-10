/**
 * 开发工具模块
 *
 * 统一导出开发环境专用组件
 *
 * 使用方式：
 * ```typescript
 * import { IS_DEV, DevToolsPanel } from '../components/dev';
 *
 * // 在组件中
 * {IS_DEV && DevToolsPanel && (
 *   <Suspense fallback={<Spin />}>
 *     <DevToolsPanel />
 *   </Suspense>
 * )}
 * ```
 *
 * 注意：
 * - 所有组件仅在开发环境下加载
 * - 使用 React.lazy 动态导入，确保生产环境不打包
 */

import React from "react";

/**
 * 是否为开发环境
 */
export const IS_DEV = import.meta.env.DEV;

/**
 * 开发工具面板组件（动态导入）
 * 生产环境返回 null，不会打包相关代码
 */
export const DevToolsPanel = IS_DEV
  ? React.lazy(() => import("./DevToolsPanel"))
  : null;

/**
 * 重置工具组件（动态导入）
 * 通常不需要单独使用，DevToolsPanel 已包含
 */
export const DevResetTools = IS_DEV
  ? React.lazy(() => import("./DevResetTools"))
  : null;

/**
 * 场景管理组件（动态导入）
 * 通常不需要单独使用，DevToolsPanel 已包含
 */
export const DevSceneManager = IS_DEV
  ? React.lazy(() => import("./DevSceneManager"))
  : null;

/**
 * 配置编辑器组件（动态导入）
 * 通常不需要单独使用，DevSceneManager 内部使用
 */
export const DevConfigEditor = IS_DEV
  ? React.lazy(() => import("./DevConfigEditor"))
  : null;

/**
 * Store 数据查看器组件（动态导入）
 * 通常不需要单独使用，DevToolsPanel 已包含
 */
export const DevStoreViewer = IS_DEV
  ? React.lazy(() => import("./DevStoreViewer"))
  : null;
