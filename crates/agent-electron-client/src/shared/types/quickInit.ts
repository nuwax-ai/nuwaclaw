/**
 * Quick Init 配置类型定义
 *
 * 通过预置 ~/.nuwaclaw/nuwaclaw.json 或环境变量快速完成初始化
 *
 * 配置优先级: nuwaclaw.json → 环境变量 → 无配置（走正常向导）
 */

/**
 * 解析完成的 Quick Init 配置（所有字段已填充，含默认值）
 */
export interface QuickInitConfig {
  /** 服务域名 */
  serverHost: string;
  /** Agent 端口 */
  agentPort: number;
  /** 文件服务端口 */
  fileServerPort: number;
  /** 工作区目录 */
  workspaceDir: string;
  /** 登录用户名 */
  username: string;
  /** 设备密钥（已注册） */
  savedKey: string;
}

/**
 * 校验对象是否包含 Quick Init 最低必填字段（serverHost + savedKey）
 */
export function hasRequiredQuickInitFields(obj: unknown): boolean {
  if (!obj || typeof obj !== 'object') return false;
  const o = obj as Record<string, unknown>;
  return (
    typeof o.serverHost === 'string' && o.serverHost.length > 0 &&
    typeof o.savedKey === 'string' && o.savedKey.length > 0
  );
}
