/**
 * NuwaClaw GUI Agent - Preload 暴露（权限检查）
 */

import { contextBridge, ipcRenderer } from 'electron';

// 暴露给渲染进程的 API
contextBridge.exposeInMainWorld('electronAPI', {
  gui: {
    // 检查所有权限
    checkPermissions: () => 
      ipcRenderer.invoke('gui:checkPermissions') as Promise<{
        screen_recording: boolean;
        accessibility: boolean;
      }>,
    
    // 检查单个权限
    checkPermission: (permissionType: string) =>
      ipcRenderer.invoke('gui:checkPermission', permissionType) as Promise<boolean>,
    
    // 打开权限设置
    openPermissionSettings: (permissionType: string) =>
      ipcRenderer.invoke('gui:openPermissionSettings', permissionType),
  },
});
