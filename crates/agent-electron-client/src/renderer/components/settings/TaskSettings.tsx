import { useState, useEffect } from "react";
import { t } from "../../services/core/i18n";
import {
  taskScheduler,
  ScheduledTask,
  TaskSchedule,
  TaskAction,
} from "../../services/integrations/scheduler";

interface TaskSettingsProps {
  isOpen: boolean;
  onClose: () => void;
}

function TaskSettings({ isOpen, onClose }: TaskSettingsProps) {
  const [tasks, setTasks] = useState<ScheduledTask[]>([]);
  const [showAddForm, setShowAddForm] = useState(false);
  const [editingTask, setEditingTask] = useState<ScheduledTask | null>(null);
  const [message, setMessage] = useState("");

  // New task form state
  const [newTask, setNewTask] = useState({
    name: "",
    description: "",
    scheduleType: "interval" as "once" | "interval" | "cron",
    intervalValue: 60,
    intervalUnit: "minutes",
    actionType: "message" as "message" | "command" | "webhook",
    actionContent: "",
    webhookUrl: "",
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
    setMessage(t("Claw.TaskSettings.taskSaved"));
    setTimeout(() => setMessage(""), 2000);
  };

  const handleAddTask = async () => {
    if (!newTask.name || !newTask.actionContent) {
      setMessage(t("Claw.TaskSettings.fillRequiredFields"));
      return;
    }

    let intervalMs = 60000;
    switch (newTask.intervalUnit) {
      case "minutes":
        intervalMs = newTask.intervalValue * 60000;
        break;
      case "hours":
        intervalMs = newTask.intervalValue * 3600000;
        break;
      case "days":
        intervalMs = newTask.intervalValue * 86400000;
        break;
    }

    const schedule: TaskSchedule = {
      type: newTask.scheduleType,
      ...(newTask.scheduleType === "interval" && { intervalMs }),
    };

    const action: TaskAction = {
      type: newTask.actionType,
      content: newTask.actionContent,
      ...(newTask.actionType === "webhook" && {
        url: newTask.webhookUrl,
        method: "POST",
      }),
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
      name: "",
      description: "",
      scheduleType: "interval",
      intervalValue: 60,
      intervalUnit: "minutes",
      actionType: "message",
      actionContent: "",
      webhookUrl: "",
    });

    setTasks(taskScheduler.getTasks());
    setMessage(t("Claw.TaskSettings.taskCreated"));
    setTimeout(() => setMessage(""), 2000);
  };

  const handleToggleTask = (id: string, enabled: boolean) => {
    taskScheduler.toggleTask(id, enabled);
    setTasks(taskScheduler.getTasks());
  };

  const handleDeleteTask = (id: string) => {
    taskScheduler.deleteTask(id);
    setTasks(taskScheduler.getTasks());
    setMessage(t("Claw.TaskSettings.taskDeleted"));
    setTimeout(() => setMessage(""), 2000);
  };

  const handleRunNow = async (id: string) => {
    setMessage(t("Claw.TaskSettings.executingTask"));
    const result = await taskScheduler.runTask(id);
    setMessage(
      result.success
        ? t("Claw.TaskSettings.taskCompleted")
        : t("Claw.TaskSettings.taskError", result.error || ""),
    );
    setTimeout(() => setMessage(""), 2000);
    setTasks(taskScheduler.getTasks());
  };

  const formatNextRun = (timestamp?: number) => {
    if (!timestamp) return t("Claw.TaskSettings.none");
    const diff = timestamp - Date.now();
    if (diff < 0) return t("Claw.TaskSettings.immediate");
    if (diff < 60000)
      return t("Claw.TaskSettings.seconds", Math.round(diff / 1000).toString());
    if (diff < 3600000)
      return t(
        "Claw.TaskSettings.minutes",
        Math.round(diff / 60000).toString(),
      );
    return t("Claw.TaskSettings.hours", Math.round(diff / 3600000).toString());
  };

  if (!isOpen) return null;

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div
        className="modal-content task-modal"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-header">
          <h2>{t("Claw.TaskSettings.title")}</h2>
          <button className="close-btn" onClick={onClose}>
            ×
          </button>
        </div>

        <div className="task-content">
          <div className="task-header">
            <span className="task-count">
              {t("Claw.TaskSettings.taskCount", tasks.length.toString())}
            </span>
            <button
              className="add-task-btn"
              onClick={() => setShowAddForm(!showAddForm)}
            >
              {showAddForm
                ? t("Claw.TaskSettings.cancel")
                : t("Claw.TaskSettings.addTask")}
            </button>
          </div>

          {showAddForm && (
            <div className="task-form">
              <div className="form-group">
                <label>{t("Claw.TaskSettings.taskNameRequired")}</label>
                <input
                  type="text"
                  value={newTask.name}
                  onChange={(e) =>
                    setNewTask({ ...newTask, name: e.target.value })
                  }
                  placeholder={t("Claw.TaskSettings.taskNamePlaceholder")}
                />
              </div>

              <div className="form-group">
                <label>{t("Claw.TaskSettings.description")}</label>
                <input
                  type="text"
                  value={newTask.description}
                  onChange={(e) =>
                    setNewTask({ ...newTask, description: e.target.value })
                  }
                  placeholder={t("Claw.TaskSettings.descriptionPlaceholder")}
                />
              </div>

              <div className="form-row">
                <div className="form-group">
                  <label>{t("Claw.TaskSettings.scheduleType")}</label>
                  <select
                    value={newTask.scheduleType}
                    onChange={(e) =>
                      setNewTask({
                        ...newTask,
                        scheduleType: e.target.value as any,
                      })
                    }
                  >
                    <option value="interval">
                      {t("Claw.TaskSettings.interval")}
                    </option>
                    <option value="once">{t("Claw.TaskSettings.once")}</option>
                    <option value="cron">{t("Claw.TaskSettings.cron")}</option>
                  </select>
                </div>

                {newTask.scheduleType === "interval" && (
                  <div className="form-group">
                    <label>{t("Claw.TaskSettings.interval")}</label>
                    <div className="interval-input">
                      <input
                        type="number"
                        value={newTask.intervalValue}
                        onChange={(e) =>
                          setNewTask({
                            ...newTask,
                            intervalValue: parseInt(e.target.value),
                          })
                        }
                        min={1}
                      />
                      <select
                        value={newTask.intervalUnit}
                        onChange={(e) =>
                          setNewTask({
                            ...newTask,
                            intervalUnit: e.target.value as any,
                          })
                        }
                      >
                        <option value="minutes">
                          {t("Claw.TaskSettings.minutesOption")}
                        </option>
                        <option value="hours">
                          {t("Claw.TaskSettings.hoursOption")}
                        </option>
                        <option value="days">
                          {t("Claw.TaskSettings.daysOption")}
                        </option>
                      </select>
                    </div>
                  </div>
                )}
              </div>

              <div className="form-group">
                <label>{t("Claw.TaskSettings.actionType")}</label>
                <select
                  value={newTask.actionType}
                  onChange={(e) =>
                    setNewTask({
                      ...newTask,
                      actionType: e.target.value as any,
                    })
                  }
                >
                  <option value="message">
                    {t("Claw.TaskSettings.sendMessage")}
                  </option>
                  <option value="command">
                    {t("Claw.TaskSettings.executeCommand")}
                  </option>
                  <option value="webhook">
                    {t("Claw.TaskSettings.webhook")}
                  </option>
                </select>
              </div>

              <div className="form-group">
                <label>{t("Claw.TaskSettings.contentRequired")}</label>
                {newTask.actionType === "message" && (
                  <textarea
                    value={newTask.actionContent}
                    onChange={(e) =>
                      setNewTask({ ...newTask, actionContent: e.target.value })
                    }
                    placeholder={t("Claw.TaskSettings.contentPlaceholder")}
                    rows={3}
                  />
                )}
                {newTask.actionType === "command" && (
                  <input
                    type="text"
                    value={newTask.actionContent}
                    onChange={(e) =>
                      setNewTask({ ...newTask, actionContent: e.target.value })
                    }
                    placeholder={t("Claw.TaskSettings.commandPlaceholder")}
                  />
                )}
                {newTask.actionType === "webhook" && (
                  <>
                    <input
                      type="text"
                      value={newTask.webhookUrl}
                      onChange={(e) =>
                        setNewTask({ ...newTask, webhookUrl: e.target.value })
                      }
                      placeholder={t("Claw.TaskSettings.webhookUrlPlaceholder")}
                    />
                    <input
                      type="text"
                      value={newTask.actionContent}
                      onChange={(e) =>
                        setNewTask({
                          ...newTask,
                          actionContent: e.target.value,
                        })
                      }
                      placeholder={t(
                        "Claw.TaskSettings.requestBodyPlaceholder",
                      )}
                      style={{ marginTop: "8px" }}
                    />
                  </>
                )}
              </div>

              <button className="create-task-btn" onClick={handleAddTask}>
                {t("Claw.TaskSettings.createTask")}
              </button>
            </div>
          )}

          <div className="task-list">
            {tasks.length === 0 && !showAddForm && (
              <div className="empty-state">
                <p>{t("Claw.TaskSettings.noTasks")}</p>
                <p className="hint">{t("Claw.TaskSettings.noTasksHint")}</p>
              </div>
            )}

            {tasks.map((task) => (
              <div key={task.id} className={`task-item ${task.status}`}>
                <div className="task-info">
                  <div className="task-header-row">
                    <span className="task-name">{task.name}</span>
                    <span className={`task-status ${task.status}`}>
                      {task.status === "running" && "⟳"}
                      {task.status === "success" && "✓"}
                      {task.status === "error" && "✗"}
                      {task.status === "idle" && "○"}
                    </span>
                  </div>
                  {task.description && (
                    <div className="task-desc">{task.description}</div>
                  )}
                  <div className="task-meta">
                    <span>
                      {t(
                        "Claw.TaskSettings.nextRun",
                        formatNextRun(task.nextRun),
                      )}
                    </span>
                    {task.lastRun && (
                      <span>
                        {t(
                          "Claw.TaskSettings.lastRun",
                          formatNextRun(Date.now() - task.lastRun),
                        )}
                      </span>
                    )}
                  </div>
                </div>
                <div className="task-actions">
                  <label className="toggle">
                    <input
                      type="checkbox"
                      checked={task.enabled}
                      onChange={(e) =>
                        handleToggleTask(task.id, e.target.checked)
                      }
                    />
                    <span className="toggle-slider"></span>
                  </label>
                  <button
                    className="run-btn"
                    onClick={() => handleRunNow(task.id)}
                  >
                    ▶
                  </button>
                  <button
                    className="delete-btn"
                    onClick={() => handleDeleteTask(task.id)}
                  >
                    ×
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>

        {message && <div className="task-message">{message}</div>}

        <div className="modal-footer">
          <button className="save-btn" onClick={handleSave}>
            {t("Claw.TaskSettings.saveTask")}
          </button>
        </div>
      </div>
    </div>
  );
}

export default TaskSettings;
