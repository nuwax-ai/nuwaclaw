import { LOCALHOST_HOSTNAME, DEFAULT_FILE_SERVER_PORT } from '@shared/constants';

export interface FileServerConfig {
  baseUrl: string;
  apiKey?: string;
}

export interface WorkspaceResult {
  success: boolean;
  message: string;
  workspaceRoot?: string;
}

export interface FileInfo {
  name: string;
  path: string;
  isDirectory: boolean;
  size?: number;
  modifiedTime?: number;
}

export interface FileListResult {
  success: boolean;
  files: FileInfo[];
}

// ==================== Chat SSE Types ====================

export interface ChatMessage {
  sessionId: string;
  messageType: string;
  subType: string;
  data: any;
  timestamp: string;
}

export interface ChatRequest {
  user_id: string;
  project_id?: string;
  prompt: string;
  session_id?: string;
  attachments?: any[];
  data_source_attachments?: string[];
  model_provider?: ModelProviderConfig;
  request_id?: string;
  system_prompt?: string;
  user_prompt?: string;
  agent_config?: any;
}

export interface ModelProviderConfig {
  provider: 'anthropic' | 'openai' | 'google' | 'azure';
  api_key?: string;
  base_url?: string;
  model?: string;
  max_tokens?: number;
  temperature?: number;
}

export interface ChatResponse {
  success: boolean;
  project_id: string;
  session_id: string;
  message?: string;
  error?: string;
}

export interface AgentStatusRequest {
  user_id: string;
  project_id?: string;
  session_id?: string;
}

export interface AgentStatusResponse {
  success: boolean;
  status: 'Idle' | 'Busy';
  session_id?: string;
  project_id?: string;
}

export interface AgentStopRequest {
  user_id: string;
  project_id?: string;
  session_id?: string;
}

export interface AgentStopResponse {
  success: boolean;
  message: string;
}

// ==================== File Server Service ====================

class FileServerService {
  private config: FileServerConfig = {
    baseUrl: `http://${LOCALHOST_HOSTNAME}:${DEFAULT_FILE_SERVER_PORT}`,
  };

  setConfig(config: Partial<FileServerConfig>) {
    this.config = { ...this.config, ...config };
  }

  getConfig(): FileServerConfig {
    return { ...this.config };
  }

  private getHeaders(): HeadersInit {
    return this.config.apiKey
      ? { 'Authorization': `Bearer ${this.config.apiKey}` }
      : {};
  }

  async loadConfig(): Promise<void> {
    try {
      const saved = await window.electronAPI?.settings.get('file_server_config');
      if (saved) {
        this.config = { ...this.config, ...(saved as FileServerConfig) };
      }
    } catch (error) {
      console.error('Failed to load file server config:', error);
    }
  }

  async saveConfig(): Promise<void> {
    try {
      await window.electronAPI?.settings.set('file_server_config', this.config);
    } catch (error) {
      console.error('Failed to save file server config:', error);
    }
  }

  // ==================== Chat/SSE API (Agent Runner) ====================

  // POST /computer/chat - 发送聊天消息
  async chat(request: ChatRequest): Promise<ChatResponse> {
    // 优先通过 IPC（AcpEngine 直接处理，返回 HttpResult<ComputerChatResponse>）
    if (window.electronAPI?.computer) {
      const result = await window.electronAPI.computer.chat(request);
      // 从 HttpResult 中提取 data，映射到 fileServer 本地 ChatResponse 格式
      return {
        success: result.success,
        project_id: result.data?.project_id || '',
        session_id: result.data?.session_id || '',
        error: result.data?.error || (result.success ? undefined : result.message),
      };
    }
    // 回退到 HTTP（rcoder 返回 HttpResult<ChatResponse> 格式）
    const response = await fetch(`${this.config.baseUrl}/computer/chat`, {
      method: 'POST',
      headers: {
        ...this.getHeaders(),
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(request),
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.message || `Chat failed: ${response.statusText}`);
    }

    // rcoder 返回 HttpResult 格式，提取 data
    const httpResult = await response.json();
    return {
      success: httpResult.success ?? false,
      project_id: httpResult.data?.project_id || '',
      session_id: httpResult.data?.session_id || '',
      error: httpResult.data?.error || (httpResult.success ? undefined : httpResult.message),
    };
  }

  // GET /computer/progress/{session_id} - SSE 流式进度
  async *streamChat(sessionId: string): AsyncGenerator<ChatMessage> {
    const response = await fetch(`${this.config.baseUrl}/computer/progress/${sessionId}`, {
      method: 'GET',
      headers: this.getHeaders(),
    });

    if (!response.ok) {
      throw new Error(`Failed to connect to progress stream: ${response.statusText}`);
    }

    if (!response.body) {
      throw new Error('No response body');
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();

    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      
      if (done) break;
      
      buffer += decoder.decode(value, { stream: true });
      
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        if (line.startsWith('data: ')) {
          const data = line.slice(6);
          
          // Skip heartbeat events
          if (data.includes('"ping"') || data.includes('heartbeat')) {
            continue;
          }
          
          try {
            const message = JSON.parse(data);
            yield message;
          } catch {
            // Not JSON, might be plain text
            yield { data, messageType: 'text', subType: 'message', timestamp: new Date().toISOString() };
          }
        }
        
        // Handle event types
        if (line.startsWith('event: ')) {
          const eventType = line.slice(7);
          // Event type in 'event:' header
        }
      }
    }
  }

