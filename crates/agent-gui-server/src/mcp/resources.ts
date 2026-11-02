/**
 * MCP Resources: status, permissions, audit log.
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import {
  ListResourcesRequestSchema,
  ReadResourceRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import type { GuiAgentConfig } from '../config.js';
import { AuditLog } from '../safety/auditLog.js';
import { checkScreenRecordingPermission, checkAccessibilityPermission, getPlatform } from '../utils/platform.js';

const PKG_VERSION = process.env.__GUI_AGENT_PKG_VERSION__ ?? '0.0.0';

const RESOURCES = [
  {
    uri: 'gui://status',
    name: 'GUI Agent Status',
    description: 'Platform, version, running state',
    mimeType: 'application/json',
  },
  {
    uri: 'gui://permissions',
    name: 'GUI Agent Permissions',
    description: 'Screen recording and accessibility permission status',
    mimeType: 'application/json',
  },
  {
    uri: 'gui://audit-log',
    name: 'GUI Agent Audit Log',
    description: 'Recent tool execution audit entries',
    mimeType: 'application/json',
  },
];

export function registerResources(server: Server, config: GuiAgentConfig, auditLog: AuditLog): void {
  server.setRequestHandler(ListResourcesRequestSchema, async () => ({
    resources: RESOURCES,
  }));

  server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
    const { uri } = request.params;

    switch (uri) {
      case 'gui://status': {
        const status = {
          platform: getPlatform(),
          version: PKG_VERSION,
          running: true,
          transport: config.transport,
          port: config.port,
          model: config.model,
          provider: config.provider,
        };
        return { contents: [{ uri, mimeType: 'application/json', text: JSON.stringify(status, null, 2) }] };
      }

      case 'gui://permissions': {
        const [screenRecording, accessibility] = await Promise.all([
          checkScreenRecordingPermission(),
          checkAccessibilityPermission(),
        ]);
        const perms = { screenRecording, accessibility, platform: getPlatform() };
        return { contents: [{ uri, mimeType: 'application/json', text: JSON.stringify(perms, null, 2) }] };
      }

      case 'gui://audit-log': {
        const entries = auditLog.getEntries(100);
        return { contents: [{ uri, mimeType: 'application/json', text: JSON.stringify(entries, null, 2) }] };
      }

      default:
        throw new Error(`Unknown resource: ${uri}`);
    }
  });
}
