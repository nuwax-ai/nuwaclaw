// GUI Agent services — barrel export
export {
  startGuiAgentServer,
  stopGuiAgentServer,
  getGuiAgentStatus,
  getGuiAgentConfig,
  setGuiAgentConfig,
} from "./guiAgentServer";
export { takeScreenshot, getDisplaysInfo } from "./screenshotService";
export {
  executeInput,
  getCursorPosition,
  isInputAvailable,
} from "./inputService";
export {
  checkGuiPermissions,
  requestScreenCapturePermission,
  requestAccessibilityPermission,
  openPermissionSettings,
} from "./permissionService";
export {
  initRateLimiter,
  consumeRateToken,
  resetRateLimiter,
  logAudit,
  getAuditLog,
  clearAuditLog,
} from "./securityManager";
export { generateGuiAgentSystemPrompt } from "./systemPrompt";
