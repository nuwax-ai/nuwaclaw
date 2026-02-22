/**
 * Agent Service - 统一 Agent 引擎
 * 
 * 统一接口:
 * - opencode: @nuwax-ai/sdk
 * - nuwaxcode: @nuwax-ai/sdk
 * - claude-code: CLI (sACP)
 * 
 * 提供一致的 API 给外部调用
 */

import { spawn, ChildProcess } from 'child_process';
import log from 'electron-log';
import * as path from 'path';

// ==================== Types ====================

export type AgentEngine = 'opencode' | 'nuwaxcode' | 'claude-code';

export interface AgentConfig {
  engine: AgentEngine;
  apiKey?: string;
  baseUrl?: string;
  model?: string;
  workspaceDir: string;
}

export interface AgentSession {
  id: string;
  engine: AgentEngine;
  createdAt: number;
}

export interface ChatMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
}

export interface ChatOptions {
  messages: ChatMessage[];
  systemPrompt?: string;
  model?: string;
  maxTokens?: number;
  onChunk?: (text: string) => void;
}

export interface ChatResult {
  success: boolean;
  content?: string;
  error?: string;
}

// ==================== Opencode SDK Wrapper ====================

class OpencodeService {
  private client: any = null;
  private serverProcess: ChildProcess | null = null;
  private sessionId: string | null = null;
  private config: AgentConfig | null = null;

  async init(config: AgentConfig): Promise<boolean> {
    this.config = config;
    
    try {
      // Use @nuwax-ai/sdk
      const { createOpencode } = await import('@nuwax-ai/sdk');
      
      const { client, server } = await createOpencode({
        engine: 'opencode',
        hostname: '127.0.0.1',
        port: 4096,
        config: {
          model: config.model || 'anthropic/claude-3-5-sonnet-20241022',
        },
        timeout: 10000,
      });
      
      this.client = client;
      this.serverProcess = server as any;
      
      log.info('[Agent] Opencode SDK initialized');
      return true;
    } catch (error) {
      log.error('[Agent] Opencode init failed:', error);
      return false;
    }
  }

  async createSession(workspaceDir: string): Promise<string | null> {
    if (!this.client) {
      log.error('[Agent] Opencode not initialized');
      return null;
    }

    try {
      const result = await this.client.session.create({
        body: {
          parts: [],
        },
      });
      
      this.sessionId = result.data.id;
      log.info('[Agent] Opencode session created:', this.sessionId);
      return this.sessionId;
    } catch (error) {
      log.error('[Agent] Opencode session create failed:', error);
      return null;
    }
  }

  async chat(options: ChatOptions): Promise<ChatResult> {
    if (!this.client || !this.sessionId) {
      return { success: false, error: 'Session not initialized' };
    }

    try {
      // Convert messages to opencode format
      const parts = options.messages.map(msg => ({
        type: 'text' as const,
        text: msg.content,
      }));

      const result = await this.client.session.prompt({
        path: { id: this.sessionId },
        body: {
          parts,
          noReply: false,
        },
      });

      // Extract response
      const responseText = result.parts
        ?.map((p: any) => p.text)
        .join('') || '';

      return { success: true, content: responseText };
    } catch (error) {
      log.error('[Agent] Opencode chat failed:', error);
      return { success: false, error: String(error) };
    }
  }

  async executeCommand(command: string): Promise<ChatResult> {
    if (!this.client || !this.sessionId) {
      return { success: false, error: 'Session not initialized' };
    }

    try {
      const result = await this.client.session.command({
        path: { id: this.sessionId },
        body: {
          command,
        },
      });

      const responseText = result.parts
        ?.map((p: any) => p.text)
        .join('') || '';

      return { success: true, content: responseText };
    } catch (error) {
      log.error('[Agent] Opencode command failed:', error);
      return { success: false, error: String(error) };
    }
  }

