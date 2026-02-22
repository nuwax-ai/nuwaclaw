/**
 * Setup & Auth Service for Electron Client
 * 
 * Manages:
 * - Setup Wizard (first launch)
 * - Login/Logout
 * - Service configuration
 * - Persistence
 */

import { message } from 'antd';

// ==================== Types ====================

export interface Step1Config {
  serverHost: string;
  agentPort: number;
  fileServerPort: number;
  proxyPort: number;
  workspaceDir: string;
}

export interface AuthUserInfo {
  id?: number;
  username: string;
  displayName?: string;
  token?: string;
  userId?: string;
  email?: string;
  currentDomain?: string;
}

export interface SetupState {
  completed: boolean;
  currentStep: number;
  step1Completed: boolean;
  step2Completed: boolean;
}

export interface ServiceStatus {
  agent: {
    running: boolean;
    pid?: number;
    port?: number;
  };
  fileServer: {
    running: boolean;
    port?: number;
  };
}

// ==================== Default Values ====================

export const DEFAULT_STEP1_CONFIG: Step1Config = {
  serverHost: 'https://agent.nuwax.com',
  agentPort: 60001,
  fileServerPort: 60000,
  proxyPort: 60002,
  workspaceDir: '',
};

export const DEFAULT_SETUP_STATE: SetupState = {
  completed: false,
  currentStep: 1,
  step1Completed: false,
  step2Completed: false,
};

// ==================== Storage Keys ====================

const STORAGE_KEYS = {
  SETUP_STATE: 'setup_state',
  STEP1_CONFIG: 'step1_config',
  AUTH_USER: 'auth_user',
  API_KEY: 'anthropic_api_key',
  MCP_CONFIG: 'mcp_config',
  LANPROXY_CONFIG: 'lanproxy_config',
  AGENT_CONFIG: 'agent_config',
};

// ==================== Setup Service ====================

class SetupService {
  /**
   * Check if setup is completed
   */
  async isSetupCompleted(): Promise<boolean> {
    try {
      const state = await this.getSetupState();
      return state.completed;
    } catch (error) {
      console.error('[Setup] Check failed:', error);
      return false;
    }
  }

  /**
   * Get current setup state
   */
  async getSetupState(): Promise<SetupState> {
    try {
      const state = await window.electronAPI?.settings.get(STORAGE_KEYS.SETUP_STATE);
      return state ? { ...DEFAULT_SETUP_STATE, ...(state as SetupState) } : DEFAULT_SETUP_STATE;
    } catch (error) {
      console.error('[Setup] Get state failed:', error);
      return DEFAULT_SETUP_STATE;
    }
  }

  /**
   * Get Step 1 config
   */
  async getStep1Config(): Promise<Step1Config> {
    try {
      const config = await window.electronAPI?.settings.get(STORAGE_KEYS.STEP1_CONFIG);
      return config ? { ...DEFAULT_STEP1_CONFIG, ...(config as Step1Config) } : DEFAULT_STEP1_CONFIG;
    } catch (error) {
      console.error('[Setup] Get Step1 failed:', error);
      return DEFAULT_STEP1_CONFIG;
    }
  }

  /**
   * Save Step 1 config
   */
  async saveStep1Config(config: Step1Config): Promise<void> {
    try {
      await window.electronAPI?.settings.set(STORAGE_KEYS.STEP1_CONFIG, config);
      
      // Mark step 1 as completed
      const state = await this.getSetupState();
      state.step1Completed = true;
      state.currentStep = 2;
      await window.electronAPI?.settings.set(STORAGE_KEYS.SETUP_STATE, state);
      
      console.log('[Setup] Step 1 saved:', config);
    } catch (error) {
      console.error('[Setup] Save Step1 failed:', error);
      throw error;
    }
  }

  /**
   * Complete Step 2 (login)
   */
  async completeStep2(): Promise<void> {
    try {
      const state = await this.getSetupState();
      state.step2Completed = true;
      state.currentStep = 3;
      await window.electronAPI?.settings.set(STORAGE_KEYS.SETUP_STATE, state);
      console.log('[Setup] Step 2 completed');
    } catch (error) {
      console.error('[Setup] Complete Step2 failed:', error);
      throw error;
    }
  }

