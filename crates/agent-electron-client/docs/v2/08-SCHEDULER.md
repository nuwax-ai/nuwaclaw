---
version: 2.0
last-updated: 2026-03-09
status: design
---

# 08 — Heartbeat 与 Cron 定时任务

## 一、概述

NuwaClaw V2 需要**定时任务**能力来支持：

1. **Heartbeat（心跳）** - 定期检查服务器连接、同步状态、执行后台维护
2. **Cron Jobs（定时任务）** - 用户定义的定时执行任务（提醒、定时报告、自动化等）

### 服务器已有能力

Nuwax 服务器已有定时会话任务 API：

| 端点 | 能力 |
|------|------|
| `POST /api/agent/task/create` | 创建定时会话 |
| `POST /api/agent/task/update` | 更新定时会话 |
| `POST /api/agent/task/list` | 查询定时会话列表 |
| `POST /api/agent/task/cancel/:id` | 取消定时会话 |
| `GET /api/agent/task/cron/list` | 可选定时范围 |
| `GET /api/task/cron/list` | 可选定时范围 - 任务 |

客户端将复用这些 API，并提供：
- 本地任务缓存和离线查看
- 更丰富的任务类型（提醒、脚本、Webhook）
- Heartbeat 心跳检查能力

```
┌────────────────────────────────────────────────────────────────────────┐
│                      定时任务架构                                       │
├────────────────────────────────────────────────────────────────────────┤
│                                                                        │
│  ┌──────────────────────────────────────────────────────────────────┐  │
│  │  Heartbeat (心跳)                                                 │  │
│  │  - 周期: 30s ~ 5min (可配置)                                       │  │
│  │  - 职责: 连接检查、状态同步、后台维护                               │  │
│  │  - 触发: 系统自动                                                  │  │
│  └──────────────────────────────────────────────────────────────────┘  │
│                                                                        │
│  ┌──────────────────────────────────────────────────────────────────┐  │
│  │  Cron Jobs (定时任务)                                              │  │
│  │  - 周期: 用户定义 (cron 表达式)                                    │  │
│  │  - 职责: 定时提醒、定时报告、自动化任务                             │  │
│  │  - 触发: 用户创建 / 服务器同步                                      │  │
│  │  - 复用服务器 /api/agent/task/* API                               │  │
│  └──────────────────────────────────────────────────────────────────┘  │
│                                                                        │
│  ┌──────────────────────────────────────────────────────────────────┐  │
│  │  Scheduler Core                                                   │  │
│  │  - 统一调度引擎                                                    │  │
│  │  - 任务持久化 (SQLite)                                            │  │
│  │  - 错过任务恢复                                                    │  │
│  │  - 与服务器同步                                                    │  │
│  └──────────────────────────────────────────────────────────────────┘  │
│                                                                        │
└────────────────────────────────────────────────────────────────────────┘
```

---

## 二、Heartbeat（心跳）

### 2.1 设计目标

Heartbeat 是**轻量级周期性检查**，用于：

1. **服务器连接健康检查** - 检测与 Nuwax Server 的连接状态
2. **配置同步状态检查** - 检查 MCP、Skills、模型等配置是否需要同步
3. **后台维护** - 清理过期缓存、更新状态、执行低优先级任务
4. **用户提醒** - 检查是否有新的通知、消息等

### 2.2 架构设计

```
┌────────────────────────────────────────────────────────────────────────┐
│                      Heartbeat 架构                                     │
├────────────────────────────────────────────────────────────────────────┤
│                                                                        │
│  ┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐  │
│  │ Main Process    │     │ HeartbeatEngine │     │ HeartbeatTasks  │  │
│  │                 │────▶│                 │────▶│                 │  │
│  │ - 应用启动      │     │ - 定时器管理    │     │ - 检查任务列表  │  │
│  │ - 窗口状态      │     │ - 防重复执行    │     │ - 执行检查逻辑  │  │
│  │ - 系统 tray     │     │ - 错误恢复      │     │ - 通知 UI       │  │
│  └─────────────────┘     └─────────────────┘     └─────────────────┘  │
│                                                           │            │
│                                                           ▼            │
│  ┌─────────────────────────────────────────────────────────────────┐  │
│  │  Heartbeat Tasks (可配置)                                        │  │
│  │                                                                  │  │
│  │  ┌─────────────┐ ┌─────────────┐ ┌─────────────┐ ┌───────────┐  │  │
│  │  │ Server      │ │ Config      │ │ Maintenance │ │ Notify    │  │  │
│  │  │ Health      │ │ Sync Check  │ │ Tasks       │ │ Check     │  │  │
│  │  │ Check       │ │             │ │             │ │           │  │  │
│  │  └─────────────┘ └─────────────┘ └─────────────┘ └───────────┘  │  │
│  │                                                                  │  │
│  │  每次心跳可选择执行哪些任务（根据上次执行时间间隔）                │  │
│  └─────────────────────────────────────────────────────────────────┘  │
│                                                                        │
└────────────────────────────────────────────────────────────────────────┘
```

### 2.3 HeartbeatEngine 实现