  async destroy(): Promise<void> {
    if (this.serverProcess) {
      this.serverProcess.kill();
      this.serverProcess = null;
    }
    this.client = null;
    this.sessionId = null;
    log.info('[Agent] Opencode destroyed');
  }

  isInitialized(): boolean {
    return this.client !== null;
  }
}

// ==================== Nuwaxcode Service ====================

class NuwaxcodeService {
  private client: any = null;
  private serverProcess: ChildProcess | null = null;
  private sessionId: string | null = null;
  private config: AgentConfig | null = null;
  private mode: 'http' | 'stdio' = 'stdio';

  async init(config: AgentConfig): Promise<boolean> {
    this.config = config;
    
    // Use @nuwax-ai/sdk with nuwaxcode engine
    try {
      const { createOpencode, createOpencodeClient } = await import('@nuwax-ai/sdk');
      
      // Try to start nuwaxcode in HTTP mode
      try {
        const { client, server } = await createOpencode({
          engine: 'nuwaxcode',
          hostname: '127.0.0.1',
          port: 4097,
          nuwaxcodePath: 'nuwaxcode',  // Will be found in PATH
          config: {
            model: config.model || 'anthropic/claude-3-5-sonnet-20241022',
          },
          timeout: 10000,
        });
        
        this.client = client;
        this.serverProcess = server as any;
        this.mode = 'http';
        log.info('[Agent] Nuwaxcode initialized (HTTP mode)');
        return true;
      } catch (httpError) {
        log.warn('[Agent] Nuwaxcode HTTP mode failed, using stdio mode:', httpError);
        this.mode = 'stdio';
        log.info('[Agent] Nuwaxcode initialized (stdio mode)');
        return true;
      }
    } catch (error) {
      log.error('[Agent] Nuwaxcode init failed:', error);
      return false;
    }
  }

  async createSession(workspaceDir: string): Promise<string | null> {
    if (this.mode === 'http' && this.client) {
      try {
        const result = await this.client.session.create({
          body: { parts: [] },
        });
        this.sessionId = result.data.id;
        return this.sessionId;
      } catch (error) {
        log.error('[Agent] Nuwaxcode session create failed:', error);
        return null;
      }
    }
    
    // Stdio 模式
    this.sessionId = `nuwaxcode-${Date.now()}`;
    return this.sessionId;
  }

  async chat(options: ChatOptions): Promise<ChatResult> {
    if (this.mode === 'http' && this.client && this.sessionId) {
      try {
        const parts = options.messages.map(msg => ({
          type: 'text' as const,
          text: msg.content,
        }));
        
        const result = await this.client.session.prompt({
          path: { id: this.sessionId },
          body: { parts, noReply: false },
        });
        
        const responseText = result.parts?.map((p: any) => p.text).join('') || '';
        return { success: true, content: responseText };
      } catch (error) {
        return { success: false, error: String(error) };
      }
    }
    
    // Stdio 模式 - 使用 CLI
    return { success: false, error: 'Nuwaxcode stdio mode not fully implemented' };
  }

  async executeCommand(command: string): Promise<ChatResult> {
    // Stdio 模式
    return new Promise((resolve) => {
      const proc = spawn('nuwaxcode', ['exec', command], {
        cwd: this.config?.workspaceDir || process.cwd(),
        stdio: ['pipe', 'pipe', 'pipe'],
        windowsHide: true,
      });
      
      let stdout = '';
      let stderr = '';
      
      proc.stdout?.on('data', (data) => { stdout += data.toString(); });
      proc.stderr?.on('data', (data) => { stderr += data.toString(); });
      
      proc.on('close', (code) => {
        if (code === 0) {
          resolve({ success: true, content: stdout });
        } else {
          resolve({ success: false, error: stderr || `Exit: ${code}` });
        }
      });
      
      proc.on('error', (error) => {
        resolve({ success: false, error: error.message });
      });
    });
  }

