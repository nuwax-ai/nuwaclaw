// Renderer process services
export { setupService, type Step1Config, DEFAULT_STEP1_CONFIG } from './setup';
export {
  loginAndRegister,
  logout,
  getCurrentAuth,
  getAuthErrorMessage,
  syncConfigToServer,
  isLoggedIn,
  type AuthUserInfo,
} from './auth';
export { aiService } from './ai';
export { fileServerService } from './fileServer';
export { lanproxyManager } from './lanproxy';
export { agentRunnerManager } from './agentRunner';
export { sandboxManager } from './sandbox';
export { permissionManager } from './permissions';
export { skillsService } from './skills';
export { imService } from './im';
export { taskScheduler } from './scheduler';
export { logService, exportLogs } from './logService';
