/**
 * ACP sessionUpdate → 内部事件映射（纯函数，从 AcpEngine.handleAcpSessionUpdate 提取）
 *
 * 仅负责把（已 normalize 的）ACP update 翻译成事件描述数组；
 * terminating 抑制、permission-gated normalize、session.title 回写等
 * 与会话状态相关的处理仍在 AcpEngine。
 */

import log from "electron-log";
import type {
  AcpSessionUpdate,
  AcpAgentMessageChunk,
  AcpAgentThoughtChunk,
  AcpToolCall,
  AcpToolCallUpdate,
  AcpSessionInfoUpdate,
} from "./acpClient";

/** Safe JSON.stringify that handles circular references */
function safeStringify(obj: unknown): string {
  try {
    return JSON.stringify(obj);
  } catch {
    return String(obj);
  }
}

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

    default: {
      log.info(
        `${logTag} ❓ Unhandled ACP update: ${update.sessionUpdate}`,
        safeStringify(update),
      );
      return { events: [] };
    }
  }
}