  // POST /computer/agent/status - 获取 Agent 状态
  async getAgentStatus(request: AgentStatusRequest): Promise<AgentStatusResponse> {
    // 优先通过 IPC（返回 HttpResult<ComputerAgentStatusResponse>）
    if (window.electronAPI?.computer) {
      const result = await window.electronAPI.computer.agentStatus(request);
      return {
        success: result.success,
        status: (result.data?.status === 'Busy' ? 'Busy' : 'Idle') as 'Idle' | 'Busy',
        session_id: result.data?.session_id ?? undefined,
        project_id: result.data?.project_id ?? request.project_id,
      };
    }
    // 回退到 HTTP（rcoder 返回 HttpResult 格式）
    const response = await fetch(`${this.config.baseUrl}/computer/agent/status`, {
      method: 'POST',
      headers: {
        ...this.getHeaders(),
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(request),
    });

    if (!response.ok) {
      throw new Error(`Failed to get status: ${response.statusText}`);
    }

    const httpResult = await response.json();
    return {
      success: httpResult.success ?? false,
      status: (httpResult.data?.status === 'Busy' ? 'Busy' : 'Idle') as 'Idle' | 'Busy',
      session_id: httpResult.data?.session_id,
      project_id: httpResult.data?.project_id,
    };
  }

  // POST /computer/agent/stop - 停止 Agent
  async stopAgent(request: AgentStopRequest): Promise<AgentStopResponse> {
    // 优先通过 IPC（返回 HttpResult<ComputerAgentStopResponse>）
    if (window.electronAPI?.computer) {
      const result = await window.electronAPI.computer.agentStop(request);
      return {
        success: result.data?.success ?? result.success,
        message: result.data?.message ?? result.message,
      };
    }
    // 回退到 HTTP（rcoder 返回 HttpResult 格式）
    const response = await fetch(`${this.config.baseUrl}/computer/agent/stop`, {
      method: 'POST',
      headers: {
        ...this.getHeaders(),
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(request),
    });

    if (!response.ok) {
      throw new Error(`Failed to stop agent: ${response.statusText}`);
    }

    const httpResult = await response.json();
    return {
      success: httpResult.data?.success ?? httpResult.success,
      message: httpResult.data?.message ?? httpResult.message ?? 'Stopped',
    };
  }

  // POST /computer/agent/session/cancel - 取消会话
  async cancelSession(request: { user_id: string; session_id: string }): Promise<{ success: boolean; message: string }> {
    // 优先通过 IPC（返回 HttpResult<ComputerAgentCancelResponse>）
    if (window.electronAPI?.computer) {
      const result = await window.electronAPI.computer.cancelSession(request);
      return { success: result.data?.success ?? result.success, message: result.success ? 'Cancelled' : result.message };
    }
    // 回退到 HTTP（rcoder 返回 HttpResult 格式）
    const response = await fetch(`${this.config.baseUrl}/computer/agent/session/cancel`, {
      method: 'POST',
      headers: {
        ...this.getHeaders(),
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(request),
    });

    if (!response.ok) {
      throw new Error(`Failed to cancel session: ${response.statusText}`);
    }

    const httpResult = await response.json();
    return {
      success: httpResult.data?.success ?? httpResult.success,
      message: httpResult.success ? 'Cancelled' : (httpResult.message ?? 'Failed'),
    };
  }

  // ==================== Computer Routes ====================

  // POST /computer/create-workspace - 创建工作空间（支持skills同步）
  async createWorkspace(userId: string, cId: string, zipFile?: File): Promise<WorkspaceResult> {
    const formData = new FormData();
    formData.append('userId', userId);
    formData.append('cId', cId);
    if (zipFile) {
      formData.append('file', zipFile);
    }

    const response = await fetch(`${this.config.baseUrl}/computer/create-workspace`, {
      method: 'POST',
      headers: this.getHeaders(),
      body: formData,
    });

    if (!response.ok) {
      throw new Error(`Failed to create workspace: ${response.statusText}`);
    }

    return response.json();
  }

  // GET /computer/get-file-list - 获取文件列表
  async getFileList(userId: string, cId: string, proxyPath?: string): Promise<FileListResult> {
    const params = new URLSearchParams({ userId, cId });
    if (proxyPath) {
      params.append('proxyPath', proxyPath);
    }

    const response = await fetch(`${this.config.baseUrl}/computer/get-file-list?${params}`, {
      method: 'GET',
      headers: this.getHeaders(),
    });

    if (!response.ok) {
      throw new Error(`Failed to get file list: ${response.statusText}`);
    }

    return response.json();
  }

  // POST /computer/files-update - 批量更新文件
  async updateFiles(userId: string, cId: string, files: { name: string; contents: string }[]): Promise<{ success: boolean }> {
    const response = await fetch(`${this.config.baseUrl}/computer/files-update`, {
      method: 'POST',
      headers: {
        ...this.getHeaders(),
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ userId, cId, files }),
    });

    if (!response.ok) {
      throw new Error(`Failed to update files: ${response.statusText}`);
    }

    return response.json();
  }

  // POST /computer/upload-file - 上传单个文件
  async uploadFile(userId: string, cId: string, file: File, filePath: string): Promise<any> {
    const formData = new FormData();
    formData.append('userId', userId);
    formData.append('cId', cId);
    formData.append('filePath', filePath);
    formData.append('file', file);

    const response = await fetch(`${this.config.baseUrl}/computer/upload-file`, {
      method: 'POST',
      headers: this.getHeaders(),
      body: formData,
    });

    if (!response.ok) {
      throw new Error(`Failed to upload file: ${response.statusText}`);
    }

    return response.json();
  }

  // POST /computer/upload-files - 批量上传文件
  async uploadFiles(userId: string, cId: string, files: File[], filePaths: string[]): Promise<any> {
    const formData = new FormData();
    formData.append('userId', userId);
    formData.append('cId', cId);
    formData.append('filePaths', JSON.stringify(filePaths));
    
    files.forEach((file, i) => {
      formData.append('files', file);
    });

    const response = await fetch(`${this.config.baseUrl}/computer/upload-files`, {
      method: 'POST',
      headers: this.getHeaders(),
      body: formData,
    });

    if (!response.ok) {
      throw new Error(`Failed to upload files: ${response.statusText}`);
    }

    return response.json();
  }

  // GET /computer/download-all-files - 下载所有文件
  async downloadAllFiles(userId: string, cId: string): Promise<Blob> {
    const params = new URLSearchParams({ userId, cId });

    const response = await fetch(`${this.config.baseUrl}/computer/download-all-files?${params}`, {
      method: 'GET',
      headers: this.getHeaders(),
    });

    if (!response.ok) {
      throw new Error(`Failed to download files: ${response.statusText}`);
    }

    return response.blob();
  }

  // ==================== Build Routes ====================

  async startDev(projectId: string): Promise<any> {
    const params = new URLSearchParams({ projectId });
    const response = await fetch(`${this.config.baseUrl}/build/start-dev?${params}`, {
      method: 'GET',
      headers: this.getHeaders(),
    });
    if (!response.ok) throw new Error(`Failed to start dev: ${response.statusText}`);
    return response.json();
  }

  async stopDev(projectId: string, pid: string): Promise<any> {
    const params = new URLSearchParams({ projectId, pid });
    const response = await fetch(`${this.config.baseUrl}/build/stop-dev?${params}`, {
      method: 'GET',
      headers: this.getHeaders(),
    });
    if (!response.ok) throw new Error(`Failed to stop dev: ${response.statusText}`);
    return response.json();
  }

  async build(projectId: string): Promise<any> {
    const params = new URLSearchParams({ projectId });
    const response = await fetch(`${this.config.baseUrl}/build/build?${params}`, {
      method: 'GET',
      headers: this.getHeaders(),
    });
    if (!response.ok) throw new Error(`Failed to build: ${response.statusText}`);
    return response.json();
  }

  async restartDev(projectId: string): Promise<any> {
    const params = new URLSearchParams({ projectId });
    const response = await fetch(`${this.config.baseUrl}/build/restart-dev?${params}`, {
      method: 'GET',
      headers: this.getHeaders(),
    });
    if (!response.ok) throw new Error(`Failed to restart dev: ${response.statusText}`);
    return response.json();
  }

  async listDev(): Promise<{ success: boolean; list: any[] }> {
    const response = await fetch(`${this.config.baseUrl}/build/list-dev`, {
      method: 'GET',
      headers: this.getHeaders(),
    });
    if (!response.ok) throw new Error(`Failed to list dev: ${response.statusText}`);
    return response.json();
  }

  async getDevLog(projectId: string, startIndex: number = 1, logType: string = 'temp'): Promise<any> {
    const params = new URLSearchParams({ projectId, startIndex: String(startIndex), logType });
    const response = await fetch(`${this.config.baseUrl}/build/get-dev-log?${params}`, {
      method: 'GET',
      headers: this.getHeaders(),
    });
    if (!response.ok) throw new Error(`Failed to get dev log: ${response.statusText}`);
    return response.json();
  }

  // ==================== Code Routes ====================

  async updateAllFiles(projectId: string, codeVersion: string, files: any[], basePath?: string, pid?: string): Promise<any> {
    const response = await fetch(`${this.config.baseUrl}/code/all-files-update`, {
      method: 'POST',
      headers: {
        ...this.getHeaders(),
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ projectId, codeVersion, files, basePath, pid }),
    });
    if (!response.ok) throw new Error(`Failed to update files: ${response.statusText}`);
    return response.json();
  }

  async uploadSingleCodeFile(projectId: string, codeVersion: string, file: File, filePath: string): Promise<any> {
    const formData = new FormData();
    formData.append('projectId', projectId);
    formData.append('codeVersion', codeVersion);
    formData.append('filePath', filePath);
    formData.append('file', file);

    const response = await fetch(`${this.config.baseUrl}/code/upload-single-file`, {
      method: 'POST',
      headers: this.getHeaders(),
      body: formData,
    });
    if (!response.ok) throw new Error(`Failed to upload code file: ${response.statusText}`);
    return response.json();
  }

  async rollbackVersion(projectId: string, codeVersion: string, rollbackTo: string): Promise<any> {
    const response = await fetch(`${this.config.baseUrl}/code/rollback-version`, {
      method: 'POST',
      headers: {
        ...this.getHeaders(),
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ projectId, codeVersion, rollbackTo }),
    });
    if (!response.ok) throw new Error(`Failed to rollback: ${response.statusText}`);
    return response.json();
  }

