/**
 * Permissions Service - 权限管理服务
 * 
 * 功能:
 * - 权限请求管理
 * - 权限规则配置
 * - 权限持久化
 * - 会话级别授权
 */

import * as fs from 'fs';
import * as path from 'path';
import { APP_DATA_DIR_NAME } from '@shared/constants';

export type PermissionType = 'tool' | 'command' | 'file' | 'network' | 'sandbox';

export type PermissionAction = 'allow' | 'deny' | 'prompt';

export interface PermissionRequest {
  id: string;
  type: PermissionType;
  title: string;
  description: string;
  details: {
    tool?: string;
    command?: string;
    file?: string;
    url?: string;
    args?: string[];
    env?: Record<string, string>;
    sandbox?: boolean;
  };
  sessionId: string;
  timestamp: number;
  status: 'pending' | 'approved' | 'denied';
}

export interface PermissionRule {
  id: string;
  name: string;
  pattern: string;
  action: PermissionAction;
  type?: PermissionType;
  expiresAt?: number;
  createdAt: number;
}

export interface PermissionConfig {
  defaultAction: PermissionAction;
  sessionTimeout: number;  // 分钟
  rules: PermissionRule[];
}

// 默认权限配置
const DEFAULT_CONFIG: PermissionConfig = {
  defaultAction: 'prompt',
  sessionTimeout: 30,
  rules: [
    // 允许的工具
    { id: '1', name: 'Read文件', pattern: 'tool:read', action: 'allow', type: 'tool', createdAt: 0 },
    { id: '2', name: 'Edit文件', pattern: 'tool:edit', action: 'prompt', type: 'tool', createdAt: 0 },
    { id: '3', name: 'Bash命令', pattern: 'command:bash', action: 'prompt', type: 'command', createdAt: 0 },
    { id: '4', name: '网络请求', pattern: 'network:http', action: 'prompt', type: 'network', createdAt: 0 },
    { id: '5', name: '文件读取', pattern: 'file:read', action: 'allow', type: 'file', createdAt: 0 },
    { id: '6', name: '文件写入', pattern: 'file:write', action: 'prompt', type: 'file', createdAt: 0 },
  ],
};

class PermissionManager {
  private config: PermissionConfig;
  private pendingRequests: Map<string, PermissionRequest> = new Map();
  private sessionApprovedTools: Map<string, Map<string, boolean>> = new Map();
  private configPath: string;

  constructor() {
    // 配置文件路径
    const home = process.env.HOME || process.env.USERPROFILE || '';
    this.configPath = path.join(home, APP_DATA_DIR_NAME, 'permissions.json');
    this.config = this.loadConfig();
  }

  /**
   * 加载配置
   */
  private loadConfig(): PermissionConfig {
    try {
      if (fs.existsSync(this.configPath)) {
        const data = fs.readFileSync(this.configPath, 'utf-8');
        return { ...DEFAULT_CONFIG, ...JSON.parse(data) };
      }
    } catch (error) {
      console.error('[Permissions] Load config failed:', error);
    }
    return { ...DEFAULT_CONFIG };
  }

