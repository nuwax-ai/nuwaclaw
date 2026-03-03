// Renderer process services
export { setupService, type Step1Config, DEFAULT_STEP1_CONFIG } from './core/setup';
export {
  loginAndRegister,
  logout,
  getCurrentAuth,
  getAuthErrorMessage,
  syncConfigToServer,
  isLoggedIn,
  type AuthUserInfo,
} from './core/auth';
export { aiService } from './core/ai';
export { fileServerService } from './integrations/fileServer';
export { lanproxyManager } from './integrations/lanproxy';
export { agentRunnerManager } from './agents/agentRunner';
export { sandboxManager } from './agents/sandbox';
export { permissionManager } from './agents/permissions';
export { skillsService } from './integrations/skills';
export { imService } from './integrations/im';
export { taskScheduler } from './integrations/scheduler';
export { logService, exportLogs } from './utils/logService';
