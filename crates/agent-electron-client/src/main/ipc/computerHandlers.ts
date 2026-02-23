import { ipcMain } from 'electron';
import { agentService } from '../../services/main/engines/unifiedAgent';
import type { ComputerChatRequest, ComputerAgentStatusResponse, ComputerAgentStopResponse, ComputerAgentCancelResponse, HttpResult } from '../../services/main/engines/unifiedAgent';

export function registerComputerHandlers(): void {
  ipcMain.handle('computer:chat', async (_, request: ComputerChatRequest) => {
    const acpEngine = agentService.getAcpEngine();
    if (!acpEngine) {
      return { code: '5000', message: 'Agent not initialized', data: null, tid: null, success: false } as HttpResult;
    }
    return acpEngine.chat(request);
  });

  ipcMain.handle('computer:agentStatus', async (_, request: { user_id: string; project_id?: string }) => {
    const acpEngine = agentService.getAcpEngine();
    const session = acpEngine?.findSessionByProjectId(request.project_id || '') ?? null;
    const response: ComputerAgentStatusResponse = {
      user_id: request.user_id,
      project_id: request.project_id || '',
      is_alive: !!session && session.status === 'active',
      session_id: session?.id ?? null,
      status: session ? (session.status === 'active' ? 'Busy' : 'Idle') : null,
      last_activity: session?.lastActivity ? new Date(session.lastActivity).toISOString() : null,
      created_at: session ? new Date(session.createdAt).toISOString() : null,
    };
    return { code: '0000', message: '成功', data: response, tid: null, success: true } as HttpResult<ComputerAgentStatusResponse>;
  });

  ipcMain.handle('computer:agentStop', async (_, request: { user_id: string; project_id?: string }) => {
    const acpEngine = agentService.getAcpEngine();
    if (acpEngine && request.project_id) {
      const session = acpEngine.findSessionByProjectId(request.project_id);
      if (session) await acpEngine.abortSession(session.id);
    } else if (acpEngine) {
      await acpEngine.abortSession();
    }
    const response: ComputerAgentStopResponse = {
      success: true,
      message: acpEngine ? 'Agent stopped successfully' : 'Agent not found (already stopped)',
      user_id: request.user_id,
      project_id: request.project_id || '',
    };
    return { code: '0000', message: '成功', data: response, tid: null, success: true } as HttpResult<ComputerAgentStopResponse>;
  });

  ipcMain.handle('computer:cancelSession', async (_, request: { user_id: string; project_id?: string; session_id?: string }) => {
    const acpEngine = agentService.getAcpEngine();
    if (acpEngine && request.session_id) {
      await acpEngine.abortSession(request.session_id);
    } else if (acpEngine && request.project_id) {
      const session = acpEngine.findSessionByProjectId(request.project_id);
      if (session) await acpEngine.abortSession(session.id);
    }
    const response: ComputerAgentCancelResponse = {
      success: true,
      session_id: request.session_id || '',
    };
    return { code: '0000', message: '成功', data: response, tid: null, success: true } as HttpResult<ComputerAgentCancelResponse>;
  });

  ipcMain.handle('computer:health', async () => {
    return {
      status: agentService.isReady ? 'healthy' : 'offline',
      engineType: agentService.getEngineType(),
      timestamp: new Date().toISOString(),
    };
  });
}
