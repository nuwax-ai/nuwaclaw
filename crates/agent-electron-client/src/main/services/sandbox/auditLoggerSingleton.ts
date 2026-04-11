/**
 * 全局审计日志单例
 *
 * 统一入口，供 AcpEngine、sandboxService 等各处调用。
 * 写入路径：~/.nuwaclaw/logs/audit/audit-YYYY-MM-DD.jsonl
 */

import os from "os";
import path from "path";
import { APP_DATA_DIR_NAME } from "@shared/constants";
import { AuditLogger } from "./AuditLogger";

const logDir = path.join(os.homedir(), APP_DATA_DIR_NAME, "logs", "audit");

export const auditLogger = new AuditLogger({
  logDir,
  maxLogSize: 10, // MB
  maxLogFiles: 7, // 保留 7 天
  enableConsole: false, // 不重复写 electron-log，AuditLogger.logEvent 内部已记录
});

export default auditLogger;
