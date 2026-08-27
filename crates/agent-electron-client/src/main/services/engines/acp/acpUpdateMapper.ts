/**
 * ACP sessionUpdate → 内部事件映射（纯函数，从 AcpEngine.handleAcpSessionUpdate 提取）
 *
 * 仅负责把（已 normalize 的）ACP update 翻译成事件描述数组；
 * terminating 抑制、permission-gated normalize、session.title 回写等
 * 与会话状态相关的处理仍在 AcpEngine。
 */

import log from "electron-log";
import { normalizePlanEntries } from "@nuwax-ai/agent-kit";
import type {
  AcpSessionUpdate,
  AcpAgentMessageChunk,
  AcpAgentThoughtChunk,
  AcpToolCall,
  AcpToolCallUpdate,
  AcpSessionInfoUpdate,
  AcpPlanUpdate,
  AcpCurrentModeUpdate,
} from "./acpClient";
import { safeStringify } from "../utils/safeStringify";

export interface MappedAcpUpdate {
  events: Array<{ event: string; payload: Record<string, unknown> }>;
  /** session_info_update 携带新标题时由调用方回写 AcpSession.title */
  sessionTitle?: string;
}

export function mapAcpUpdateToEvents(
  acpSessionId: string,
  update: AcpSessionUpdate,
  logTag: string,
): MappedAcpUpdate {
  switch (update.sessionUpdate) {
    case "agent_message_chunk": {
      const u = update as AcpAgentMessageChunk;
      return {
        events: [
          {
            event: "message.part.updated",
            payload: {
              sessionId: acpSessionId,
              type: "text",
              text: u.content?.text || "",
            },
          },
        ],
      };
    }

    case "agent_thought_chunk": {
      const u = update as AcpAgentThoughtChunk;
      return {
        events: [
          {
            event: "message.part.updated",
            payload: {
              sessionId: acpSessionId,
              type: "reasoning",
              thinking: u.content?.text || "",
            },
          },
        ],
      };
    }

    case "tool_call": {
      const u = update as AcpToolCall;
      return {
        events: [
          {
            event: "message.part.updated",
            payload: {
              sessionId: acpSessionId,
              type: "tool",
              toolCallId: u.toolCallId,
              name: u.title,
              kind: u.kind,
              status: u.status,
              input: u.rawInput,
              content: u.content,
            },
          },
        ],
      };
    }

    case "tool_call_update": {
      const u = update as AcpToolCallUpdate;
      return {
        events: [
          {
            event: "message.part.updated",
            payload: {
              sessionId: acpSessionId,
              type: "tool",
              toolCallId: u.toolCallId,
              name: u.title,
              status: u.status,
              input: u.rawInput,
              output: u.rawOutput,
              content: u.content,
            },
          },
        ],
      };
    }

    case "session_info_update": {
      const u = update as AcpSessionInfoUpdate;
      return {
        events: [
          {
            event: "session.updated",
            payload: {
              sessionId: acpSessionId,
              title: u.title,
            },
          },
        ],
        sessionTitle: u.title || undefined,
      };
    }

    case "usage_update": {
      log.info(`${logTag} 📊 Usage update:`, safeStringify(update));
      return { events: [] };
    }

    case "plan":
    case "plan_update": {
      // spec：客户端必须全量替换当前计划；entries 规范化共享自 agent-kit
      const u = update as AcpPlanUpdate;
      return {
        events: [
          {
            event: "message.part.updated",
            payload: {
              sessionId: acpSessionId,
              type: "plan",
              entries: normalizePlanEntries(u.entries),
            },
          },
        ],
      };
    }

    case "plan_removed": {
      return {
        events: [
          {
            event: "message.part.removed",
            payload: {
              sessionId: acpSessionId,
              type: "plan",
            },
          },
        ],
      };
    }

    case "current_mode_update": {
      const u = update as AcpCurrentModeUpdate;
      return {
        events: [
          {
            event: "session.updated",
            payload: {
              sessionId: acpSessionId,
              modeId: u.currentModeId ?? u.modeId ?? null,
            },
          },
        ],
      };
    }

    default: {
      log.info(
        `${logTag} ❓ Unhandled ACP update: ${update.sessionUpdate}`,
        safeStringify(update),
      );
      return { events: [] };
    }
  }
}
