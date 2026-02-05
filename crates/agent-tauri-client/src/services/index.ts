// 服务导出
export * from './mockService';

// 认证服务
export {
  syncConfigToServer,
  getCurrentSandboxValue,
  getOnlineStatus,
  saveOnlineStatus,
  getCurrentAuth,
  loginAndRegister,
  logout,
  isLoggedIn,
  reRegisterClient,
  initAuthStore,
  type AuthUserInfo,
} from './auth';

// 存储服务
export {
  initStore,
  getStore,
  STORAGE_KEYS,
  type AuthUserInfo as StorageAuthUserInfo,
  type CustomScene,
  type SetupState as StorageSetupState,
  DEFAULT_SETUP_STATE,
  authStorage,
  configStorage,
  settingsStorage,
  setupStorage,
  getString,
  setString,
  getBoolean,
  setBoolean,
  getNumber,
  setNumber,
  getObject,
  setObject,
  remove,
  has,
  save,
  clear,
  keys,
} from './store';

// 权限服务：完整权限配置与平台检测，供权限菜单使用
export {
  checkAllPermissions,
  openSystemSettings,
  getStatusConfig,
  openFullDiskAccessPanel,
  checkFullDiskAccessPermission,
  type PermissionCategory,
  type PermissionItem as PermissionItemFromService,
  type PermissionsState as PermissionsStateFromService,
} from './permissions';

// 初始化向导服务
export {
  isSetupCompleted,
  getSetupState,
  getCurrentStep,
  saveStep1Config,
  getStep1Config,
  completeStep2,
  completeStep3,
  completeSetup,
  resetSetup,
  getAppDataDir,
  selectDirectory,
  saveStepProgress,
  goToStep,
  type SetupState,
  type Step1Config,
} from './setup';
