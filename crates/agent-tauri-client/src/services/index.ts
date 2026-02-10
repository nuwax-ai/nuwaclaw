// 服务导出
export {
  type AgentStatus,
  type LogEntry,
  startAgent,
  stopAgent,
  getConnectionInfo,
  getPermissions,
  refreshPermissions,
  openSystemPreferences,
  onStatusChange,
  onLogChange,
} from "./mockService";

// 认证服务
export {
  syncConfigToServer,
  getOnlineStatus,
  getCurrentAuth,
  loginAndRegister,
  logout,
  initAuthStore,
  type AuthUserInfo,
} from "./auth";

// 存储服务
export {
  initStore,
  getStore,
  STORAGE_KEYS,
  DEFAULT_SETUP_STATE,
  authStorage,
  setupStorage,
  settingsStorage,
  keys,
} from "./store";

// 权限服务
export {
  checkAllPermissions,
  openSystemSettings,
  getStatusConfig,
  openFullDiskAccessPanel,
  checkFullDiskAccessPermission,
  type PermissionCategory,
  type PermissionItem,
  type PermissionsState,
} from "./permissions";

// 初始化向导服务
export {
  isSetupCompleted,
  getCurrentStep,
  saveStep1Config,
  getStep1Config,
  completeStep2,
  completeSetup,
  resetSetup,
  selectDirectory,
  saveStepProgress,
  type SetupState,
  type Step1Config,
} from "./setup";