```typescript
/**
 * 心跳引擎
 * 
 * 设计原则：
 * - 轻量级，不阻塞主线程
 * - 可配置检查间隔和任务
 * - 支持动态启用/禁用
 * - 错误自动恢复
 */
class HeartbeatEngine {
  private intervalMs: number;
  private timer: NodeJS.Timeout | null = null;
  private running = false;
  private lastCheckAt: number = 0;
  private tasks: Map<string, HeartbeatTask> = new Map();
  private taskStates: Map<string, TaskState> = new Map();

  constructor(config: HeartbeatConfig) {
    this.intervalMs = config.intervalMs || 60000; // 默认 1 分钟
    this.registerDefaultTasks();
  }

  /**
   * 注册默认心跳任务
   */
  private registerDefaultTasks(): void {
    // 服务器健康检查 - 每次心跳都执行
    this.registerTask({
      id: "server-health",
      name: "服务器健康检查",
      priority: 1,
      minIntervalMs: 0, // 每次都执行
      execute: async (context) => {
        return await this.checkServerHealth(context);
      },
    });

    // 配置同步检查 - 每 5 分钟
    this.registerTask({
      id: "config-sync",
      name: "配置同步检查",
      priority: 2,
      minIntervalMs: 5 * 60 * 1000,
      execute: async (context) => {
        return await this.checkConfigSync(context);
      },
    });

    // 会话同步检查 - 每 2 分钟
    this.registerTask({
      id: "session-sync",
      name: "会话同步检查",
      priority: 3,
      minIntervalMs: 2 * 60 * 1000,
      execute: async (context) => {
        return await this.checkSessionSync(context);
      },
    });

    // 后台维护 - 每 10 分钟
    this.registerTask({
      id: "maintenance",
      name: "后台维护",
      priority: 10,
      minIntervalMs: 10 * 60 * 1000,
      execute: async (context) => {
        return await this.runMaintenance(context);
      },
    });

    // 通知检查 - 每次心跳
    this.registerTask({
      id: "notify-check",
      name: "通知检查",
      priority: 5,
      minIntervalMs: 0,
      execute: async (context) => {
        return await this.checkNotifications(context);
      },
    });
  }

  /**
   * 注册心跳任务
   */
  registerTask(task: HeartbeatTask): void {
    this.tasks.set(task.id, task);
    this.taskStates.set(task.id, {
      lastRunAt: 0,
      lastResult: null,
      errorCount: 0,
    });
  }

  /**
   * 启动心跳
   */
  start(): void {
    if (this.running) return;

    this.running = true;
    this.timer = setInterval(() => {
      this.tick().catch((err) => {
        console.error("[Heartbeat] Tick error:", err);
      });
    }, this.intervalMs);

    // 立即执行一次
    this.tick().catch(console.error);

    console.log(`[Heartbeat] Started with interval ${this.intervalMs}ms`);
  }

  /**
   * 停止心跳
   */
  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    this.running = false;
    console.log("[Heartbeat] Stopped");
  }

  /**
   * 执行一次心跳检查
   */
  private async tick(): Promise<HeartbeatResult> {
    const now = Date.now();
    const context: HeartbeatContext = {
      now,
      lastCheckAt: this.lastCheckAt,
      appState: this.getAppState(),
    };

    const results: Record<string, TaskResult> = {};

    // 按优先级排序执行
    const sortedTasks = Array.from(this.tasks.values())
      .sort((a, b) => a.priority - b.priority);

    for (const task of sortedTasks) {
      const state = this.taskStates.get(task.id)!;
      
      // 检查是否需要执行（根据最小间隔）
      if (task.minIntervalMs > 0 && now - state.lastRunAt < task.minIntervalMs) {
        continue;
      }

      try {
        const result = await task.execute(context);
        results[task.id] = result;
        state.lastRunAt = now;
        state.lastResult = result;
        state.errorCount = 0;

        // 如果任务有需要通知的内容
        if (result.notify) {
          this.notifyUI(task.id, result);
        }
      } catch (error) {
        state.errorCount++;
        state.lastResult = { error: String(error) };
        results[task.id] = { error: String(error) };
        console.error(`[Heartbeat] Task ${task.id} error:`, error);
      }
    }

    this.lastCheckAt = now;

    return {
      timestamp: now,
      results,
    };
  }

  /**
   * 获取应用状态
   */
  private getAppState(): AppState {
    // 返回当前应用状态（窗口是否可见、是否空闲等）
    return {
      windowVisible: true, // 从 BrowserWindow 获取
      idle: false, // 从 powerMonitor 获取
      online: navigator.onLine,
    };
  }

  /**
   * 通知 UI
   */
  private notifyUI(taskId: string, result: TaskResult): void {
    // 通过 IPC 或 EventEmitter 通知渲染进程
    const { BrowserWindow } = require("electron");
    const win = BrowserWindow.getAllWindows()[0];
    if (win) {
      win.webContents.send("heartbeat:notify", { taskId, result });
    }
  }

  /**
   * 服务器健康检查
   */
  private async checkServerHealth(context: HeartbeatContext): Promise<TaskResult> {
    const nuwaxClient = getNuwaxClient();
    
    if (!nuwaxClient || !nuwaxClient.isConnected()) {
      return { 
        status: "disconnected",
        notify: { type: "warning", message: "服务器连接已断开" },
      };
    }

    try {
      const start = Date.now();
      const health = await nuwaxClient.request("GET", "/api/health");
      const latency = Date.now() - start;

      return {
        status: "connected",
        latency,
        version: health.version,
      };
    } catch (error) {
      return {
        status: "error",
        error: String(error),
        notify: { type: "error", message: "服务器健康检查失败" },
      };
    }
  }

  /**
   * 配置同步检查
   */
  private async checkConfigSync(context: HeartbeatContext): Promise<TaskResult> {
    const syncService = getNuwaxSyncService();
    const status = syncService.getSyncStatus();

    // 检查是否有需要同步的配置
    const pendingChanges = status.pendingChanges;
    if (pendingChanges > 0) {
      // 触发同步
      await syncService.syncAll();
      return {
        status: "synced",
        changes: pendingChanges,
        notify: { type: "info", message: `已同步 ${pendingChanges} 个配置变更` },
      };
    }

    return { status: "uptodate" };
  }

  /**
   * 会话同步检查
   */
  private async checkSessionSync(context: HeartbeatContext): Promise<TaskResult> {
    const chatEngine = getChatEngine();
    const pendingMessages = chatEngine.getPendingMessages();

    if (pendingMessages.length > 0) {
      await chatEngine.syncMessages();
      return {
        status: "synced",
        count: pendingMessages.length,
      };
    }

    return { status: "uptodate" };
  }

  /**
   * 后台维护
   */
  private async runMaintenance(context: HeartbeatContext): Promise<TaskResult> {
    const tasks: string[] = [];

    // 1. 清理过期缓存
    await this.cleanupExpiredCache();
    tasks.push("cache-cleanup");

    // 2. 清理临时文件
    await this.cleanupTempFiles();
    tasks.push("temp-cleanup");

    // 3. 检查更新
    if (context.appState.idle) {
      await this.checkForUpdates();
      tasks.push("update-check");
    }

    return { status: "done", tasks };
  }

  /**
   * 通知检查
   */
  private async checkNotifications(context: HeartbeatContext): Promise<TaskResult> {
    const nuwaxClient = getNuwaxClient();
    
    if (!nuwaxClient?.isConnected()) {
      return { status: "skipped" };
    }

    try {
      const notifications = await nuwaxClient.request(
        "GET",
        "/api/notifications/pending",
      );

      if (notifications.length > 0) {
        return {
          status: "found",
          count: notifications.length,
          notify: {
            type: "notification",
            data: notifications,
          },
        };
      }

      return { status: "empty" };
    } catch (error) {
      return { status: "error", error: String(error) };
    }
  }

  /**
   * 获取心跳状态
   */
  getStatus(): HeartbeatStatus {
    return {
      running: this.running,
      intervalMs: this.intervalMs,
      lastCheckAt: this.lastCheckAt,
      tasks: Object.fromEntries(this.taskStates),
    };
  }

  /**
   * 动态调整间隔
   */
  setInterval(ms: number): void {
    this.intervalMs = ms;
    if (this.running) {
      this.stop();
      this.start();
    }
  }
}

// ==================== 类型定义 ====================

interface HeartbeatConfig {
  intervalMs?: number; // 心跳间隔，默认 60000 (1分钟)
  tasks?: HeartbeatTask[]; // 自定义任务
}

interface HeartbeatTask {
  id: string;
  name: string;
  priority: number; // 执行优先级，数字越小越先执行
  minIntervalMs: number; // 最小执行间隔，0 表示每次都执行
  execute: (context: HeartbeatContext) => Promise<TaskResult>;
}

interface HeartbeatContext {
  now: number;
  lastCheckAt: number;
  appState: AppState;
}

interface AppState {
  windowVisible: boolean;
  idle: boolean;
  online: boolean;
}

interface TaskState {
  lastRunAt: number;
  lastResult: TaskResult | null;
  errorCount: number;
}

interface TaskResult {
  status?: string;
  error?: string;
  notify?: NotifyPayload;
  [key: string]: any;
}

interface NotifyPayload {
  type: "info" | "warning" | "error" | "notification";
  message?: string;
  data?: any;
}

interface HeartbeatResult {
  timestamp: number;
  results: Record<string, TaskResult>;
}

interface HeartbeatStatus {
  running: boolean;
  intervalMs: number;
  lastCheckAt: number;
  tasks: Record<string, TaskState>;
}
```

