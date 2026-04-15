/**
 * 权限规则 IPC handlers
 *
 * T3.6 — 权限规则持久化
 *
 * @version 1.0.0
 * @updated 2026-04-15
 */

import { ipcMain } from "electron";
import { z } from "zod";
import log from "electron-log";
import {
  readPermissionRules,
  addPermissionRule,
  removePermissionRule,
  clearPermissionRules,
  type PermissionRule,
} from "../db";

const logTag = "[IPC:Permission]";

// Zod schemas
const AddRuleSchema = z.object({
  toolKind: z.string().min(1),
  toolTitle: z.string().optional(),
  action: z.enum(["allow", "reject"]),
});

const RemoveRuleSchema = z.object({
  ruleId: z.string().min(1),
});

export function registerPermissionHandlers(): void {
  // permission:getRules — 获取所有权限规则
  ipcMain.handle("permission:getRules", (): PermissionRule[] => {
    log.debug(`${logTag} getRules`);
    return readPermissionRules();
  });

  // permission:addRule — 添加权限规则
  ipcMain.handle("permission:addRule", (_, params: unknown): PermissionRule => {
    const parsed = AddRuleSchema.parse(params);
    log.info(`${logTag} addRule:`, parsed);
    return addPermissionRule(parsed);
  });

  // permission:removeRule — 删除权限规则
  ipcMain.handle("permission:removeRule", (_, params: unknown): boolean => {
    const { ruleId } = RemoveRuleSchema.parse(params);
    log.info(`${logTag} removeRule:`, ruleId);
    return removePermissionRule(ruleId);
  });

  // permission:clearRules — 清空所有规则
  ipcMain.handle("permission:clearRules", (): void => {
    log.info(`${logTag} clearRules`);
    clearPermissionRules();
  });

  log.info(`${logTag} Permission handlers registered`);
}
