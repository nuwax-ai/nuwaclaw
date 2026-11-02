import { DEFAULT_SCHEDULER_MINUTE_INTERVAL } from '@shared/constants';

export interface ScheduledTask {
  id: string;
  name: string;
  description: string;
  enabled: boolean;
  schedule: TaskSchedule;
  action: TaskAction;
  lastRun?: number;
  nextRun?: number;
  status: 'idle' | 'running' | 'success' | 'error';
  lastError?: string;
}

export interface TaskSchedule {
  type: 'once' | 'interval' | 'cron';
  // For once
  timestamp?: number;
  // For interval
  intervalMs?: number;
  // For cron
  cron?: string;
}

export interface TaskAction {
  type: 'message' | 'command' | 'webhook';
  content: string;
  // For webhook
  url?: string;
  method?: 'GET' | 'POST';
  headers?: Record<string, string>;
}

export interface ScheduledTaskLog {
  id: string;
  taskId: string;
  timestamp: number;
  status: 'success' | 'error';
  output?: string;
  error?: string;
}

class TaskScheduler {
  private tasks: Map<string, ScheduledTask> = new Map();
  private timers: Map<string, NodeJS.Timeout> = new Map();
  private logs: Map<string, ScheduledTaskLog[]> = new Map();
  private maxLogsPerTask = 50;

  constructor() {
    // Load tasks from storage on init
  }

  // Create a new task
  createTask(task: Omit<ScheduledTask, 'id' | 'status' | 'lastRun' | 'nextRun'>): ScheduledTask {
    const id = crypto.randomUUID();
    const newTask: ScheduledTask = {
      ...task,
      id,
      status: 'idle',
    };

    this.tasks.set(id, newTask);
    this.scheduleTask(newTask);

    return newTask;
  }

  // Update a task
  updateTask(id: string, updates: Partial<ScheduledTask>): ScheduledTask | null {
    const task = this.tasks.get(id);
    if (!task) return null;

    const updatedTask = { ...task, ...updates };
    this.tasks.set(id, updatedTask);

    // Reschedule if schedule changed
    if (updates.schedule) {
      this.unscheduleTask(id);
      this.scheduleTask(updatedTask);
    }

    return updatedTask;
  }

  // Delete a task
  deleteTask(id: string): boolean {
    this.unscheduleTask(id);
    return this.tasks.delete(id);
  }

  // Get all tasks
  getTasks(): ScheduledTask[] {
    return Array.from(this.tasks.values());
  }

  // Get task by ID
  getTask(id: string): ScheduledTask | undefined {
    return this.tasks.get(id);
  }

  // Enable/disable task
  toggleTask(id: string, enabled: boolean): ScheduledTask | null {
    const task = this.tasks.get(id);
    if (!task) return null;

    task.enabled = enabled;

    if (enabled) {
      this.scheduleTask(task);
    } else {
      this.unscheduleTask(id);
    }

    return task;
  }

  // Run task immediately
  async runTask(id: string): Promise<{ success: boolean; error?: string }> {
    const task = this.tasks.get(id);
    if (!task) {
      return { success: false, error: 'Task not found' };
    }

    task.status = 'running';
    this.tasks.set(id, task);

    try {
      const result = await this.executeAction(task.action);

      task.status = 'success';
      task.lastRun = Date.now();
      task.lastError = undefined;
      this.tasks.set(id, task);

      this.addLog(task.id, { success: true, output: result });

      return { success: true };
    } catch (error) {
      task.status = 'error';
      task.lastError = String(error);
      this.tasks.set(id, task);

      this.addLog(task.id, { success: false, error: String(error) });

      return { success: false, error: String(error) };
    }
  }