### 2.4 Heartbeat 与 UI 交互

```typescript
// Main Process
ipcMain.handle("heartbeat:getStatus", () => {
  return heartbeatEngine.getStatus();
});

ipcMain.handle("heartbeat:setInterval", (_, ms: number) => {
  heartbeatEngine.setInterval(ms);
  return { success: true };
});

// Renderer Process
ipcRenderer.on("heartbeat:notify", (_, { taskId, result }) => {
  if (result.notify) {
    switch (result.notify.type) {
      case "warning":
        showToast.warning(result.notify.message);
        break;
      case "error":
        showToast.error(result.notify.message);
        break;
      case "info":
        showToast.info(result.notify.message);
        break;
      case "notification":
        showNotifications(result.notify.data);
        break;
    }
  }
});
```

---

## 三、Cron Jobs（定时任务）

### 3.1 设计目标

Cron Jobs 是**用户定义的定时任务**，用于：

1. **定时提醒** - "每天 9:00 提醒我开会"
2. **定时报告** - "每周一 8:00 发送周报"
3. **自动化任务** - "每小时检查一次某个服务状态"
4. **与 Agent 结合** - "每天 18:00 让 Agent 总结今天的工作"

### 3.2 架构设计

```
┌────────────────────────────────────────────────────────────────────────┐
│                      Cron Jobs 架构                                     │
├────────────────────────────────────────────────────────────────────────┤
│                                                                        │
│  ┌──────────────────────────────────────────────────────────────────┐  │
│  │  CronScheduler (调度引擎)                                         │  │
│  │                                                                   │  │
│  │  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐              │  │
│  │  │ cron-parser │  │ job-queue   │  │ executor    │              │  │
│  │  │ 解析表达式   │  │ 任务队列    │  │ 执行器      │              │  │
│  │  └─────────────┘  └─────────────┘  └─────────────┘              │  │
│  │                                                                   │  │
│  │  - 支持 cron 表达式                                               │  │
│  │  - 支持一次性任务 (at)                                             │  │
│  │  - 持久化到 SQLite                                                │  │
│  │  - 错过任务恢复 (应用关闭期间)                                     │  │
│  └──────────────────────────────────────────────────────────────────┘  │
│                                 │                                      │
│                                 ▼                                      │
│  ┌──────────────────────────────────────────────────────────────────┐  │
│  │  Job Types (任务类型)                                             │  │
│  │                                                                   │  │
│  │  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐              │  │
│  │  │ Reminder    │  │ Agent Task  │  │ Custom      │              │  │
│  │  │ 提醒任务    │  │ Agent 任务  │  │ 自定义任务  │              │  │
│  │  └─────────────┘  └─────────────┘  └─────────────┘              │  │
│  │                                                                   │  │
│  │  ┌─────────────┐  ┌─────────────┐                               │  │
│  │  │ Webhook     │  │ Script      │                               │  │
│  │  │ HTTP 回调   │  │ 脚本执行    │                               │  │
│  │  └─────────────┘  └─────────────┘                               │  │
│  └──────────────────────────────────────────────────────────────────┘  │
│                                 │                                      │
│                                 ▼                                      │
│  ┌──────────────────────────────────────────────────────────────────┐  │
│  │  Server Sync (服务器同步)                                         │  │
│  │                                                                   │  │
│  │  - 从服务器同步定时任务定义                                        │  │
│  │  - 任务执行结果推送到服务器                                        │  │
│  │  - 支持多设备任务同步                                              │  │
│  └──────────────────────────────────────────────────────────────────┘  │
│                                                                        │
└────────────────────────────────────────────────────────────────────────┘
```

