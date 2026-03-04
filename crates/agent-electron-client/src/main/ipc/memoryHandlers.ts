/**
 * Memory IPC Handlers
 *
 * IPC handlers for memory service operations
 * Based on specs/long-memory/long-memory.md
 */

import { ipcMain } from 'electron';
import log from 'electron-log';
import { memoryService } from '../services/memory';
import type {
  MemoryConfig,
  MemoryEntry,
  HybridSearchOptions,
  InjectionOptions,
  ModelConfig,
} from '../services/memory/types';

export function registerMemoryHandlers(): void {
  // === Lifecycle ===
  ipcMain.handle('memory:init', async (_, workspaceDir: string, config?: Partial<MemoryConfig>) => {
    try {
      const success = await memoryService.init(workspaceDir, config);
      return { success };
    } catch (error) {
      log.error('[IPC] memory:init failed:', error);
      return { success: false, error: String(error) };
    }
  });

  ipcMain.handle('memory:destroy', async () => {
    try {
      await memoryService.destroy();
      return { success: true };
    } catch (error) {
      log.error('[IPC] memory:destroy failed:', error);
      return { success: false };
    }
  });

  ipcMain.handle('memory:status', () => {
    return memoryService.getStatus();
  });

  ipcMain.handle('memory:ensureReady', async () => {
    try {
      return await memoryService.ensureMemoryReadyForSession();
    } catch (error) {
      log.error('[IPC] memory:ensureReady failed:', error);
      return { ready: false, synced: false };
    }
  });

  // === Configuration ===
  ipcMain.handle('memory:getConfig', () => {
    return memoryService.getConfig();
  });

  ipcMain.handle('memory:updateConfig', (_, config: Partial<MemoryConfig>) => {
    try {
      memoryService.updateConfig(config);
      return { success: true };
    } catch (error) {
      log.error('[IPC] memory:updateConfig failed:', error);
      return { success: false };
    }
  });

  // === Extraction ===
  ipcMain.handle('memory:extract', (_, sessionId: string, messageId: string, messages: Array<{ role: 'user' | 'assistant'; content: string }>, modelConfig: ModelConfig) => {
    try {
      const taskId = memoryService.extractFromConversation(sessionId, messageId, messages, modelConfig);
      return { success: true, taskId };
    } catch (error) {
      log.error('[IPC] memory:extract failed:', error);
      return { success: false, error: String(error) };
    }
  });

  ipcMain.handle('memory:append', (_, content: string, title?: string) => {
    try {
      memoryService.appendMemory(content, title);
      return { success: true };
    } catch (error) {
      log.error('[IPC] memory:append failed:', error);
      return { success: false, error: String(error) };
    }
  });

  ipcMain.handle('memory:handleMessage', (_, message: { role: 'user' | 'assistant'; content: string }, sessionId: string, modelConfig: ModelConfig) => {
    try {
      memoryService.handleMessage(sessionId, message, modelConfig);
      return { success: true };
    } catch (error) {
      log.error('[IPC] memory:handleMessage failed:', error);
      return { success: false, error: String(error) };
    }
  });

  ipcMain.handle('memory:onSessionEnd', async (_, sessionId: string, modelConfig: ModelConfig) => {
    try {
      const taskId = await memoryService.onSessionEnd(sessionId, modelConfig);
      return { success: true, taskId };
    } catch (error) {
      log.error('[IPC] memory:onSessionEnd failed:', error);
      return { success: false, error: String(error) };
    }
  });

  ipcMain.handle('memory:getExtractionProgress', (_, sessionId: string) => {
    try {
      const progress = memoryService.getExtractionProgress(sessionId);
      return { success: true, progress };
    } catch (error) {
      log.error('[IPC] memory:getExtractionProgress failed:', error);
      return { success: false, error: String(error) };
    }
  });

  // === Retrieval ===
  ipcMain.handle('memory:search', async (_, query: string, options?: HybridSearchOptions) => {
    try {
      const results = await memoryService.search(query, options);
      return { success: true, results };
    } catch (error) {
      log.error('[IPC] memory:search failed:', error);
      return { success: false, error: String(error) };
    }
  });

  ipcMain.handle('memory:getContext', async (_, query: string, options?: InjectionOptions) => {
    try {
      const context = await memoryService.getInjectionContext(query, options);
      return { success: true, context };
    } catch (error) {
      log.error('[IPC] memory:getContext failed:', error);
      return { success: false, error: String(error) };
    }
  });

  // === File Operations ===
  ipcMain.handle('memory:sync', async () => {
    try {
      const result = await memoryService.syncWorkspace();
      return { success: true, result };
    } catch (error) {
      log.error('[IPC] memory:sync failed:', error);
      return { success: false, error: String(error) };
    }
  });

  ipcMain.handle('memory:rebuildIndex', async () => {
    try {
      const result = await memoryService.rebuildIndex();
      return { success: true, result };
    } catch (error) {
      log.error('[IPC] memory:rebuildIndex failed:', error);
      return { success: false, error: String(error) };
    }
  });

  ipcMain.handle('memory:getFiles', () => {
    try {
      const files = memoryService.getMemoryFiles();
      return { success: true, files };
    } catch (error) {
      log.error('[IPC] memory:getFiles failed:', error);
      return { success: false, error: String(error) };
    }
  });

  // === Management ===
  ipcMain.handle('memory:add', (_, entry: Partial<MemoryEntry>) => {
    try {
      const id = memoryService.addMemory(entry);
      return { success: true, id };
    } catch (error) {
      log.error('[IPC] memory:add failed:', error);
      return { success: false, error: String(error) };
    }
  });

  ipcMain.handle('memory:update', (_, id: string, updates: Partial<MemoryEntry>) => {
    try {
      memoryService.updateMemory(id, updates);
      return { success: true };
    } catch (error) {
      log.error('[IPC] memory:update failed:', error);
      return { success: false, error: String(error) };
    }
  });

  ipcMain.handle('memory:delete', (_, id: string) => {
    try {
      memoryService.deleteMemory(id);
      return { success: true };
    } catch (error) {
      log.error('[IPC] memory:delete failed:', error);
      return { success: false, error: String(error) };
    }
  });

  ipcMain.handle('memory:list', (_, options?: { status?: string; source?: string; limit?: number }) => {
    try {
      const memories = memoryService.listMemories(options);
      return { success: true, memories };
    } catch (error) {
      log.error('[IPC] memory:list failed:', error);
      return { success: false, error: String(error) };
    }
  });

  // === Scheduled Tasks ===
  ipcMain.handle('memory:runConsolidation', async (_, modelConfig?: { provider: string; model: string; apiKey: string; baseUrl?: string }) => {
    try {
      const result = await memoryService.runConsolidation(modelConfig);
      return { success: true, result };
    } catch (error) {
      log.error('[IPC] memory:runConsolidation failed:', error);
      return { success: false, error: String(error) };
    }
  });

  ipcMain.handle('memory:runCleanup', async () => {
    try {
      const result = await memoryService.runCleanup();
      return { success: true, result };
    } catch (error) {
      log.error('[IPC] memory:runCleanup failed:', error);
      return { success: false, error: String(error) };
    }
  });

  // === Vector ===
  ipcMain.handle('memory:checkVectorSupport', async () => {
    try {
      const result = await memoryService.checkVectorSupport();
      return { success: true, ...result };
    } catch (error) {
      log.error('[IPC] memory:checkVectorSupport failed:', error);
      return { success: false, error: String(error) };
    }
  });

  ipcMain.handle('memory:setEmbeddingConfig', (_, config: { enabled: boolean; provider?: string; model?: string; dimensions?: number; apiKey?: string }) => {
    try {
      memoryService.setEmbeddingConfig(config);
      return { success: true };
    } catch (error) {
      log.error('[IPC] memory:setEmbeddingConfig failed:', error);
      return { success: false, error: String(error) };
    }
  });

  // === Queue Status ===
  ipcMain.handle('memory:getQueueStatus', () => {
    return memoryService.getQueueStatus();
  });

  ipcMain.handle('memory:getSchedulerStatus', () => {
    return memoryService.getSchedulerStatus();
  });

  log.info('[IPC] Memory handlers registered');
}
