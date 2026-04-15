import type { HandlerContext } from "@shared/types/ipc";
import { registerWindowHandlers } from "./windowHandlers";
import { registerSettingsHandlers } from "./settingsHandlers";
import { registerMcpHandlers } from "./mcpHandlers";
import { registerAgentHandlers } from "./agentHandlers";
import { registerComputerHandlers } from "./computerHandlers";
import { registerProcessHandlers } from "./processHandlers";
import { registerDependencyHandlers } from "./dependencyHandlers";
import { registerEngineHandlers } from "./engineHandlers";
import { registerAppHandlers } from "./appHandlers";
import { registerEventForwarders } from "./eventForwarders";
import { registerMemoryHandlers } from "./memoryHandlers";
import { registerSandboxHandlers } from "./sandboxHandlers";
import { registerPerfHandlers } from "./perfHandlers";
import { registerGuiServerHandlers } from "./guiServerHandlers";
import { registerI18nHandlers } from "./i18nHandlers";
import { registerHarnessHandlers } from "./harnessHandlers";
import { registerAuditHandlers } from "./auditHandlers";
import log from "electron-log";

export function registerAllHandlers(ctx: HandlerContext): void {
  registerWindowHandlers(ctx);
  registerSettingsHandlers();
  registerMcpHandlers();
  registerAgentHandlers();
  registerComputerHandlers();
  registerProcessHandlers(ctx);
  registerDependencyHandlers();
  registerEngineHandlers();
  registerAppHandlers(ctx);
  registerEventForwarders(ctx);
  registerMemoryHandlers();
  registerSandboxHandlers();
  registerPerfHandlers();
  registerGuiServerHandlers();
  registerI18nHandlers();
  registerHarnessHandlers();
  registerAuditHandlers();

  log.info("IPC handlers registered");
}
