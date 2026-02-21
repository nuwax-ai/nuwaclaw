export type AgentType = 'nuwaxcode' | 'claude-code';

export interface AgentConfig {
  type: AgentType;
  binPath: string;
  env: Record<string, string>;
  model?: string;
  apiKey?: string;
  apiBaseUrl?: string;
  // Direct connection to backend (no proxy)
  backendPort?: number;
}

export interface AgentStatus {
  running: boolean;
  pid?: number;
  type?: AgentType;
  error?: string;
}

class AgentManager {
  private process: ReturnType<typeof require('child_process').spawn> | null = null;
  private config: AgentConfig | null = null;
  private type: AgentType = 'nuwaxcode';

  getType(): AgentType {
    return this.type;
  }

  async start(config: AgentConfig): Promise<{ success: boolean; error?: string }> {
    if (this.process) {
      return { success: true, message: 'Already running' };
    }

    this.config = config;
    this.type = config.type;

    return new Promise((resolve) => {
      try {
        const { spawn } = require('child_process');
        
        let args: string[] = [];
        
        switch (config.type) {
          case 'nuwaxcode':
            args = ['serve', '--stdio'];
            break;
          case 'claude-code':
            args = ['--sACP'];
            break;
        }

        // Build environment
        const env: Record<string, string> = {
          ...process.env,
          ...config.env,
        };
        
        // Add model config to environment
        if (config.apiKey) env.ANTHROPIC_API_KEY = config.apiKey;
        if (config.apiBaseUrl) env.ANTHROPIC_BASE_URL = config.apiBaseUrl;
        if (config.model) env.ANTHROPIC_MODEL = config.model;
        if (config.backendPort) env.BACKEND_PORT = String(config.backendPort);

        console.log(`Starting ${config.type}:`, config.binPath, args.join(' '));

        this.process = spawn(config.binPath, args, {
          env,
          stdio: ['pipe', 'pipe', 'pipe'],
        });

        this.process.on('error', (error) => {
          console.error(`${config.type} error:`, error);
          this.process = null;
          resolve({ success: false, error: error.message });
        });

        this.process.on('exit', (code) => {
          console.log(`${config.type} exited with code ${code}`);
          this.process = null;
        });

        setTimeout(() => {
          if (this.process) {
            resolve({ success: true });
          }
        }, 1000);
      } catch (error) {
        resolve({ success: false, error: String(error) });
      }
    });
  }

  async stop(): Promise<{ success: boolean; error?: string }> {
    if (!this.process) {
      return { success: true };
    }

    return new Promise((resolve) => {
      try {
        this.process.kill();
        this.process = null;
        resolve({ success: true });
      } catch (error) {
        resolve({ success: false, error: String(error) });
      }
    });
  }

  getStatus(): AgentStatus {
    return {
      running: this.process !== null,
      pid: this.process?.pid,
      type: this.type,
    };
  }
}

export const agentManager = new AgentManager();
