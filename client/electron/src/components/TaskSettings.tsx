import { useState, useEffect } from 'react';
import { taskScheduler, ScheduledTask, TaskSchedule, TaskAction } from '../services/scheduler';

interface TaskSettingsProps {
  isOpen: boolean;
  onClose: () => void;
}

function TaskSettings({ isOpen, onClose }: TaskSettingsProps) {
  const [tasks, setTasks] = useState<ScheduledTask[]>([]);
  const [showAddForm, setShowAddForm] = useState(false);
  const [editingTask, setEditingTask] = useState<ScheduledTask | null>(null);
  const [message, setMessage] = useState('');

  // New task form state
  const [newTask, setNewTask] = useState({
    name: '',
    description: '',
    scheduleType: 'interval' as 'once' | 'interval' | 'cron',
    intervalValue: 60,
    intervalUnit: 'minutes',
    actionType: 'message' as 'message' | 'command' | 'webhook',
    actionContent: '',
    webhookUrl: '',
  });

  useEffect(() => {
    if (isOpen) {
      loadTasks();
    }
  }, [isOpen]);

  const loadTasks = async () => {
    await taskScheduler.loadTasks();
    setTasks(taskScheduler.getTasks());
  };

  const handleSave = async () => {
    await taskScheduler.saveTasks();
    setMessage('Tasks saved!');
    setTimeout(() => setMessage(''), 2000);
  };

  const handleAddTask = async () => {
    if (!newTask.name || !newTask.actionContent) {
      setMessage('Please fill required fields');
      return;
    }

    let intervalMs = 60000;
    switch (newTask.intervalUnit) {
      case 'minutes': intervalMs = newTask.intervalValue * 60000; break;
      case 'hours': intervalMs = newTask.intervalValue * 3600000; break;
      case 'days': intervalMs = newTask.intervalValue * 86400000; break;
    }

    const schedule: TaskSchedule = {
      type: newTask.scheduleType,
      ...(newTask.scheduleType === 'interval' && { intervalMs }),
    };

    const action: TaskAction = {
      type: newTask.actionType,
      content: newTask.actionContent,
      ...(newTask.actionType === 'webhook' && { url: newTask.webhookUrl, method: 'POST' }),
    };

    taskScheduler.createTask({
      name: newTask.name,
      description: newTask.description,
      enabled: true,
      schedule,
      action,
    });

    setShowAddForm(false);
    setNewTask({
      name: '',
      description: '',
      scheduleType: 'interval',
      intervalValue: 60,
      intervalUnit: 'minutes',
      actionType: 'message',
      actionContent: '',
      webhookUrl: '',
    });

    setTasks(taskScheduler.getTasks());
    setMessage('Task created!');
    setTimeout(() => setMessage(''), 2000);
  };

  const handleToggleTask = (id: string, enabled: boolean) => {
    taskScheduler.toggleTask(id, enabled);
    setTasks(taskScheduler.getTasks());
  };

  const handleDeleteTask = (id: string) => {
    taskScheduler.deleteTask(id);
    setTasks(taskScheduler.getTasks());
    setMessage('Task deleted');
    setTimeout(() => setMessage(''), 2000);
  };

  const handleRunNow = async (id: string) => {
    setMessage('Running task...');
    const result = await taskScheduler.runTask(id);
    setMessage(result.success ? 'Task executed!' : `Error: ${result.error}`);
    setTimeout(() => setMessage(''), 2000);
    setTasks(taskScheduler.getTasks());
  };

  const formatNextRun = (timestamp?: number) => {
    if (!timestamp) return 'N/A';
    const diff = timestamp - Date.now();
    if (diff < 0) return 'Now';
    if (diff < 60000) return `${Math.round(diff / 1000)}s`;
    if (diff < 3600000) return `${Math.round(diff / 60000)}m`;
    return `${Math.round(diff / 3600000)}h`;
  };

  if (!isOpen) return null;

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content task-modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>⏰ Scheduled Tasks</h2>
          <button className="close-btn" onClick={onClose}>×</button>
        </div>

        <div className="task-content">
          <div className="task-header">
            <span className="task-count">{tasks.length} tasks</span>
            <button className="add-task-btn" onClick={() => setShowAddForm(!showAddForm)}>
              {showAddForm ? '− Cancel' : '+ Add Task'}
            </button>
          </div>

          {showAddForm && (
            <div className="task-form">
              <div className="form-group">
                <label>Task Name *</label>
                <input
                  type="text"
                  value={newTask.name}
                  onChange={(e) => setNewTask({ ...newTask, name: e.target.value })}
                  placeholder="Daily news digest"
                />
              </div>

              <div className="form-group">
                <label>Description</label>
                <input
                  type="text"
                  value={newTask.description}
                  onChange={(e) => setNewTask({ ...newTask, description: e.target.value })}
                  placeholder="Get daily tech news"
                />
              </div>

              <div className="form-row">
                <div className="form-group">
                  <label>Schedule</label>
                  <select
                    value={newTask.scheduleType}
                    onChange={(e) => setNewTask({ ...newTask, scheduleType: e.target.value as any })}
                  >
                    <option value="interval">Interval</option>
                    <option value="once">Once</option>
                    <option value="cron">Cron</option>
                  </select>
                </div>

                {newTask.scheduleType === 'interval' && (
                  <div className="form-group">
                    <label>Every</label>
                    <div className="interval-input">
                      <input
                        type="number"
                        value={newTask.intervalValue}
                        onChange={(e) => setNewTask({ ...newTask, intervalValue: parseInt(e.target.value) })}
                        min={1}
                      />
                      <select
                        value={newTask.intervalUnit}
                        onChange={(e) => setNewTask({ ...newTask, intervalUnit: e.target.value as any })}
                      >
                        <option value="minutes">Minutes</option>
                        <option value="hours">Hours</option>
                        <option value="days">Days</option>
                      </select>
                    </div>
                  </div>
                )}
              </div>

              <div className="form-group">
                <label>Action Type</label>
                <select
                  value={newTask.actionType}
                  onChange={(e) => setNewTask({ ...newTask, actionType: e.target.value as any })}
                >
                  <option value="message">Send Message</option>
                  <option value="command">Run Command</option>
                  <option value="webhook">Webhook</option>
                </select>
              </div>

              <div className="form-group">
                <label>Content *</label>
                {newTask.actionType === 'message' && (
                  <textarea
                    value={newTask.actionContent}
                    onChange={(e) => setNewTask({ ...newTask, actionContent: e.target.value })}
                    placeholder="Get the latest tech news"
                    rows={3}
                  />
                )}
                {newTask.actionType === 'command' && (
                  <input
                    type="text"
                    value={newTask.actionContent}
                    onChange={(e) => setNewTask({ ...newTask, actionContent: e.target.value })}
                    placeholder="npm run build"
                  />
                )}
                {newTask.actionType === 'webhook' && (
                  <>
                    <input
                      type="text"
                      value={newTask.webhookUrl}
                      onChange={(e) => setNewTask({ ...newTask, webhookUrl: e.target.value })}
                      placeholder="https://api.example.com/webhook"
                    />
                    <input
                      type="text"
                      value={newTask.actionContent}
                      onChange={(e) => setNewTask({ ...newTask, actionContent: e.target.value })}
                      placeholder="Request body (JSON)"
                      style={{ marginTop: '8px' }}
                    />
                  </>
                )}
              </div>

              <button className="create-task-btn" onClick={handleAddTask}>
                Create Task
              </button>
            </div>
          )}

          <div className="task-list">
            {tasks.length === 0 && !showAddForm && (
              <div className="empty-state">
                <p>No scheduled tasks</p>
                <p className="hint">Create a task to automate your workflow</p>
              </div>
            )}

            {tasks.map((task) => (
              <div key={task.id} className={`task-item ${task.status}`}>
                <div className="task-info">
                  <div className="task-header-row">
                    <span className="task-name">{task.name}</span>
                    <span className={`task-status ${task.status}`}>
                      {task.status === 'running' && '⟳'}
                      {task.status === 'success' && '✓'}
                      {task.status === 'error' && '✗'}
                      {task.status === 'idle' && '○'}
                    </span>
                  </div>
                  {task.description && (
                    <div className="task-desc">{task.description}</div>
                  )}
                  <div className="task-meta">
                    <span>Next: {formatNextRun(task.nextRun)}</span>
                    {task.lastRun && <span>Last: {formatNextRun(Date.now() - task.lastRun)} ago</span>}
                  </div>
                </div>
                <div className="task-actions">
                  <label className="toggle">
                    <input
                      type="checkbox"
                      checked={task.enabled}
                      onChange={(e) => handleToggleTask(task.id, e.target.checked)}
                    />
                    <span className="toggle-slider"></span>
                  </label>
                  <button className="run-btn" onClick={() => handleRunNow(task.id)}>▶</button>
                  <button className="delete-btn" onClick={() => handleDeleteTask(task.id)}>×</button>
                </div>
              </div>
            ))}
          </div>
        </div>

        {message && <div className="task-message">{message}</div>}

        <div className="modal-footer">
          <button className="save-btn" onClick={handleSave}>
            Save Tasks
          </button>
        </div>
      </div>
    </div>
  );
}

export default TaskSettings;