### 3.3 CronScheduler 实现

```typescript
import { CronJob } from "cron";
import { getDb } from "../db";

/**
 * Cron 调度器
 * 
 * 设计原则：
 * - 支持 cron 表达式和一次性任务
 * - 持久化存储，应用重启后恢复
 * - 错过任务自动执行（可配置）
 * - 与服务器同步
 */
class CronScheduler {
  private jobs: Map<string, CronJob> = new Map();
  private db: Database;

  constructor() {
    this.db = getDb();
    this.initDb();
    this.loadJobsFromDb();
  }

  /**
   * 初始化数据库表
   */
  private initDb(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS cron_jobs (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        description TEXT,
        cron_expression TEXT,
        run_at TEXT,           -- 一次性任务的执行时间 (ISO 8601)
        timezone TEXT DEFAULT 'Asia/Shanghai',
        job_type TEXT NOT NULL, -- reminder, agent, webhook, script, custom
        job_config TEXT,        -- JSON 配置
        enabled INTEGER DEFAULT 1,
        last_run_at INTEGER,
        next_run_at INTEGER,
        created_at INTEGER,
        updated_at INTEGER,
        synced_to_server INTEGER DEFAULT 0,
        server_job_id TEXT
      );

      CREATE INDEX IF NOT EXISTS idx_cron_jobs_next_run ON cron_jobs(next_run_at);
      CREATE INDEX IF NOT EXISTS idx_cron_jobs_enabled ON cron_jobs(enabled);
    `);
  }

  /**
   * 从数据库加载任务
   */
  private loadJobsFromDb(): void {
    const jobs = this.db.prepare(`
      SELECT * FROM cron_jobs WHERE enabled = 1
    `).all() as CronJobRecord[];

    for (const job of jobs) {
      this.scheduleJob(job);
    }

    // 检查错过的任务
    this.recoverMissedJobs();
  }

  /**
   * 创建定时任务
   */
  async createJob(input: CreateJobInput): Promise<CronJobRecord> {
    const id = input.id || this.generateId();
    const now = Date.now();

    // 计算下次执行时间
    const nextRunAt = this.calculateNextRun(input);

    const job: CronJobRecord = {
      id,
      name: input.name,
      description: input.description,
      cron_expression: input.cronExpression || null,
      run_at: input.runAt ? new Date(input.runAt).toISOString() : null,
      timezone: input.timezone || "Asia/Shanghai",
      job_type: input.jobType,
      job_config: JSON.stringify(input.jobConfig),
      enabled: 1,
      last_run_at: null,
      next_run_at: nextRunAt?.getTime() || null,
      created_at: now,
      updated_at: now,
      synced_to_server: 0,
      server_job_id: null,
    };

    // 保存到数据库
    this.db.prepare(`
      INSERT INTO cron_jobs (
        id, name, description, cron_expression, run_at, timezone,
        job_type, job_config, enabled, last_run_at, next_run_at,
        created_at, updated_at, synced_to_server, server_job_id
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      job.id, job.name, job.description, job.cron_expression, job.run_at,
      job.timezone, job.job_type, job.job_config, job.enabled, job.last_run_at,
      job.next_run_at, job.created_at, job.updated_at, job.synced_to_server,
      job.server_job_id
    );

    // 如果启用，加入调度
    if (job.enabled) {
      this.scheduleJob(job);
    }

    // 同步到服务器
    this.syncJobToServer(job);

    return job;
  }

  /**
   * 更新定时任务
   */
  async updateJob(id: string, updates: UpdateJobInput): Promise<CronJobRecord | null> {
    const existing = this.db.prepare("SELECT * FROM cron_jobs WHERE id = ?").get(id) as CronJobRecord;
    if (!existing) return null;

    // 停止旧的调度
    this.stopJob(id);

    const now = Date.now();
    const updated = { ...existing, ...updates, updated_at: now };

    // 重新计算下次执行时间
    if (updates.cronExpression !== undefined || updates.runAt !== undefined) {
      updated.next_run_at = this.calculateNextRun({
        cronExpression: updated.cron_expression,
        runAt: updated.run_at,
      })?.getTime() || null;
    }

    // 更新数据库
    this.db.prepare(`
      UPDATE cron_jobs SET
        name = ?, description = ?, cron_expression = ?, run_at = ?,
        timezone = ?, job_type = ?, job_config = ?, enabled = ?,
        last_run_at = ?, next_run_at = ?, updated_at = ?, synced_to_server = 0
      WHERE id = ?
    `).run(
      updated.name, updated.description, updated.cron_expression, updated.run_at,
      updated.timezone, updated.job_type, updated.job_config, updated.enabled,
      updated.last_run_at, updated.next_run_at, updated.updated_at, id
    );

    // 如果启用，重新调度
    if (updated.enabled) {
      this.scheduleJob(updated);
    }

    // 同步到服务器
    this.syncJobToServer(updated);

    return updated;
  }

  /**
   * 删除定时任务
   */
  async deleteJob(id: string): Promise<boolean> {
    // 停止调度
    this.stopJob(id);

    // 从数据库删除
    const result = this.db.prepare("DELETE FROM cron_jobs WHERE id = ?").run(id);

    // 通知服务器
    this.deleteJobFromServer(id);

    return result.changes > 0;
  }

  /**
   * 调度任务
   */
  private scheduleJob(job: CronJobRecord): void {
    // 如果已在调度中，先停止
    this.stopJob(job.id);

    const jobConfig = JSON.parse(job.job_config || "{}");

    if (job.cron_expression) {
      // 周期性任务
      const cronJob = new CronJob(
        job.cron_expression,
        () => this.executeJob(job),
        null,
        true, // start
        job.timezone
      );
      this.jobs.set(job.id, cronJob);
    } else if (job.run_at) {
      // 一次性任务
      const runAt = new Date(job.run_at);
      const delay = runAt.getTime() - Date.now();

      if (delay > 0) {
        const timeout = setTimeout(() => {
          this.executeJob(job);
          // 执行后删除一次性任务
          this.deleteJob(job.id);
        }, delay);
        this.jobs.set(job.id, timeout as any);
      }
    }
  }

  /**
   * 停止任务
   */
  private stopJob(id: string): void {
    const job = this.jobs.get(id);
    if (job) {
      if (job instanceof CronJob) {
        job.stop();
      } else {
        clearTimeout(job);
      }
      this.jobs.delete(id);
    }
  }

  /**
   * 执行任务
   */
  private async executeJob(job: CronJobRecord): Promise<JobResult> {
    const jobConfig = JSON.parse(job.job_config || "{}");
    const startTime = Date.now();

    try {
      let result: any;

      switch (job.job_type) {
        case "reminder":
          result = await this.executeReminder(job, jobConfig);
          break;
        case "agent":
          result = await this.executeAgentTask(job, jobConfig);
          break;
        case "webhook":
          result = await this.executeWebhook(job, jobConfig);
          break;
        case "script":
          result = await this.executeScript(job, jobConfig);
          break;
        case "custom":
          result = await this.executeCustom(job, jobConfig);
          break;
        default:
          throw new Error(`Unknown job type: ${job.job_type}`);
      }

      const executionTime = Date.now() - startTime;

      // 更新执行记录
      this.db.prepare(`
        UPDATE cron_jobs SET
          last_run_at = ?,
          next_run_at = ?,
          updated_at = ?
        WHERE id = ?
      `).run(
        startTime,
        this.calculateNextRun({ cronExpression: job.cron_expression })?.getTime() || null,
        Date.now(),
        job.id
      );

      // 推送执行结果到服务器
      this.pushJobResultToServer(job.id, {
        success: true,
        result,
        executionTime,
        executedAt: startTime,
      });

      return { success: true, result, executionTime };
    } catch (error) {
      const executionTime = Date.now() - startTime;

      // 推送错误结果到服务器
      this.pushJobResultToServer(job.id, {
        success: false,
        error: String(error),
        executionTime,
        executedAt: startTime,
      });

      return { success: false, error: String(error), executionTime };
    }
  }

  /**
   * 执行提醒任务
   */
  private async executeReminder(job: CronJobRecord, config: ReminderConfig): Promise<any> {
    const { title, message, sound, actions } = config;

    // 显示系统通知
    const { Notification } = require("electron");
    new Notification({
      title,
      body: message,
      sound: sound !== false,
      actions: actions?.map((a: any) => ({ type: "button", text: a.label })),
    }).show();

    return { notified: true, title };
  }

  /**
   * 执行 Agent 任务
   */
  private async executeAgentTask(job: CronJobRecord, config: AgentTaskConfig): Promise<any> {
    const { agentId, prompt, context } = config;

    // 获取 Agent 引擎
    const chatEngine = getChatEngine();
    
    // 创建会话并执行
    const session = await chatEngine.createSession({
      agentId,
      title: `[定时任务] ${job.name}`,
    });

    const response = await chatEngine.sendMessage(session.id, prompt, {
      context,
    });

    return {
      sessionId: session.id,
      response: response.content,
    };
  }

  /**
   * 执行 Webhook
   */
  private async executeWebhook(job: CronJobRecord, config: WebhookConfig): Promise<any> {
    const { url, method = "POST", headers, body } = config;

    const response = await fetch(url, {
      method,
      headers: {
        "Content-Type": "application/json",
        ...headers,
      },
      body: body ? JSON.stringify(body) : undefined,
    });

    return {
      status: response.status,
      data: await response.text(),
    };
  }

  /**
   * 执行脚本
   */
  private async executeScript(job: CronJobRecord, config: ScriptConfig): Promise<any> {
    const { language, code, timeout = 30000 } = config;

    // 根据语言选择执行器
    const { spawn } = require("child_process");
    
    let command: string;
    let args: string[];

    switch (language) {
      case "bash":
        command = "bash";
        args = ["-c", code];
        break;
      case "node":
        command = "node";
        args = ["-e", code];
        break;
      case "python":
        command = "python3";
        args = ["-c", code];
        break;
      default:
        throw new Error(`Unsupported language: ${language}`);
    }

    return new Promise((resolve, reject) => {
      const proc = spawn(command, args, { timeout });
      let stdout = "";
      let stderr = "";

      proc.stdout.on("data", (data: Buffer) => { stdout += data.toString(); });
      proc.stderr.on("data", (data: Buffer) => { stderr += data.toString(); });

      proc.on("close", (code: number) => {
        resolve({ exitCode: code, stdout, stderr });
      });

      proc.on("error", reject);
    });
  }

  /**
   * 执行自定义任务
   */
  private async executeCustom(job: CronJobRecord, config: any): Promise<any> {
    // 通过事件系统让外部处理器执行
    const handlers = this.customHandlers.get(job.job_type);
    if (handlers) {
      for (const handler of handlers) {
        await handler(job, config);
      }
    }
    return { handled: true };
  }

  /**
   * 计算下次执行时间
   */
  private calculateNextRun(input: { cronExpression?: string; runAt?: string | Date }): Date | null {
    if (input.cronExpression) {
      const cronJob = new CronJob(input.cronExpression, () => {}, null, false);
      return cronJob.nextDate().toJSDate();
    }
    if (input.runAt) {
      return new Date(input.runAt);
    }
    return null;
  }

  /**
   * 恢复错过的任务
   */
  private recoverMissedJobs(): void {
    const now = Date.now();
    const missedJobs = this.db.prepare(`
      SELECT * FROM cron_jobs 
      WHERE enabled = 1 AND next_run_at IS NOT NULL AND next_run_at < ?
    `).all(now) as CronJobRecord[];

    for (const job of missedJobs) {
      console.log(`[CronScheduler] Recovering missed job: ${job.name}`);
      this.executeJob(job).catch(console.error);
    }
  }

  /**
   * 从服务器同步任务
   */
  async syncFromServer(): Promise<SyncResult> {
    const nuwaxClient = getNuwaxClient();
    if (!nuwaxClient?.isConnected()) {
      return { success: false, pulled: 0, pushed: 0, conflicts: [], error: "Not connected" };
    }

    // 获取服务器上的任务列表
    const serverJobs = await nuwaxClient.request(
      "GET",
      "/api/scheduler/jobs",
    );

    let pulled = 0;
    let pushed = 0;
    const conflicts: SyncConflict[] = [];

    for (const serverJob of serverJobs) {
      const localJob = this.db.prepare(
        "SELECT * FROM cron_jobs WHERE server_job_id = ?"
      ).get(serverJob.id) as CronJobRecord | undefined;

      if (!localJob) {
        // 服务器有，本地没有 → 创建
        await this.createJobFromServer(serverJob);
        pulled++;
      } else if (localJob.updated_at > serverJob.updatedAt) {
        // 本地更新 → 推送到服务器
        await this.syncJobToServer(localJob);
        pushed++;
      } else if (localJob.updated_at < serverJob.updatedAt) {
        // 服务器更新 → 更新本地
        await this.updateJobFromServer(localJob.id, serverJob);
        pulled++;
      }
    }

    return { success: true, pulled, pushed, conflicts };
  }

  /**
   * 获取所有任务
   */
  getJobs(filter?: JobFilter): CronJobRecord[] {
    let sql = "SELECT * FROM cron_jobs";
    const params: any[] = [];

    if (filter?.enabled !== undefined) {
      sql += " WHERE enabled = ?";
      params.push(filter.enabled ? 1 : 0);
    }

    return this.db.prepare(sql).all(...params) as CronJobRecord[];
  }

  /**
   * 获取单个任务
   */
  getJob(id: string): CronJobRecord | null {
    return this.db.prepare("SELECT * FROM cron_jobs WHERE id = ?").get(id) as CronJobRecord | null;
  }

  /**
   * 手动触发任务
   */
  async triggerJob(id: string): Promise<JobResult> {
    const job = this.getJob(id);
    if (!job) {
      throw new Error(`Job ${id} not found`);
    }
    return this.executeJob(job);
  }

  private generateId(): string {
    return `job_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  }
}

