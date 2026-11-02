import { ipcMain } from "electron";
import { agentService } from "../services/engines/unifiedAgent";
import {
  chatDispatchCoordinator,
  resolveChatDispatchKey,
  type ChatDispatchContext,
} from "../services/computer/chatDispatchCoordinator";
import {
  validateAgentWorkDirInput,
  isNormalProjectServiceType,
} from "../services/computer/agentWorkDir";
import { resolveChatEngineKey } from "../services/computer/chatEngineKey";
import type {
  ComputerChatRequest,
  ComputerAgentStatusResponse,
  ComputerAgentStopResponse,
  ComputerAgentCancelResponse,
  HttpResult,
} from "../services/engines/unifiedAgent";

export function registerComputerHandlers(): void {
  ipcMain.handle("computer:chat", async (_, request: ComputerChatRequest) => {
    // 兜底+三轨校验与 HTTP 入口（computer/router.ts）同口径：project_id 兜底值
    // 同样过校验，防渲染层传入路径段绕过格式约束；绝对路径归一化后回写。
    if (!request.agent_work_dir && request.project_id) {
      request.agent_work_dir = request.project_id;
    }
    if (request.agent_work_dir) {
      const resolved = validateAgentWorkDirInput(request.agent_work_dir, {
        serviceType: request.service_type,
      });
      if (!resolved.ok) {
        return {
          code: "4000",
          message: resolved.message,
          data: null,
          tid: null,
          success: false,
        } as HttpResult;
      }
      request.agent_work_dir = resolved.value;
      // 与 HTTP 入口同口径：容错形态命中 normal-project 轨道但 service_type
      // 缺失时物化补齐，保证下游目录推导与 key 作用域判定一致
      if (
        resolved.kind === "normal-project" &&
        !isNormalProjectServiceType(request.service_type)
      ) {
        request.service_type = "computer-normal-project";
      }
    }

    const dispatchKey = resolveChatDispatchKey(request);
    const chatDispatch: ChatDispatchContext = {
      dispatchKey,
      turnGeneration: chatDispatchCoordinator.bumpArrival(
        dispatchKey,
        request.request_id,
      ),
    };

    // 与 HTTP 路径一致：按 project_id 路由到对应 AcpEngine
    let acpEngine;
    try {
      acpEngine = await agentService.ensureEngineForRequest(request);
    } catch (err: any) {
      return {
        code: "5000",
        message: err.message || "Engine switch failed",
        data: null,
        tid: null,
        success: false,
      } as HttpResult;
    }
    if (!acpEngine) {
      return {
        code: "5000",
        message: "Agent not initialized",
        data: null,
        tid: null,
        success: false,
      } as HttpResult;
    }
    return acpEngine.chat(request, chatDispatch);
  });

  ipcMain.handle(
    "computer:agentStatus",
    async (
      _,
      request: {
        user_id: string;
        project_id?: string;
        agent_work_dir?: string;
        service_type?: string;
      },
    ) => {
      // 引擎 key 口径与 chat 侧同源（normalProject 业务带 normalProject: 前缀，
      // 见 chatEngineKey.ts）：以 agent_work_dir 建键的引擎仅凭 project_id 查不到。
      // session 反查用原始 id（引擎内 session.projectId 为原始 pid，不带前缀）。
      const engineKey = resolveChatEngineKey(request) ?? "";
      const rawProjectId = request.agent_work_dir || request.project_id || "";
      const projectEngine = agentService.getEngineForProject(
        engineKey || rawProjectId,
      );
      const acpEngine = projectEngine || agentService.getAcpEngine();
      const session = acpEngine?.findSessionByProjectId(rawProjectId) ?? null;
      const response: ComputerAgentStatusResponse = {
        user_id: request.user_id,
        project_id: engineKey || rawProjectId,
        is_alive: !!projectEngine,
        session_id: session?.id ?? null,
        status: session
          ? session.status === "active"
            ? "Busy"
            : "Idle"
          : null,
        last_activity: session?.lastActivity
          ? new Date(session.lastActivity).toISOString()
          : null,
        created_at: session ? new Date(session.createdAt).toISOString() : null,
      };
      return {
        code: "0000",
        message: "success",
        data: response,
        tid: null,
        success: true,
      } as HttpResult<ComputerAgentStatusResponse>;
    },
  );

  ipcMain.handle(
    "computer:agentStop",
    async (
      _,
      request: {
        user_id: string;
        project_id?: string;
        agent_work_dir?: string;
        service_type?: string;
      },
    ) => {
      // 引擎 key 与 chat 同源（normalProject 前缀隔离，见 chatEngineKey.ts）
      const engineKey = resolveChatEngineKey(request) ?? "";
      const acpEngine = engineKey
        ? agentService.getEngineForProject(engineKey)
        : agentService.getAcpEngine();
      if (acpEngine) {
        await agentService.stopEngine(engineKey || undefined);
      }
      const response: ComputerAgentStopResponse = {
        success: true,
        message: acpEngine
          ? "Agent stopped successfully"
          : "Agent not found (already stopped)",
        user_id: request.user_id,
        project_id: engineKey,
      };
      return {
        code: "0000",
        message: "success",
        data: response,
        tid: null,
        success: true,
      } as HttpResult<ComputerAgentStopResponse>;
    },
  );

  ipcMain.handle(
    "computer:cancelSession",
    async (
      _,
      request: {
        user_id: string;
        project_id?: string;
        agent_work_dir?: string;
        session_id?: string;
        service_type?: string;
      },
    ) => {
      // 引擎 key 与 chat 同源（normalProject 前缀隔离）；session 反查用原始 id
      const engineKey = resolveChatEngineKey(request) ?? "";
      const rawProjectId = request.agent_work_dir || request.project_id || "";
      const acpEngine =
        agentService.getEngineForProject(engineKey || rawProjectId) ||
        agentService.getAcpEngine();
      if (acpEngine && request.session_id) {
        await acpEngine.abortSession(request.session_id);
      } else if (acpEngine && rawProjectId) {
        const session = acpEngine.findSessionByProjectId(rawProjectId);
        if (session) await acpEngine.abortSession(session.id);
      }
      const response: ComputerAgentCancelResponse = {
        success: true,
        session_id: request.session_id || "",
      };
      return {
        code: "0000",
        message: "success",
        data: response,
        tid: null,
        success: true,
      } as HttpResult<ComputerAgentCancelResponse>;
    },
  );

  ipcMain.handle("computer:health", async () => {
    return {
      status: agentService.isReady ? "healthy" : "offline",
      engineType: agentService.getEngineType(),
      timestamp: new Date().toISOString(),
    };
  });
}