  async destroy(): Promise<void> {
    if (this.serverProcess) {
      this.serverProcess.kill();
      this.serverProcess = null;
    }
    this.client = null;
    this.sessionId = null;
    log.info('[Agent] Nuwaxcode destroyed');
  }

  isInitialized(): boolean {
    return true;
  }

  getMode(): string {
    return this.mode;
  }
}

// ==================== Claude Code CLI Wrapper ====================

class ClaudeCodeService {
  private process: ChildProcess | null = null;
  private sessionId: string | null = null;
  private config: AgentConfig | null = null;
  private messageBuffer: string = '';

  async init(config: AgentConfig): Promise<boolean> {
    this.config = config;
    log.info('[Agent] Claude Code CLI initialized (sACP mode)');
    return true;
  }

  async createSession(workspaceDir: string): Promise<string | null> {
    // Generate session ID
    this.sessionId = `claude-${Date.now()}`;
    log.info('[Agent] Claude Code session created:', this.sessionId);
    return this.sessionId;
  }

  async chat(options: ChatOptions): Promise<ChatResult> {
    if (!this.sessionId) {
      return { success: false, error: 'Session not initialized' };
    }

    // Claude Code 使用 sACP 模式通过 stdin/stdout 通信
    // 这里需要实现完整的 sACP 协议
    // 简化实现：使用 spawn 启动 claude-code --sACP
    
    return new Promise((resolve) => {
      const args = ['--sACP'];
      
      this.process = spawn('claude-code', args, {
        cwd: options.messages[0]?.content || this.config?.workspaceDir || process.cwd(),
        env: {
          ...process.env,
          ANTHROPIC_API_KEY: this.config?.apiKey || '',
          ANTHROPIC_BASE_URL: this.config?.baseUrl || '',
        },
        stdio: ['pipe', 'pipe', 'pipe'],
      });

      let stdout = '';
      let stderr = '';

      this.process.stdout?.on('data', (data) => {
        stdout += data.toString();
        // 在这里解析 sACP 协议响应
      });

      this.process.stderr?.on('data', (data) => {
        stderr += data.toString();
      });

      this.process.on('error', (error) => {
        log.error('[Agent] Claude Code error:', error);
        resolve({ success: false, error: error.message });
      });

      this.process.on('close', (code) => {
        if (code === 0) {
          resolve({ success: true, content: stdout });
        } else {
          resolve({ success: false, error: stderr || `Exit code: ${code}` });
        }
      });

      // 发送消息 (需要实现 sACP 协议)
      // const message = JSON.stringify({ type: 'message', content: '...' });
      // this.process.stdin?.write(message + '\n');
    });
  }

  async executeCommand(command: string): Promise<ChatResult> {
    // Claude Code CLI 方式执行命令
    return new Promise((resolve) => {
      const proc = spawn('claude-code', ['--print', command], {
        cwd: this.config?.workspaceDir || process.cwd(),
        env: {
          ...process.env,
          ANTHROPIC_API_KEY: this.config?.apiKey || '',
        },
        stdio: ['ignore', 'pipe', 'pipe'],
      });

      let stdout = '';
      let stderr = '';

      proc.stdout?.on('data', (data) => { stdout += data.toString(); });
      proc.stderr?.on('data', (data) => { stderr += data.toString(); });

      proc.on('close', (code) => {
        if (code === 0) {
          resolve({ success: true, content: stdout });
        } else {
          resolve({ success: false, error: stderr || `Exit code: ${code}` });
        }
      });

      proc.on('error', (error) => {
        resolve({ success: false, error: error.message });
      });
    });
  }

  async destroy(): Promise<void> {
    if (this.process) {
      this.process.kill();
      this.process = null;
    }
    this.sessionId = null;
    log.info('[Agent] Claude Code destroyed');
  }

  isInitialized(): boolean {
    return true;
  }
}

// ==================== Unified Agent Service ====================