// ==================== 类型定义 ====================

interface CronJobRecord {
  id: string;
  name: string;
  description: string | null;
  cron_expression: string | null;
  run_at: string | null;
  timezone: string;
  job_type: "reminder" | "agent" | "webhook" | "script" | "custom";
  job_config: string;
  enabled: number;
  last_run_at: number | null;
  next_run_at: number | null;
  created_at: number;
  updated_at: number;
  synced_to_server: number;
  server_job_id: string | null;
}

interface CreateJobInput {
  id?: string;
  name: string;
  description?: string;
  cronExpression?: string; // cron 表达式
  runAt?: string | Date; // 一次性任务执行时间
  timezone?: string;
  jobType: CronJobRecord["job_type"];
  jobConfig: ReminderConfig | AgentTaskConfig | WebhookConfig | ScriptConfig | any;
}

interface UpdateJobInput {
  name?: string;
  description?: string;
  cronExpression?: string;
  runAt?: string | Date;
  timezone?: string;
  jobConfig?: any;
  enabled?: boolean;
}

interface ReminderConfig {
  title: string;
  message: string;
  sound?: boolean;
  actions?: { label: string; action: string }[];
}

interface AgentTaskConfig {
  agentId: number;
  prompt: string;
  context?: Record<string, any>;
}

