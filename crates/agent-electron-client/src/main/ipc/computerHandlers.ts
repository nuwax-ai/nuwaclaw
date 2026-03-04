import { ipcMain } from 'electron';
import { agentService } from '../services/engines/unifiedAgent';
import type { ComputerChatRequest, ComputerAgentStatusResponse, ComputerAgentStopResponse, ComputerAgentCancelResponse, HttpResult } from '../services/engines/unifiedAgent';

export function registerComputerHandlers(): void {
  ipcMain.handle('computer:chat', async (_, request: ComputerChatRequest) => {
    // 与 HTTP 路径一致：按 project_id 路由到对应 AcpEngine
    let acpEngine;
    try {
      acpEngine = await agentService.ensureEngineForRequest(request);
    } catch (err: any) {
      return { code: '5000', message: err.message || 'Engine switch failed', data: null, tid: null, success: false } as HttpResult;
    }
    if (!acpEngine) {
      return { code: '5000', message: 'Agent not initialized', data: null, tid: null, success: false } as HttpResult;
    }
    return acpEngine.chat(request);
  });

  ipcMain.handle('computer:agentStatus', async (_, request: { user_id: string; project_id?: string }) => {
    const projectId = request.project_id || '';
    const projectEngine = agentService.getEngineForProject(projectId);
    const acpEngine = projectEngine || agentService.getAcpEngine();
    const session = acpEngine?.findSessionByProjectId(projectId) ?? null;
    const response: ComputerAgentStatusResponse = {
      user_id: request.user_id,
      project_id: projectId,
      is_alive: !!projectEngine,
      session_id: session?.id ?? null,
      status: session ? (session.status === 'active' ? 'Busy' : 'Idle') : null,
      last_activity: session?.lastActivity ? new Date(session.lastActivity).toISOString() : null,
      created_at: session ? new Date(session.createdAt).toISOString() : null,
    };
    return { code: '0000', message: '成功', data: response, tid: null, success: true } as HttpResult<ComputerAgentStatusResponse>;
  });

  ipcMain.handle('computer:agentStop', async (_, request: { user_id: string; project_id?: string }) => {
    const projectId = request.project_id || '';
    const acpEngine = projectId ? agentService.getEngineForProject(projectId) : agentService.getAcpEngine();
    if (acpEngine) {
      await agentService.stopEngine(projectId || undefined);
    }
    const response: ComputerAgentStopResponse = {
      success: true,
      message: acpEngine ? 'Agent stopped successfully' : 'Agent not found (already stopped)',
      user_id: request.user_id,
      project_id: projectId,
    };
    return { code: '0000', message: '成功', data: response, tid: null, success: true } as HttpResult<ComputerAgentStopResponse>;
  });

  ipcMain.handle('computer:cancelSession', async (_, request: { user_id: string; project_id?: string; session_id?: string }) => {
    const projectId = request.project_id || '';
    const acpEngine = agentService.getEngineForProject(projectId) || agentService.getAcpEngine();
    if (acpEngine && request.session_id) {
      await acpEngine.abortSession(request.session_id);
    } else if (acpEngine && projectId) {
      const session = acpEngine.findSessionByProjectId(projectId);
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