class UnifiedAgentService {
  private opencodeService: OpencodeService;
  private nuwaxcodeService: NuwaxcodeService;
  private claudeCodeService: ClaudeCodeService;
  private currentEngine: AgentEngine | null = null;
  private config: AgentConfig | null = null;

  constructor() {
    this.opencodeService = new OpencodeService();
    this.nuwaxcodeService = new NuwaxcodeService();
    this.claudeCodeService = new ClaudeCodeService();
  }

  /**
   * 初始化 Agent 服务
   */
  async init(config: AgentConfig): Promise<boolean> {
    this.config = config;
    this.currentEngine = config.engine;

    switch (config.engine) {
      case 'opencode':
        return await this.opencodeService.init(config);
      case 'nuwaxcode':
        return await this.nuwaxcodeService.init(config);
      case 'claude-code':
        return await this.claudeCodeService.init(config);
      default:
        log.error('[Agent] Unknown engine:', config.engine);
        return false;
    }
  }

  /**
   * 创建会话
   */
  async createSession(workspaceDir: string): Promise<string | null> {
    switch (this.currentEngine) {
      case 'opencode':
        return await this.opencodeService.createSession(workspaceDir);
      case 'nuwaxcode':
        return await this.nuwaxcodeService.createSession(workspaceDir);
      case 'claude-code':
        return await this.claudeCodeService.createSession(workspaceDir);
      default:
        return null;
    }
  }

  /**
   * 发送聊天消息
   */
  async chat(options: ChatOptions): Promise<ChatResult> {
    switch (this.currentEngine) {
      case 'opencode':
        return await this.opencodeService.chat(options);
      case 'nuwaxcode':
        return await this.nuwaxcodeService.chat(options);
      case 'claude-code':
        return await this.claudeCodeService.chat(options);
      default:
        return { success: false, error: 'Engine not initialized' };
    }
  }

  /**
   * 执行命令
   */
  async executeCommand(command: string): Promise<ChatResult> {
    switch (this.currentEngine) {
      case 'opencode':
        return await this.opencodeService.executeCommand(command);
      case 'nuwaxcode':
        return await this.nuwaxcodeService.executeCommand(command);
      case 'claude-code':
        return await this.claudeCodeService.executeCommand(command);
      default:
        return { success: false, error: 'Engine not initialized' };
    }
  }

  /**
   * 销毁服务
   */
  async destroy(): Promise<void> {
    switch (this.currentEngine) {
      case 'opencode':
        await this.opencodeService.destroy();
        break;
      case 'nuwaxcode':
        await this.nuwaxcodeService.destroy();
        break;
      case 'claude-code':
        await this.claudeCodeService.destroy();
        break;
    }
    this.currentEngine = null;
    this.config = null;
    log.info('[Agent] Unified service destroyed');
  }

  /**
   * 获取当前引擎
   */
  getEngine(): AgentEngine | null {
    return this.currentEngine;
  }

  /**
   * 检查是否已初始化
   */
  isReady(): boolean {
    switch (this.currentEngine) {
      case 'opencode':
        return this.opencodeService.isInitialized();
      case 'nuwaxcode':
        return this.nuwaxcodeService.isInitialized();
      case 'claude-code':
        return this.claudeCodeService.isInitialized();
      default:
        return false;
    }
  }

  /**
   * 获取可用引擎
   */
  static async getAvailableEngines(): Promise<AgentEngine[]> {
    const engines: AgentEngine[] = [];

    // Check opencode
    try {
      const { createOpencode } = await import('@opencode-ai/sdk');
      engines.push('opencode');
    } catch {
      // opencode SDK not available
    }

    // Claude Code always available (CLI)
    engines.push('claude-code');

    return engines;
  }
}

// ==================== Export ====================

export const agentService = new UnifiedAgentService();

export default {
  agentService,
  UnifiedAgentService,
  type: {
    AgentEngine,
    AgentConfig,
    AgentSession,
    ChatMessage,
    ChatOptions,
    ChatResult,
  },
};