  /**
   * Complete entire setup
   */
  async completeSetup(): Promise<void> {
    try {
      const state = await this.getSetupState();
      state.completed = true;
      state.currentStep = 0;
      await window.electronAPI?.settings.set(STORAGE_KEYS.SETUP_STATE, state);
      console.log('[Setup] Setup completed');
    } catch (error) {
      console.error('[Setup] Complete failed:', error);
      throw error;
    }
  }

  /**
   * Reset setup (for logout/re-setup)
   */
  async resetSetup(): Promise<void> {
    try {
      await window.electronAPI?.settings.set(STORAGE_KEYS.SETUP_STATE, DEFAULT_SETUP_STATE);
      console.log('[Setup] Reset completed');
    } catch (error) {
      console.error('[Setup] Reset failed:', error);
      throw error;
    }
  }
}

// ==================== Auth Service ====================

class AuthService {
  /**
   * Get saved user info (from auth.user_info, set by auth.ts)
   */
  async getAuthUser(): Promise<AuthUserInfo | null> {
    try {
      const user = await window.electronAPI?.settings.get('auth.user_info');
      return user as AuthUserInfo | null;
    } catch (error) {
      console.error('[Auth] Get user failed:', error);
      return null;
    }
  }

  /**
   * Clear auth (logout) — delegates to auth.ts logout()
   */
  async clearAuth(): Promise<void> {
    try {
      await window.electronAPI?.settings.set('auth.username', null);
      await window.electronAPI?.settings.set('auth.password', null);
      await window.electronAPI?.settings.set('auth.config_key', null);
      await window.electronAPI?.settings.set('auth.user_info', null);
      await window.electronAPI?.settings.set('auth.online_status', null);
      console.log('[Auth] Cleared');
    } catch (error) {
      console.error('[Auth] Clear failed:', error);
      throw error;
    }
  }

  /**
   * Logout and optionally reset setup
   */
  async logout(resetSetupState: boolean = false): Promise<void> {
    await this.clearAuth();

    if (resetSetupState) {
      await setupService.resetSetup();
    }
  }
}

// ==================== Service Manager ====================

class ServiceManager {
  /**
   * Get all services status
   */
  async getStatus(): Promise<ServiceStatus> {
    const status: ServiceStatus = {
      agent: { running: false },
      fileServer: { running: false },
    };

    try {
      // Check Agent
      const agentStatus = await window.electronAPI?.agent.status();
      if (agentStatus) {
        status.agent.running = agentStatus.running;
        status.agent.pid = agentStatus.pid;
      }

      // Check File Server (if implemented)
      // const fsStatus = await window.electronAPI?.fileServer.status();
      
    } catch (error) {
      console.error('[Service] Get status failed:', error);
    }

    return status;
  }

  /**
   * Start Agent service
   */
  async startAgent(config: {
    binPath: string;
    backendPort: number;
    apiKey: string;
    apiBaseUrl: string;
    model: string;
  }): Promise<{ success: boolean; error?: string }> {
    try {
      return await window.electronAPI?.agent.start({
        type: 'nuwaxcode',
        ...config,
      }) || { success: false, error: 'IPC failed' };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  }

  /**
   * Stop Agent service
   */
  async stopAgent(): Promise<{ success: boolean; error?: string }> {
    try {
      return await window.electronAPI?.agent.stop() || { success: false, error: 'IPC failed' };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  }

  /**
   * Start File Server
   */
  async startFileServer(port: number = 60000): Promise<{ success: boolean; error?: string }> {
    try {
      return await window.electronAPI?.fileServer?.start?.(port) || { success: false, error: 'Not implemented' };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  }

  /**
   * Stop File Server
   */
  async stopFileServer(): Promise<{ success: boolean; error?: string }> {
    try {
      return await window.electronAPI?.fileServer?.stop?.() || { success: false, error: 'Not implemented' };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  }
}

// ==================== Exports ====================

export const setupService = new SetupService();
export const authService = new AuthService();
export const serviceManager = new ServiceManager();

export default {
  setup: setupService,
  auth: authService,
  services: serviceManager,
};
