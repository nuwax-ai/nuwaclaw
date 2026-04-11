/**
 * 合规模式配置类型定义
 *
 * 用于政企环境下的合规管控：审计日志、工具白名单、云功能禁用等。
 */

/** 长任务检查点策略 */
export interface CheckpointPolicy {
  /** 每 N 次工具调用暂停一次（0 表示禁用） */
  toolCallsPerCheckpoint: number;
  /** 每 M 分钟暂停一次（0 表示禁用） */
  minutesPerCheckpoint: number;
}

export interface ComplianceConfig {
  /** 是否启用合规模式 */
  enabled: boolean;
  /** 审计日志保留天数（默认 90 天） */
  auditRetentionDays: number;
  /** 工具白名单，"*" 表示不限制 */
  allowedTools: string[] | "*";
  /** 模型白名单，"*" 表示不限制 */
  allowedModels: string[] | "*";
  /** 是否对所有工具调用均要求用户确认 */
  requireUserConfirmForAllTools: boolean;
  /** 是否禁用云功能（lanproxy、webview 等） */
  disableCloudFeatures: boolean;
  /** 是否对 API Key 启用 OS 级加密存储 */
  apiKeyEncryption: boolean;
  /** 长任务检查点策略（仅合规模式下生效） */
  checkpointPolicy?: CheckpointPolicy;
}

export const DEFAULT_COMPLIANCE_CONFIG: ComplianceConfig = {
  enabled: false,
  auditRetentionDays: 90,
  allowedTools: "*",
  allowedModels: "*",
  requireUserConfirmForAllTools: false,
  disableCloudFeatures: false,
  apiKeyEncryption: false,
};

/** SQLite settings 表中存储合规配置的 key */
export const COMPLIANCE_CONFIG_KEY = "compliance_config";
