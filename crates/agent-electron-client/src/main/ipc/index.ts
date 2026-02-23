import type { HandlerContext } from '../../types/ipc';
import { registerWindowHandlers } from './windowHandlers';
import { registerSessionHandlers } from './sessionHandlers';
import { registerMessageHandlers } from './messageHandlers';
import { registerSettingsHandlers } from './settingsHandlers';
import { registerMcpHandlers } from './mcpHandlers';
import { registerAgentHandlers } from './agentHandlers';
import { registerComputerHandlers } from './computerHandlers';
import { registerProcessHandlers } from './processHandlers';
import { registerDependencyHandlers } from './dependencyHandlers';
import { registerEngineHandlers } from './engineHandlers';
import { registerAppHandlers } from './appHandlers';
import { registerEventForwarders } from './eventForwarders';
import log from 'electron-log';

export function registerAllHandlers(ctx: HandlerContext): void {
  registerWindowHandlers(ctx);
  registerSessionHandlers();
  registerMessageHandlers();
  registerSettingsHandlers();
  registerMcpHandlers();
  registerAgentHandlers();
  registerComputerHandlers();
  registerProcessHandlers(ctx);
  registerDependencyHandlers();
  registerEngineHandlers();
  registerAppHandlers(ctx);
  registerEventForwarders(ctx);

  log.info('IPC handlers registered');
}
