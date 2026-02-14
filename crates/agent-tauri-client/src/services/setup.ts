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

import { invoke } from "@tauri-apps/api/core";
import {
  setupStorage,
  initStore,
  type SetupState,
  DEFAULT_SETUP_STATE,
} from "./store";
import { DEFAULT_MCP_PROXY_PORT, DEFAULT_MCP_PROXY_CONFIG } from "../constants";

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
    console.error("[Setup] 检查初始化状态失败:", error);
    return false;
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
    console.error("[Setup] 获取当前步骤失败:", error);
    return 1;
  }
}

// ========== 步骤1: 基础设置 ==========

/**
 * 步骤1配置数据
 */
export interface Step1Config {
  serverHost: string; // 服务域名
  agentPort: number; // Agent 服务端口
  fileServerPort: number; // 文件服务端口
  proxyPort: number; // 代理服务端口
  workspaceDir: string; // 工作区目录
}

/**
 * 保存步骤1配置
 * @param config 步骤1配置数据
 */
export async function saveStep1Config(config: Step1Config): Promise<void> {
  try {
    await initStore();
    await setupStorage.saveStep1(config);
    console.log("[Setup] 步骤1配置已保存:", config);
  } catch (error) {
    console.error("[Setup] 保存步骤1配置失败:", error);
    throw error;
  }
}

/**
 * 获取步骤1配置
 * @returns 步骤1配置数据
 */
export async function getStep1Config(): Promise<Step1Config> {
  let state: SetupState;
  try {
    await initStore();
    state = await setupStorage.getState();
  } catch {
    state = DEFAULT_SETUP_STATE;
  }
  return {
    serverHost: state.serverHost,
    agentPort: state.agentPort,
    fileServerPort: state.fileServerPort,
    proxyPort: state.proxyPort,
    workspaceDir: state.workspaceDir,
  };
}

/**
 * 获取依赖筛选条件
 */
export async function getDepsFilter(): Promise<string | null> {
  try {
    await initStore();
    return await setupStorage.getDepsFilter();
  } catch (error) {
    console.error("[Setup] 获取依赖筛选失败:", error);
    return null;
  }
}

/**
 * 设置依赖筛选条件
 */
export async function setDepsFilter(value: string): Promise<void> {
  try {
    await initStore();
    await setupStorage.setDepsFilter(value);
  } catch (error) {
    console.error("[Setup] 保存依赖筛选失败:", error);
  }
}

/**
 * 获取是否展开全部依赖
 */
export async function getDepsShowAll(): Promise<boolean | null> {
  try {
    await initStore();
    return await setupStorage.getDepsShowAll();
  } catch (error) {
    console.error("[Setup] 获取依赖显示状态失败:", error);
    return null;
  }
}

/**
 * 设置是否展开全部依赖
 */
export async function setDepsShowAll(value: boolean): Promise<void> {
  try {
    await initStore();
    await setupStorage.setDepsShowAll(value);
  } catch (error) {
    console.error("[Setup] 保存依赖显示状态失败:", error);
  }
}

// ========== 步骤2: 账号登录 ==========

/**
 * 完成步骤2（账号登录成功后调用）
 */
export async function completeStep2(): Promise<void> {
  try {
    await initStore();
    await setupStorage.completeStep2();
    console.log("[Setup] 步骤2已完成");
  } catch (error) {
    console.error("[Setup] 完成步骤2失败:", error);
    throw error;
  }
}

// ========== 完成/重置 ==========

/**
 * 完成初始化
 */
export async function completeSetup(): Promise<void> {
  console.log("[Setup] completeSetup: 开始");
  try {
    console.log("[Setup] completeSetup: 调用 initStore");
    await initStore();
    console.log("[Setup] completeSetup: 调用 setupStorage.complete");
    await setupStorage.complete();
    console.log("[Setup] 初始化已完成");
  } catch (error) {
    console.error("[Setup] 完成初始化失败:", error);
    throw error;
  }
  console.log("[Setup] completeSetup: 结束");
}

/**
 * 重置初始化状态
 * 清除所有初始化数据，下次启动将重新显示向导
 */
