/**
 * 初始化向导服务
 * 管理首次启动配置流程
 * 
 * 功能:
 * - 检查初始化状态
 * - 管理向导步骤进度
 * - 保存/读取配置数据
 * - 断点续传支持
 */

import { invoke } from '@tauri-apps/api/core';
import {
  setupStorage,
  initStore,
  type SetupState,
  DEFAULT_SETUP_STATE,
} from './store';

// 导出类型
export type { SetupState };
export { DEFAULT_SETUP_STATE };

// ========== 初始化检查 ==========

/**
 * 检查是否完成初始化
 * @returns 是否已完成初始化向导
 */
export async function isSetupCompleted(): Promise<boolean> {
  try {
    await initStore();
    return await setupStorage.isCompleted();
  } catch (error) {
    console.error('[Setup] 检查初始化状态失败:', error);
    return false;
  }
}

/**
 * 获取当前初始化状态
 * @returns 完整的初始化状态
 */
export async function getSetupState(): Promise<SetupState> {
  try {
    await initStore();
    return await setupStorage.getState();
  } catch (error) {
    console.error('[Setup] 获取初始化状态失败:', error);
    return DEFAULT_SETUP_STATE;
  }
}

/**
 * 获取当前步骤
 * @returns 当前步骤编号 (1/2/3)
 */
export async function getCurrentStep(): Promise<number> {
  try {
    await initStore();
    return await setupStorage.getCurrentStep();
  } catch (error) {
    console.error('[Setup] 获取当前步骤失败:', error);
    return 1;
  }
}

// ========== 步骤1: 基础设置 ==========

/**
 * 步骤1配置数据
 */
export interface Step1Config {
  serverHost: string;      // 服务域名
  agentPort: number;       // Agent 服务端口
  fileServerPort: number;  // 文件服务端口
  proxyPort: number;       // 代理服务端口
  workspaceDir: string;    // 工作区目录
}

/**
 * 保存步骤1配置
 * @param config 步骤1配置数据
 */
export async function saveStep1Config(config: Step1Config): Promise<void> {
  try {
    await initStore();
    await setupStorage.saveStep1(config);
    console.log('[Setup] 步骤1配置已保存:', config);
  } catch (error) {
    console.error('[Setup] 保存步骤1配置失败:', error);
    throw error;
  }
}

/**
 * 获取步骤1配置
 * @returns 步骤1配置数据
 */
export async function getStep1Config(): Promise<Step1Config> {
  const state = await getSetupState();
  return {
    serverHost: state.serverHost,
    agentPort: state.agentPort,
    fileServerPort: state.fileServerPort,
    proxyPort: state.proxyPort,
    workspaceDir: state.workspaceDir,
  };
}

// ========== 步骤2: 账号登录 ==========

/**
 * 完成步骤2（账号登录成功后调用）
 */
export async function completeStep2(): Promise<void> {
  try {
    await initStore();
    await setupStorage.completeStep2();
    console.log('[Setup] 步骤2已完成');
  } catch (error) {
    console.error('[Setup] 完成步骤2失败:', error);
    throw error;
  }
}

// ========== 步骤3: 依赖安装 ==========

/**
 * 完成步骤3并完成整个初始化流程
 */
export async function completeStep3(): Promise<void> {
  try {
    await initStore();
    await setupStorage.complete();
    console.log('[Setup] 初始化向导已完成');
  } catch (error) {
    console.error('[Setup] 完成步骤3失败:', error);
    throw error;
  }
}

// ========== 完成/重置 ==========

/**
 * 完成初始化
 */
export async function completeSetup(): Promise<void> {
  try {
    await initStore();
    await setupStorage.complete();
    console.log('[Setup] 初始化已完成');
  } catch (error) {
    console.error('[Setup] 完成初始化失败:', error);
    throw error;
  }
}

/**
 * 重置初始化状态
 * 清除所有初始化数据，下次启动将重新显示向导
 */
export async function resetSetup(): Promise<void> {
  try {
    await initStore();
    await setupStorage.reset();
    console.log('[Setup] 初始化状态已重置');
  } catch (error) {
    console.error('[Setup] 重置初始化状态失败:', error);
    throw error;
  }
}

// ========== 工具函数 ==========

/**
 * 获取应用数据目录路径
 * @returns 应用数据目录（如 ~/Library/Application Support/com.nuwax.agent）
 */
export async function getAppDataDir(): Promise<string> {
  try {
    const dir = await invoke<string>('app_data_dir_get');
    return dir;
  } catch (error) {
    console.error('[Setup] 获取应用数据目录失败:', error);
    throw error;
  }
}

/**
 * 选择目录对话框
 * @returns 用户选择的目录路径，取消返回 null
 */
export async function selectDirectory(): Promise<string | null> {
  try {
    const dir = await invoke<string | null>('dialog_select_directory');
    return dir;
  } catch (error) {
    console.error('[Setup] 选择目录失败:', error);
    return null;
  }
}

/**
 * 保存步骤进度
 * @param step 步骤编号
 */
export async function saveStepProgress(step: number): Promise<void> {
  try {
    await initStore();
    await setupStorage.setCurrentStep(step);
    console.log('[Setup] 步骤进度已保存:', step);
  } catch (error) {
    console.error('[Setup] 保存步骤进度失败:', error);
    throw error;
  }
}

/**
 * 跳转到指定步骤
 * 用于断点续传场景
 * @param step 目标步骤
 */
export async function goToStep(step: number): Promise<void> {
  if (step < 1 || step > 3) {
    console.warn('[Setup] 无效的步骤编号:', step);
    return;
  }
  await saveStepProgress(step);
}