interface WebhookConfig {
  url: string;
  method?: "GET" | "POST" | "PUT" | "DELETE";
  headers?: Record<string, string>;
  body?: any;
}

interface ScriptConfig {
  language: "bash" | "node" | "python";
  code: string;
  timeout?: number;
}

interface JobResult {
  success: boolean;
  result?: any;
  error?: string;
  executionTime: number;
}

interface JobFilter {
  enabled?: boolean;
  type?: string;
}
```

### 3.4 IPC 接口

```typescript
// Cron Scheduler IPC
'cron:list'           → CronJobRecord[]       // 获取任务列表
'cron:get'            → CronJobRecord         // 获取单个任务
'cron:create'         → CronJobRecord         // 创建任务
'cron:update'         → CronJobRecord         // 更新任务
'cron:delete'         → { success: boolean }  // 删除任务
'cron:trigger'        → JobResult             // 手动触发
'cron:sync'           → SyncResult            // 从服务器同步
'cron:status'         → SchedulerStatus       // 调度器状态
```

---

## 四、Heartbeat vs Cron 对比

| 特性 | Heartbeat | Cron Jobs |
|------|-----------|-----------|
| **触发方式** | 系统自动，固定间隔 | 用户定义，cron 表达式 |
| **用途** | 健康检查、后台维护、状态同步 | 定时提醒、定时任务、自动化 |
| **任务类型** | 预定义的检查任务 | 用户创建的任意任务 |
| **持久化** | 无需（状态在内存） | 需要（SQLite 持久化） |
| **服务器同步** | 状态同步 | 任务定义 + 执行结果同步 |
| **错过处理** | 跳过，等下次 | 可配置恢复执行 |
| **UI 控制** | 可调整间隔 | 完整 CRUD |

---

## 五、与服务器同步

### 5.1 Heartbeat 同步

```typescript
// 心跳检查时，同步状态到服务器
interface HeartbeatSyncPayload {
  timestamp: number;
  clientId: string;
  status: {
    serverHealth: "connected" | "disconnected" | "error";
    lastSyncAt: number;
    pendingChanges: number;
    activeSessions: number;
  };
}