  // Schedule a task
  private scheduleTask(task: ScheduledTask): void {
    if (!task.enabled) return;

    const now = Date.now();
    let nextRun: number;

    switch (task.schedule.type) {
      case 'once':
        if (task.schedule.timestamp && task.schedule.timestamp > now) {
          nextRun = task.schedule.timestamp;
        } else {
          return; // Past timestamp, don't schedule
        }
        break;

      case 'interval':
        if (task.schedule.intervalMs) {
          nextRun = now + task.schedule.intervalMs;
        } else {
          return;
        }
        break;

      case 'cron':
        // Simple cron implementation - just use interval for now
        nextRun = now + 60000; // Default 1 minute
        break;

      default:
        return;
    }

    task.nextRun = nextRun;
    this.tasks.set(task.id, task);

    const delay = Math.max(0, nextRun - now);

    const timer = setTimeout(async () => {
      await this.runTask(task.id);
      // Reschedule for next run
      if (task.enabled && task.schedule.type !== 'once') {
        this.scheduleTask(task);
      }
    }, delay);

    this.timers.set(task.id, timer);
  }

  // Unschedule a task
  private unscheduleTask(id: string): void {
    const timer = this.timers.get(id);
    if (timer) {
      clearTimeout(timer);
      this.timers.delete(id);
    }

    const task = this.tasks.get(id);
    if (task) {
      task.nextRun = undefined;
      this.tasks.set(id, task);
    }
  }

  // Execute task action
  private async executeAction(action: TaskAction): Promise<string> {
    switch (action.type) {
      case 'message':
        // This would trigger the AI to send a message
        return `Message: ${action.content}`;

      case 'command':
        // Execute shell command
        return `Command: ${action.content}`;

      case 'webhook':
        // Make HTTP request
        try {
          const response = await fetch(action.url!, {
            method: action.method || 'GET',
            headers: action.headers,
            body: action.method === 'POST' ? action.content : undefined,
          });
          return `Webhook response: ${response.status}`;
        } catch (error) {
          throw new Error(`Webhook failed: ${error}`);
        }

      default:
        throw new Error('Unknown action type');
    }
  }

  // Add log entry
  private addLog(taskId: string, result: { success: boolean; output?: string; error?: string }): void {
    const log: ScheduledTaskLog = {
      id: crypto.randomUUID(),
      taskId,
      timestamp: Date.now(),
      status: result.success ? 'success' : 'error',
      output: result.output,
      error: result.error,
    };

    const taskLogs = this.logs.get(taskId) || [];
    taskLogs.unshift(log);

    // Keep only last N logs
    if (taskLogs.length > this.maxLogsPerTask) {
      taskLogs.pop();
    }

    this.logs.set(taskId, taskLogs);
  }

  // Get logs for a task
  getLogs(taskId: string): ScheduledTaskLog[] {
    return this.logs.get(taskId) || [];
  }

  // Load tasks from storage
  async loadTasks(): Promise<void> {
    try {
      const saved = await window.electronAPI?.settings.get('scheduled_tasks');
      if (saved) {
        const tasks = saved as ScheduledTask[];
        for (const task of tasks) {
          this.tasks.set(task.id, task);
          if (task.enabled) {
            this.scheduleTask(task);
          }
        }
      }
    } catch (error) {
      console.error('Failed to load scheduled tasks:', error);
    }
  }

  // Save tasks to storage
  async saveTasks(): Promise<void> {
    try {
      const tasks = Array.from(this.tasks.values());
      await window.electronAPI?.settings.set('scheduled_tasks', tasks);
    } catch (error) {
      console.error('Failed to save scheduled tasks:', error);
    }
  }

  // Stop all tasks
  stopAll(): void {
    for (const id of this.timers.keys()) {
      this.unscheduleTask(id);
    }
  }
}

export const taskScheduler = new TaskScheduler();

// Common preset schedules
export const presetSchedules = {
  everyMinute: { type: 'interval' as const, intervalMs: DEFAULT_SCHEDULER_MINUTE_INTERVAL },
  everyHour: { type: 'interval' as const, intervalMs: 3600000 },
  everyDay: { type: 'interval' as const, intervalMs: 86400000 },
  everyWeek: { type: 'interval' as const, intervalMs: 604800000 },
};
