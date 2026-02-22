export interface AgentRunnerConfig {
  enabled: boolean;
  binPath: string;
  backendPort: number;
  proxyPort: number;
  apiKey: string;
  apiBaseUrl: string;
  defaultModel: string;
}

export const defaultAgentRunnerConfig: AgentRunnerConfig = {
  enabled: false,
  binPath: 'nuwax-agent-core',
  backendPort: 60001,
  proxyPort: 60002,
  apiKey: '',
  apiBaseUrl: 'https://api.anthropic.com',
  defaultModel: 'claude-sonnet-4-20250514',
};

export interface AgentRunnerStatus {
  running: boolean;
  pid?: number;
  backendUrl?: string;
  proxyUrl?: string;
  error?: string;
}

export interface ChatRequest {
  messages: { role: 'user' | 'assistant'; content: string }[];
  model?: string;
  maxTokens?: number;
  sessionId?: string;
  systemPrompt?: string;
}

export interface ChatResponse {
  content: string;
  type: 'message' | 'error';
  sessionId?: string;
  messageId?: string;
}

export interface CancelRequest {
  sessionId: string;
  messageId?: string;
}

export interface AgentStatus {
  running: boolean;
  sessionCount: number;
  engine?: string;
  model?: string;
}

class AgentRunnerManager {
  private config: AgentRunnerConfig = { ...defaultAgentRunnerConfig };
  private status: AgentRunnerStatus = { running: false };

  getConfig(): AgentRunnerConfig {
    return { ...this.config };
  }

  setConfig(config: Partial<AgentRunnerConfig>) {
    this.config = { ...this.config, ...config };
  }

  getStatus(): AgentRunnerStatus {
    return { ...this.status };
  }

  getBackendUrl(): string {
    return `http://127.0.0.1:${this.config.backendPort}`;
  }

  async loadConfig(): Promise<void> {
    try {
      const saved = await window.electronAPI?.settings.get('agent_runner_config');
      if (saved) {
        this.config = { ...defaultAgentRunnerConfig, ...(saved as AgentRunnerConfig) };
      }
    } catch (error) {
      console.error('Failed to load agent runner config:', error);
    }
  }

  async saveConfig(): Promise<void> {
    try {
      await window.electronAPI?.settings.set('agent_runner_config', this.config);
    } catch (error) {
      console.error('Failed to save agent runner config:', error);
    }
  }

  // Start agent runner via IPC
  async start(): Promise<{ success: boolean; error?: string }> {
    if (this.status.running) {
      return { success: true };
    }

    try {
      const result = await window.electronAPI?.agentRunner.start({
        binPath: this.config.binPath,
        backendPort: this.config.backendPort,
        proxyPort: this.config.proxyPort,
        apiKey: this.config.apiKey,
        apiBaseUrl: this.config.apiBaseUrl,
        defaultModel: this.config.defaultModel,
      });

      if (result?.success) {
        this.status.running = true;
        this.status.backendUrl = this.getBackendUrl();
      }
      return result || { success: false, error: 'IPC failed' };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  }

  // Stop agent runner via IPC
  async stop(): Promise<{ success: boolean; error?: string }> {
    if (!this.status.running) {
      return { success: true };
    }

    try {
      const result = await window.electronAPI?.agentRunner.stop();
      if (result?.success) {
        this.status.running = false;
      }
      return result || { success: false, error: 'IPC failed' };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  }

  // Check status via IPC
  async checkStatus(): Promise<AgentRunnerStatus> {
    try {
      const status = await window.electronAPI?.agentRunner.status();
      this.status = status || { running: false };
      return this.status;
    } catch (error) {
      return { running: false, error: String(error) };
    }
  }

  // Send chat request to the agent runner HTTP API
  async chat(request: ChatRequest): Promise<ChatResponse> {
    if (!this.status.running) {
      return { content: 'Agent Runner is not running', type: 'error' };
    }

    try {
      const response = await fetch(`${this.getBackendUrl()}/computer/chat`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.config.apiKey}`,
        },
        body: JSON.stringify({
          messages: request.messages,
          model: request.model || this.config.defaultModel,
          max_tokens: request.maxTokens || 4096,
        }),
      });

      if (!response.ok) {
        const error = await response.text();
        return { content: `Error: ${response.status} - ${error}`, type: 'error' };
      }

      const data = await response.json();
      return { content: data.content || data.message?.content || '', type: 'message' };
    } catch (error) {
      return { content: `Error: ${error}`, type: 'error' };
    }
  }

  // Stream chat via SSE
  async *streamChat(request: ChatRequest): AsyncGenerator<string> {
    if (!this.status.running) {
      yield 'Error: Agent Runner is not running';
      return;
    }

    const response = await fetch(`${this.getBackendUrl()}/computer/chat`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.config.apiKey}`,
      },
      body: JSON.stringify({
        messages: request.messages,
        model: request.model || this.config.defaultModel,
        max_tokens: request.maxTokens || 4096,
        stream: true,
      }),
    });

    if (!response.ok) {
      yield `Error: ${response.status}`;
      return;
    }

    const reader = response.body?.getReader();
    const decoder = new TextDecoder();

    if (!reader) return;

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        
        const chunk = decoder.decode(value);
        const lines = chunk.split('\n');
        
        for (const line of lines) {
          if (line.startsWith('data: ')) {
            const data = line.slice(6);
            if (data === '[DONE]') return;
            
            try {
              const parsed = JSON.parse(data);
              if (parsed.content) {
                yield parsed.content;
              }
            } catch {
              // Not JSON, might be plain text
              yield data;
            }
          }
        }
      }
    } finally {
      reader.releaseLock();
    }
  }

  // Cancel a running session
  async cancel(request: CancelRequest): Promise<{ success: boolean; error?: string }> {
    if (!this.status.running) {
      return { success: false, error: 'Agent Runner is not running' };
    }

    try {
      const response = await fetch(`${this.getBackendUrl()}/computer/cancel`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.config.apiKey}`,
        },
        body: JSON.stringify({
          session_id: request.sessionId,
          message_id: request.messageId,
        }),
      });

      if (!response.ok) {
        const error = await response.text();
        return { success: false, error };
      }

      return { success: true };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  }

  // Stop agent runner via HTTP API
  async httpStop(): Promise<{ success: boolean; error?: string }> {
    if (!this.status.running) {
      return { success: true };
    }

    try {
      const response = await fetch(`${this.getBackendUrl()}/computer/stop`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.config.apiKey}`,
        },
      });

      if (!response.ok) {
        const error = await response.text();
        return { success: false, error };
      }

      this.status.running = false;
      return { success: true };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  }

  // Get agent status via HTTP API
  async httpStatus(): Promise<AgentStatus> {
    if (!this.status.running) {
      return { running: false, sessionCount: 0 };
    }

    try {
      const response = await fetch(`${this.getBackendUrl()}/computer/status`, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${this.config.apiKey}`,
        },
      });

      if (!response.ok) {
        return { running: false, sessionCount: 0 };
      }

      const data = await response.json();
      return {
        running: data.running ?? true,
        sessionCount: data.session_count ?? data.sessionCount ?? 0,
        engine: data.engine,
        model: data.model,
      };
    } catch {
      return { running: false, sessionCount: 0 };
    }
  }
}

export const agentRunnerManager = new AgentRunnerManager();
