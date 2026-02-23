// Main process system services
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