// 服务器可选择性推送通知
// /api/heartbeat POST
```

### 5.2 Cron Jobs 同步

```typescript
// ==================== 服务器已有 API ====================
// POST /api/agent/task/create    // 创建定时会话
// POST /api/agent/task/update    // 更新定时会话
// POST /api/agent/task/list      // 查询定时会话列表
// POST /api/agent/task/cancel/:id // 取消定时会话
// GET  /api/agent/task/cron/list // 可选定时范围
// GET  /api/task/cron/list       // 可选定时范围 - 任务

// ==================== 客户端同步策略 ====================

/**
 * CronSyncAdapter - 与服务器定时任务同步
 * 
 * 复用服务器已有的定时任务 API，客户端提供：
 * 1. 任务定义的本地缓存和离线查看
 * 2. 任务执行结果的本地记录
 * 3. 更丰富的任务类型支持（提醒、脚本等）
 */
class CronSyncAdapter {
  constructor(
    private nuwaxClient: NuwaxApiClient,
    private cronScheduler: CronScheduler,
  ) {}

  /**
   * 从服务器同步定时会话任务
   */
  async syncFromServer(agentId?: number): Promise<SyncResult> {
    // 1. 获取服务器定时任务列表
    const serverTasks = await this.nuwaxClient.request(
      "POST",
      "/api/agent/task/list",
      {
        agentId,
        taskStatus: "EXECUTING", // 获取执行中的任务
      },
    );

    let pulled = 0;
    let pushed = 0;

    // 2. 同步到本地
    for (const serverTask of serverTasks) {
      const localTask = this.cronScheduler.getJob(
        this.getLocalJobId(serverTask.id),
      );

      if (!localTask) {
        // 服务器有，本地没有 → 创建本地任务
        await this.cronScheduler.createJob({
          id: this.getLocalJobId(serverTask.id),
          name: serverTask.topic,
          description: serverTask.summary,
          cronExpression: serverTask.taskCron,
          jobType: "agent",
          jobConfig: {
            agentId: serverTask.agentId,
            conversationId: serverTask.id,
            topic: serverTask.topic,
            summary: serverTask.summary,
          },
          serverJobId: String(serverTask.taskId),
        });
        pulled++;
      }
    }

    // 3. 推送本地新增的任务到服务器
    const localOnly = this.cronScheduler.getJobs({ synced: false });
    for (const local of localOnly) {
      if (local.job_type === "agent") {
        // 只推送 Agent 类型任务
        await this.nuwaxClient.request("POST", "/api/agent/task/create", {
          agentId: local.job_config.agentId,
          topic: local.name,
          summary: local.description,
          taskCron: local.cron_expression,
        });
        pushed++;
      }
    }

    return { success: true, pulled, pushed, conflicts: [] };
  }