export async function resetSetup(): Promise<void> {
  try {
    await initStore();
    await setupStorage.reset();
    console.log("[Setup] 初始化状态已重置");
  } catch (error) {
    console.error("[Setup] 重置初始化状态失败:", error);
    throw error;
  }
}

// ========== 工具函数 ==========

/**
 * 选择目录对话框
 * @returns 用户选择的目录路径，取消返回 null
 */
export async function selectDirectory(): Promise<string | null> {
  try {
    const dir = await invoke<string | null>("dialog_select_directory");
    return dir;
  } catch (error) {
    console.error("[Setup] 选择目录失败:", error);
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
    console.log("[Setup] 步骤进度已保存:", step);
  } catch (error) {
    console.error("[Setup] 保存步骤进度失败:", error);
    throw error;
  }
}

// ========== 依赖安装状态 ==========

/**
 * 获取依赖是否已全部安装
 */
export async function getDepsInstalled(): Promise<boolean> {
  try {
    await initStore();
    return await setupStorage.getDepsInstalled();
  } catch (error) {
    console.error("[Setup] 获取依赖安装状态失败:", error);
    return false;
  }
}

/**
 * 设置依赖是否已全部安装
 */
export async function setDepsInstalled(value: boolean): Promise<void> {
  try {
    await initStore();
    await setupStorage.setDepsInstalled(value);
    console.log("[Setup] 依赖安装状态已保存:", value);
  } catch (error) {
    console.error("[Setup] 保存依赖安装状态失败:", error);
    throw error;
  }
}

// ========== MCP Proxy 配置 ==========

/**
 * 获取 MCP Proxy mcpServers JSON 配置
 */
export async function getMcpProxyConfig(): Promise<string | null> {
  try {
    await initStore();
    return await setupStorage.getMcpProxyConfig();
  } catch (error) {
    console.error("[Setup] 获取 MCP Proxy 配置失败:", error);
    return null;
  }
}

/**
 * 设置 MCP Proxy mcpServers JSON 配置
 */
export async function setMcpProxyConfig(configJson: string): Promise<void> {
  try {
    await initStore();
    await setupStorage.setMcpProxyConfig(configJson);
    console.log("[Setup] MCP Proxy 配置已保存");
  } catch (error) {
    console.error("[Setup] 保存 MCP Proxy 配置失败:", error);
    throw error;
  }
}

/**
 * 获取 MCP Proxy 端口
 */
export async function getMcpProxyPort(): Promise<number> {
  try {
    await initStore();
    const port = await setupStorage.getMcpProxyPort();
    return port ?? DEFAULT_MCP_PROXY_PORT;
  } catch (error) {
    console.error("[Setup] 获取 MCP Proxy 端口失败:", error);
    return DEFAULT_MCP_PROXY_PORT;
  }
}

/**
 * 设置 MCP Proxy 端口
 */
export async function setMcpProxyPort(port: number): Promise<void> {
  try {
    await initStore();
    await setupStorage.setMcpProxyPort(port);
    console.log("[Setup] MCP Proxy 端口已保存:", port);
  } catch (error) {
    console.error("[Setup] 保存 MCP Proxy 端口失败:", error);
    throw error;
  }
}

/**
 * 确保 MCP Proxy 有默认配置
 * 如果 store 中没有配置，则写入默认值
 */
export async function ensureMcpProxyDefaults(): Promise<void> {
  try {
    await initStore();

    // 确保端口有默认值
    const port = await setupStorage.getMcpProxyPort();
    if (port === null) {
      await setupStorage.setMcpProxyPort(DEFAULT_MCP_PROXY_PORT);
      console.log(
        "[Setup] MCP Proxy 端口已设置默认值:",
        DEFAULT_MCP_PROXY_PORT,
      );
    }

    // 确保 mcpServers 配置有默认值
    const config = await setupStorage.getMcpProxyConfig();
    if (!config) {
      await setupStorage.setMcpProxyConfig(DEFAULT_MCP_PROXY_CONFIG);
      console.log("[Setup] MCP Proxy 配置已设置默认值");
    }
  } catch (error) {
    console.error("[Setup] 初始化 MCP Proxy 默认配置失败:", error);
  }
}
