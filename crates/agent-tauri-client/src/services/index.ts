// 服务导出
export * from './mockService';
// 权限服务：完整权限配置与平台检测，供权限菜单使用
export {
  checkAllPermissions,
  openSystemSettings,
  getStatusConfig,
  type PermissionCategory,
  type PermissionItem as PermissionItemFromService,
  type PermissionsState as PermissionsStateFromService,
} from './permissions';
