import type { BrowserWindow } from 'electron';
import type { ManagedProcess } from '@main/processManager';

export interface HandlerContext {
  getMainWindow: () => BrowserWindow | null;
  lanproxy: ManagedProcess;
  fileServer: ManagedProcess;
  agentRunner: ManagedProcess;
  readonly agentRunnerPorts: { backendPort: number; proxyPort: number } | null;
  setAgentRunnerPorts: (ports: { backendPort: number; proxyPort: number } | null) => void;
}