  // ==================== Project Routes ====================

  async createProject(projectId: string): Promise<any> {
    const response = await fetch(`${this.config.baseUrl}/project/create-project`, {
      method: 'POST',
      headers: {
        ...this.getHeaders(),
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ projectId }),
    });
    if (!response.ok) throw new Error(`Failed to create project: ${response.statusText}`);
    return response.json();
  }

  async getProjectContent(projectId: string, command?: string, proxyPath?: string): Promise<any> {
    const params = new URLSearchParams({ projectId });
    if (command) params.append('command', command);
    if (proxyPath) params.append('proxyPath', proxyPath);

    const response = await fetch(`${this.config.baseUrl}/project/get-project-content?${params}`, {
      method: 'GET',
      headers: this.getHeaders(),
    });
    if (!response.ok) throw new Error(`Failed to get project content: ${response.statusText}`);
    return response.json();
  }

  async backupVersion(projectId: string, codeVersion: string): Promise<any> {
    const response = await fetch(`${this.config.baseUrl}/project/backup-current-version`, {
      method: 'POST',
      headers: {
        ...this.getHeaders(),
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ projectId, codeVersion }),
    });
    if (!response.ok) throw new Error(`Failed to backup version: ${response.statusText}`);
    return response.json();
  }

  async exportProject(projectId: string, codeVersion: string, exportType: string = 'zip', config?: any): Promise<Blob> {
    const response = await fetch(`${this.config.baseUrl}/project/export-project`, {
      method: 'POST',
      headers: {
        ...this.getHeaders(),
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ projectId, codeVersion, exportType, config }),
    });
    if (!response.ok) throw new Error(`Failed to export project: ${response.statusText}`);
    return response.blob();
  }

  async deleteProject(projectId: string, pid?: string): Promise<any> {
    const params = new URLSearchParams({ projectId });
    if (pid) params.append('pid', pid);

    const response = await fetch(`${this.config.baseUrl}/project/delete-project?${params}`, {
      method: 'GET',
      headers: this.getHeaders(),
    });
    if (!response.ok) throw new Error(`Failed to delete project: ${response.statusText}`);
    return response.json();
  }

  // Check connection
  async checkConnection(): Promise<boolean> {
    try {
      // 优先通过 IPC
      if (window.electronAPI?.computer) {
        const result = await window.electronAPI.computer.health();
        return result.status === 'healthy';
      }
      // 回退到 HTTP
      const response = await fetch(`${this.config.baseUrl}/health`, {
        method: 'GET',
      });
      return response.ok;
    } catch {
      return false;
    }
  }
}

export const fileServerService = new FileServerService();