  /**
   * 获取服务器支持的 cron 预设
   */
  async getCronPresets(): Promise<TaskCronInfo[]> {
    return await this.nuwaxClient.request("GET", "/api/agent/task/cron/list");
  }

  /**
   * 创建定时会话任务（直接调用服务器 API）
   */
  async createServerTask(input: CreateTimedConversationTaskDto): Promise<TimedConversationTaskInfo> {
    const result = await this.nuwaxClient.request(
      "POST",
      "/api/agent/task/create",
      input,
    );

    // 同时创建本地任务用于缓存
    await this.cronScheduler.createJob({
      id: this.getLocalJobId(result.id),
      name: input.topic,
      description: input.summary,
      cronExpression: input.taskCron,
      jobType: "agent",
      jobConfig: {
        agentId: input.agentId,
        conversationId: result.id,
        topic: input.topic,
        summary: input.summary,
      },
      serverJobId: result.taskId,
    });

    return result;
  }

  /**
   * 取消定时会话任务
   */
  async cancelServerTask(conversationId: number): Promise<void> {
    await this.nuwaxClient.request(
      "POST",
      `/api/agent/task/cancel/${conversationId}`,
    );

    // 同时删除本地任务
    this.cronScheduler.deleteJob(this.getLocalJobId(conversationId));
  }

  private getLocalJobId(serverId: number): string {
    return `server_task_${serverId}`;
  }
}

// ==================== 类型定义（来自服务器）====================

interface TaskCronInfo {
  typeName: string; // 类型：每天/每周/每月
  items: TaskCronItemDto[];
}

interface TaskCronItemDto {
  cron: string;  // cron 表达式
  desc: string;  // 描述
}

interface CreateTimedConversationTaskDto {
  agentId: number;
  devMode?: boolean;
  id?: number;
  summary: string;   // 任务内容
  taskCron: string;  // cron 表达式
  topic: string;     // 任务主题
}

interface TimedConversationTaskInfo {
  id?: number;
  agentId?: number;
  agent?: AgentDetailDto;
  topic?: string;
  summary?: string;
  taskCron?: string;
  taskCronDesc?: string;
  taskId?: string;
  taskStatus?: TaskStatus;
  created?: string;
  modified?: string;
}
```

---

## 六、UI 设计

### Heartbeat 状态页

```
┌─ 系统状态 ────────────────────────────────────────────────────────────┐
│                                                                       │
│  心跳间隔: 1 分钟                                    [调整] [暂停]     │
│  上次检查: 30 秒前                                                    │
│                                                                       │
│  ── 检查任务状态 ──────────────────────────────────────────────────── │
│                                                                       │
│  ✓ 服务器健康检查     已连接 · 延迟 45ms · 版本 2.1.0                 │
│  ✓ 配置同步检查       已同步 · 无待同步变更                           │
│  ✓ 会话同步检查       已同步 · 0 条待同步消息                         │
│  ○ 后台维护           等待中 · 下次执行: 5 分钟后                     │
│  ✓ 通知检查           无新通知                                        │
│                                                                       │
└───────────────────────────────────────────────────────────────────────┘
```

### Cron Jobs 管理页

```
┌─ 定时任务 ────────────────────────────────────────────────────────────┐
│                                                                       │
│  [+ 创建任务]  [从服务器同步]                        共 5 个任务       │
│                                                                       │
│  ── 任务列表 ──────────────────────────────────────────────────────── │
│                                                                       │
│  ☑ 早会提醒          每天 09:00      提醒     [编辑] [删除] [立即执行] │
│     "记得参加每日早会"                                                 │
│                                                                       │
│  ☑ 周报生成          每周一 18:00    Agent   [编辑] [删除] [立即执行]  │
│     "请生成本周工作总结"                                               │
│                                                                       │
│  ☑ 服务健康检查      每小时          Webhook [编辑] [删除] [立即执行]  │
│     POST https://api.example.com/health                              │
│                                                                       │
│  ☐ 日志清理          每天 00:00      脚本    [编辑] [删除] [立即执行]  │
│     ✗ 已禁用                                                          │
│                                                                       │
│  ── 创建/编辑任务 ────────────────────────────────────────────────────│
│                                                                       │
│  名称:    [________________]                                         │
│  类型:    ○ 提醒  ○ Agent 任务  ○ Webhook  ○ 脚本                     │
│                                                                       │
│  ── 提醒配置 ──────────────────────                                   │
│  标题:    [________________]                                         │
│  内容:    [________________]                                         │
│  ☑ 播放提示音                                                         │
│                                                                       │
│  ── 调度时间 ──────────────────────                                   │
│  ○ 周期性:  [选择预设: 每天/每周/每月/自定义 cron]                     │
│           [0 9 * * *]  预览: 每天 09:00                               │
│                                                                       │
│  ○ 一次性: [选择日期时间: 2026-03-10 14:30]                           │
│                                                                       │
│  时区:    Asia/Shanghai                                               │
│                                                                       │
│  [取消]  [保存并同步到服务器]                                          │
│                                                                       │
└───────────────────────────────────────────────────────────────────────┘
```

---

## 相关文档

- [总体架构](./01-ARCHITECTURE.md)
- [会话管理](./04-SESSION-CHAT.md)
- [Channel 多渠道接入](./05-CHANNELS.md)
- [Agent 自我进化](./06-SELF-EVOLUTION.md)