  /**
   * 保存配置
   */
  private saveConfig(): void {
    try {
      const dir = path.dirname(this.configPath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      fs.writeFileSync(this.configPath, JSON.stringify(this.config, null, 2));
    } catch (error) {
      console.error('[Permissions] Save config failed:', error);
    }
  }

  /**
   * 检查权限
   */
  checkPermission(request: Omit<PermissionRequest, 'id' | 'timestamp' | 'status'>): {
    allowed: boolean;
    requiresPrompt: boolean;
    rule?: PermissionRule;
  } {
    const key = this.getRuleKey(request);
    
    // 1. 检查规则
    for (const rule of this.config.rules) {
      if (this.matchPattern(key, rule.pattern)) {
        if (rule.action === 'allow') {
          return { allowed: true, requiresPrompt: false, rule };
        }
        if (rule.action === 'deny') {
          return { allowed: false, requiresPrompt: false, rule };
        }
        // prompt: 继续检查
      }
    }

    // 2. 检查会话级别授权
    const sessionApproved = this.sessionApprovedTools.get(request.sessionId);
    if (sessionApproved?.has(key)) {
      return { allowed: true, requiresPrompt: false };
    }

    // 3. 默认动作
    if (this.config.defaultAction === 'allow') {
      return { allowed: true, requiresPrompt: false };
    }
    if (this.config.defaultAction === 'deny') {
      return { allowed: false, requiresPrompt: false };
    }

    // 4. 需要提示用户
    return { allowed: false, requiresPrompt: true };
  }

  /**
   * 生成规则 Key
   */
  private getRuleKey(request: Omit<PermissionRequest, 'id' | 'timestamp' | 'status'>): string {
    const { type, details } = request;
    
    switch (type) {
      case 'tool':
        return `tool:${details.tool || '*'}`;
      case 'command':
        return `command:${details.command || '*'}`;
      case 'file':
        return `file:${details.file || '*'}`;
      case 'network':
        return `network:${details.url || '*'}`;
      case 'sandbox':
        return 'sandbox:execute';
      default:
        return `${type}:*`;
    }
  }

  /**
   * 匹配模式
   */
  private matchPattern(key: string, pattern: string): boolean {
    // 支持通配符
    const regex = new RegExp('^' + pattern.replace(/\*/g, '.*') + '$');
    return regex.test(key);
  }

  /**
   * 创建权限请求
   */
  createRequest(request: Omit<PermissionRequest, 'id' | 'timestamp' | 'status'>): PermissionRequest {
    const fullRequest: PermissionRequest = {
      ...request,
      id: Date.now().toString(36) + Math.random().toString(36).substr(2, 9),
      timestamp: Date.now(),
      status: 'pending',
    };

    this.pendingRequests.set(fullRequest.id, fullRequest);
    return fullRequest;
  }

  /**
   * 批准请求
   */
  approveRequest(requestId: string, alwaysAllow: boolean = false): boolean {
    const request = this.pendingRequests.get(requestId);
    if (!request) return false;

    request.status = 'approved';

    // 如果选择"总是允许"，添加到会话授权
    if (alwaysAllow) {
      const key = this.getRuleKey(request);
      
      if (!this.sessionApprovedTools.has(request.sessionId)) {
        this.sessionApprovedTools.set(request.sessionId, new Map());
      }
      
      this.sessionApprovedTools.get(request.sessionId)!.set(key, true);
    }

    return true;
  }

  /**
   * 拒绝请求
   */
  denyRequest(requestId: string): boolean {
    const request = this.pendingRequests.get(requestId);
    if (!request) return false;

    request.status = 'denied';
    return true;
  }

  /**
   * 获取待处理请求
   */
  getPendingRequests(sessionId?: string): PermissionRequest[] {
    const requests = Array.from(this.pendingRequests.values())
      .filter(r => r.status === 'pending');
    
    if (sessionId) {
      return requests.filter(r => r.sessionId === sessionId);
    }
    
    return requests;
  }

  /**
   * 添加规则
   */
  addRule(rule: Omit<PermissionRule, 'id' | 'createdAt'>): void {
    const newRule: PermissionRule = {
      ...rule,
      id: Date.now().toString(36),
      createdAt: Date.now(),
    };
    
    this.config.rules.push(newRule);
    this.saveConfig();
  }

  /**
   * 删除规则
   */
  removeRule(ruleId: string): void {
    this.config.rules = this.config.rules.filter(r => r.id !== ruleId);
    this.saveConfig();
  }

  /**
   * 获取规则列表
   */
  getRules(): PermissionRule[] {
    return [...this.config.rules];
  }

  /**
   * 更新默认动作
   */
  setDefaultAction(action: PermissionAction): void {
    this.config.defaultAction = action;
    this.saveConfig();
  }

  /**
   * 清除会话授权
   */
  clearSessionApproval(sessionId: string): void {
    this.sessionApprovedTools.delete(sessionId);
  }

  /**
   * 获取权限配置
   */
  getConfig(): PermissionConfig {
    return { ...this.config };
  }

  /**
   * 更新权限配置
   */
  updateConfig(config: Partial<PermissionConfig>): void {
    this.config = { ...this.config, ...config };
    this.saveConfig();
  }

  /**
   * 导出配置
   */
  exportConfig(): string {
    return JSON.stringify(this.config, null, 2);
  }

  /**
   * 导入配置
   */
  importConfig(configJson: string): boolean {
    try {
      const imported = JSON.parse(configJson);
      this.config = { ...DEFAULT_CONFIG, ...imported };
      this.saveConfig();
      return true;
    } catch {
      return false;
    }
  }
}

export const permissionManager = new PermissionManager();

export default permissionManager;
