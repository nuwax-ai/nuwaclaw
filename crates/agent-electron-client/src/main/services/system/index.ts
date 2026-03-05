// Main process system services
export { getDeviceId } from './deviceId';
export { getAppEnv, setMirrorConfig } from './dependencies';
export {
  getAppDataDir,
  getWorkspacesDir,
  getDefaultWorkspace,
  getSessionWorkspace,
  deleteSessionWorkspace,
  getSessionFiles,
  saveWorkspaceConfig,
  getWorkspaceConfig,
  listWorkspaces,
  cleanupOldWorkspaces,
} from './workspaceManager';
