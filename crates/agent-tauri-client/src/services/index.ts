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
  authStorage,
  configStorage,
  settingsStorage,
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
  type PermissionCategory,
  type PermissionItem as PermissionItemFromService,
  type PermissionsState as PermissionsStateFromService,
} from './permissions';
