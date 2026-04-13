/**
 * TasksPage — Harness 任务管理页面
 *
 * 功能：
 * - 展示所有 Harness 任务列表（状态、引擎、时长）
 * - 创建新任务（输入描述 → 自动分解步骤）
 * - 查看任务检查点进度
 * - 取消 / 断点续跑任务
 */

import React, { useState, useEffect, useCallback, useRef } from "react";
import {
  Button,
  Tag,
  Spin,
  message,
  Popconfirm,
  Empty,
  Modal,
  Input,
  Progress,
  Tooltip,
  Badge,
} from "antd";
import {
  PlusOutlined,
  ReloadOutlined,
  StopOutlined,
  PlayCircleOutlined,
  CheckCircleOutlined,
  CloseCircleOutlined,
  ClockCircleOutlined,
  LoadingOutlined,
} from "@ant-design/icons";
import { t } from "../../services/core/i18n";
import styles from "../../styles/components/ClientPage.module.css";
import type {
  HarnessTask,
  TaskCheckpoint,
  TaskStatus,
} from "@shared/types/harness";
import { CheckpointType } from "@shared/types/harness";
import { ApprovalBanner } from "../harness/ApprovalBanner";

// ==================== 状态颜色 ====================

const STATUS_COLOR: Record<TaskStatus, string> = {
  pending: "default",
  running: "processing",
  paused: "warning",
  completed: "success",
  failed: "error",
  cancelled: "default",
};

const STATUS_ICON: Record<TaskStatus, React.ReactNode> = {
  pending: <ClockCircleOutlined />,
  running: <LoadingOutlined />,
  paused: <ClockCircleOutlined style={{ color: "var(--color-warning)" }} />,
  completed: <CheckCircleOutlined style={{ color: "var(--color-success)" }} />,
  failed: <CloseCircleOutlined style={{ color: "var(--color-error)" }} />,
  cancelled: (
    <CloseCircleOutlined style={{ color: "var(--color-text-tertiary)" }} />
  ),
};

// 检查点顺序
const CP_ORDER = [
  CheckpointType.CP0_INIT,
  CheckpointType.CP1_PLAN,
  CheckpointType.CP2_EXEC,
  CheckpointType.CP3_VERIFY,
  CheckpointType.CP4_COMPLETE,
];

const CP_LABEL: Record<CheckpointType, string> = {
  [CheckpointType.CP0_INIT]: "Init",
  [CheckpointType.CP1_PLAN]: "Plan",
  [CheckpointType.CP2_EXEC]: "Execute",
  [CheckpointType.CP3_VERIFY]: "Verify",
  [CheckpointType.CP4_COMPLETE]: "Complete",
};

// ==================== 工具函数 ====================

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  const mins = Math.floor(ms / 60_000);
  const secs = Math.floor((ms % 60_000) / 1000);
  return `${mins}m ${secs}s`;
}

function getTaskDuration(task: HarnessTask): number | null {
  if (!task.completedAt) return null;
  return task.completedAt - task.createdAt;
}

function getCheckpointProgress(checkpoints: TaskCheckpoint[]): number {
  if (checkpoints.length === 0) return 0;
  const passed = checkpoints.filter((cp) => cp.status === "passed").length;
  return Math.round((passed / checkpoints.length) * 100);
}

// ==================== 检查点进度条 ====================

function CheckpointProgress({
  checkpoints,
}: {
  checkpoints: TaskCheckpoint[];
}) {
  const cpMap = new Map(checkpoints.map((cp) => [cp.type, cp]));

  return (
    <div style={{ display: "flex", gap: 4, alignItems: "center" }}>
      {CP_ORDER.map((type) => {
        const cp = cpMap.get(type);
        const status = cp?.status ?? "pending";
        let color = "var(--color-border)";
        if (status === "passed") color = "var(--color-success)";
        else if (status === "active") color = "var(--color-info)";
        else if (status === "failed") color = "var(--color-error)";

        return (
          <Tooltip key={type} title={`${CP_LABEL[type]}: ${status}`}>
            <div
              style={{
                width: 28,
                height: 6,
                borderRadius: 3,
                backgroundColor: color,
                transition: "background-color 0.3s",
              }}
            />
          </Tooltip>
        );
      })}
    </div>
  );
}

// ==================== 任务行 ====================

function TaskRow({
  task,
  onCancel,
  onResume,
  onViewDetail,
}: {
  task: HarnessTask;
  onCancel: (id: string) => void;
  onResume: (id: string) => void;
  onViewDetail: (id: string) => void;
}) {
  const [checkpoints, setCheckpoints] = useState<TaskCheckpoint[]>([]);

  useEffect(() => {
    window.electronAPI?.harness
      .getCheckpoints(task.id)
      .then((res) => {
        if (res.success && res.data) setCheckpoints(res.data);
      })
      .catch(() => {});
  }, [task.id, task.status]);

  const duration = getTaskDuration(task);
  const progress = getCheckpointProgress(checkpoints);
  const canResume =
    (task.status === "failed" || task.status === "paused") &&
    checkpoints.length > 0;

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        padding: "10px 16px",
        gap: 12,
        borderBottom: "1px solid var(--color-border-secondary)",
        cursor: "pointer",
      }}
      onClick={() => onViewDetail(task.id)}
    >
      {/* 状态图标 */}
      <div style={{ fontSize: 16, flexShrink: 0 }}>
        {STATUS_ICON[task.status]}
      </div>

      {/* 任务信息 */}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            marginBottom: 4,
          }}
        >
          <span
            style={{
              fontSize: 13,
              fontWeight: 500,
              color: "var(--color-text-primary)",
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
              flex: 1,
            }}
          >
            {task.title}
          </span>
          <Tag
            color={STATUS_COLOR[task.status]}
            style={{ margin: 0, fontSize: 11, flexShrink: 0 }}
          >
            {task.status}
          </Tag>
          <Tag style={{ margin: 0, fontSize: 11, flexShrink: 0, opacity: 0.7 }}>
            {task.engineType}
          </Tag>
        </div>

        {/* 检查点进度 */}
        {checkpoints.length > 0 && (
          <div
            style={{ display: "flex", alignItems: "center", gap: 8 }}
            onClick={(e) => e.stopPropagation()}
          >
            <CheckpointProgress checkpoints={checkpoints} />
            {task.status === "running" && (
              <span
                style={{ fontSize: 11, color: "var(--color-text-tertiary)" }}
              >
                {progress}%
              </span>
            )}
          </div>
        )}

        {/* 时长 */}
        {duration !== null && (
          <div
            style={{
              fontSize: 11,
              color: "var(--color-text-tertiary)",
              marginTop: 2,
            }}
          >
            {formatDuration(duration)}
          </div>
        )}
      </div>

      {/* 操作按钮 */}
      <div
        style={{ display: "flex", gap: 6, flexShrink: 0 }}
        onClick={(e) => e.stopPropagation()}
      >
        {canResume && (
          <Button
            size="small"
            icon={<PlayCircleOutlined />}
            onClick={() => onResume(task.id)}
          >
            {t("Claw.Tasks.resume")}
          </Button>
        )}
        {(task.status === "running" || task.status === "pending") && (
          <Popconfirm
            title={t("Claw.Tasks.confirmCancel")}
            onConfirm={() => onCancel(task.id)}
            okText={t("Claw.Common.confirm")}
            cancelText={t("Claw.Common.cancel")}
          >
            <Button size="small" danger icon={<StopOutlined />}>
              {t("Claw.Tasks.cancel")}
            </Button>
          </Popconfirm>
        )}
      </div>
    </div>
  );
}

// ==================== 任务详情 Modal ====================

function TaskDetailModal({
  taskId,
  onClose,
}: {
  taskId: string | null;
  onClose: () => void;
}) {
  const [task, setTask] = useState<HarnessTask | null>(null);
  const [checkpoints, setCheckpoints] = useState<TaskCheckpoint[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!taskId) return;
    setLoading(true);
    Promise.all([
      window.electronAPI?.harness.getTask(taskId),
      window.electronAPI?.harness.getCheckpoints(taskId),
    ])
      .then(([taskRes, cpRes]) => {
        if (taskRes?.success && taskRes.data) setTask(taskRes.data);
        if (cpRes?.success && cpRes.data) setCheckpoints(cpRes.data);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [taskId]);

  const cpMap = new Map(checkpoints.map((cp) => [cp.type, cp]));

  return (
    <Modal
      open={!!taskId}
      onCancel={onClose}
      footer={null}
      title={task?.title ?? t("Claw.Tasks.detail")}
      width={520}
    >
      {loading ? (
        <div style={{ textAlign: "center", padding: 32 }}>
          <Spin />
        </div>
      ) : !task ? (
        <Empty description={t("Claw.Tasks.notFound")} />
      ) : (
        <div>
          {/* 基本信息 */}
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "auto 1fr",
              gap: "6px 16px",
              marginBottom: 20,
              fontSize: 13,
            }}
          >
            <span style={{ color: "var(--color-text-secondary)" }}>
              {t("Claw.Tasks.status")}
            </span>
            <Tag color={STATUS_COLOR[task.status]}>{task.status}</Tag>
            <span style={{ color: "var(--color-text-secondary)" }}>
              {t("Claw.Tasks.engine")}
            </span>
            <span>{task.engineType}</span>
            <span style={{ color: "var(--color-text-secondary)" }}>
              {t("Claw.Tasks.created")}
            </span>
            <span>{new Date(task.createdAt).toLocaleString()}</span>
            {task.completedAt && (
              <>
                <span style={{ color: "var(--color-text-secondary)" }}>
                  {t("Claw.Tasks.duration")}
                </span>
                <span>{formatDuration(task.completedAt - task.createdAt)}</span>
              </>
            )}
          </div>

          {/* 检查点 */}
          <div style={{ marginBottom: 8, fontWeight: 500, fontSize: 13 }}>
            {t("Claw.Tasks.checkpoints")}
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {CP_ORDER.map((type) => {
              const cp = cpMap.get(type);
              const status = cp?.status ?? "pending";
              const color =
                status === "passed"
                  ? "var(--color-success)"
                  : status === "active"
                    ? "var(--color-info)"
                    : status === "failed"
                      ? "var(--color-error)"
                      : "var(--color-text-tertiary)";

              return (
                <div
                  key={type}
                  style={{ display: "flex", alignItems: "center", gap: 10 }}
                >
                  <div
                    style={{
                      width: 8,
                      height: 8,
                      borderRadius: "50%",
                      backgroundColor: color,
                      flexShrink: 0,
                    }}
                  />
                  <span style={{ fontSize: 12, flex: 1 }}>
                    {CP_LABEL[type]}
                  </span>
                  <Tag
                    style={{ margin: 0, fontSize: 10 }}
                    color={status === "passed" ? "success" : undefined}
                  >
                    {status}
                  </Tag>
                  {cp?.passedAt && (
                    <span
                      style={{
                        fontSize: 10,
                        color: "var(--color-text-tertiary)",
                      }}
                    >
                      {new Date(cp.passedAt).toLocaleTimeString()}
                    </span>
                  )}
                </div>
              );
            })}
          </div>

          {/* 进度条 */}
          {checkpoints.length > 0 && (
            <Progress
              percent={getCheckpointProgress(checkpoints)}
              size="small"
              style={{ marginTop: 16 }}
            />
          )}
        </div>
      )}
    </Modal>
  );
}

// ==================== 创建任务 Modal ====================

function CreateTaskModal({
  open,
  engineType,
  onClose,
  onCreate,
}: {
  open: boolean;
  engineType: string;
  onClose: () => void;
  onCreate: (title: string) => Promise<void>;
}) {
  const [title, setTitle] = useState("");
  const [loading, setLoading] = useState(false);

  const handleCreate = async () => {
    const trimmed = title.trim();
    if (!trimmed) return;
    setLoading(true);
    try {
      await onCreate(trimmed);
      setTitle("");
      onClose();
    } finally {
      setLoading(false);
    }
  };

  return (
    <Modal
      open={open}
      onCancel={onClose}
      onOk={handleCreate}
      title={t("Claw.Tasks.create")}
      okText={t("Claw.Tasks.create")}
      cancelText={t("Claw.Common.cancel")}
      confirmLoading={loading}
      okButtonProps={{ disabled: !title.trim() }}
    >
      <div
        style={{
          marginBottom: 8,
          fontSize: 13,
          color: "var(--color-text-secondary)",
        }}
      >
        {t("Claw.Tasks.titleLabel")}
      </div>
      <Input.TextArea
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        placeholder={t("Claw.Tasks.titlePlaceholder")}
        rows={4}
        autoFocus
        onPressEnter={(e) => {
          if (e.ctrlKey || e.metaKey) void handleCreate();
        }}
      />
      <div
        style={{
          marginTop: 8,
          fontSize: 11,
          color: "var(--color-text-tertiary)",
        }}
      >
        {t("Claw.Tasks.engineHint", engineType)}
      </div>
    </Modal>
  );
}

// ==================== 主页面 ====================

interface TasksPageProps {
  engineType?: string;
  sessionId?: string;
}

export function TasksPage({
  engineType = "claude-code",
  sessionId,
}: TasksPageProps) {
  const [tasks, setTasks] = useState<HarnessTask[]>([]);
  const [loading, setLoading] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [detailTaskId, setDetailTaskId] = useState<string | null>(null);
  const [filterStatus, setFilterStatus] = useState<TaskStatus | "all">("all");
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const loadTasks = useCallback(async () => {
    setLoading(true);
    try {
      const res = await window.electronAPI?.harness.listTasks(
        filterStatus !== "all"
          ? { status: filterStatus, limit: 100 }
          : { limit: 100 },
      );
      if (res?.success && res.data) {
        setTasks(res.data);
      }
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  }, [filterStatus]);

  useEffect(() => {
    void loadTasks();
    // 轮询运行中任务的状态更新
    pollRef.current = setInterval(() => {
      void loadTasks();
    }, 10_000);
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [loadTasks]);

  const handleCreate = useCallback(
    async (title: string) => {
      const res = await window.electronAPI?.harness.createTask(
        title,
        engineType,
        sessionId,
      );
      if (!res?.success) {
        message.error(res?.error ?? t("Claw.Tasks.createFailed"));
        return;
      }
      message.success(t("Claw.Tasks.created"));
      void loadTasks();
    },
    [engineType, sessionId, loadTasks],
  );

  const handleCancel = useCallback(
    async (taskId: string) => {
      const res = await window.electronAPI?.harness.cancelTask(taskId);
      if (!res?.success) {
        message.error(res?.error ?? t("Claw.Tasks.cancelFailed"));
        return;
      }
      message.success(t("Claw.Tasks.cancelled"));
      void loadTasks();
    },
    [loadTasks],
  );

  const handleResume = useCallback(
    async (taskId: string) => {
      const res = await window.electronAPI?.harness.resumeTask(taskId);
      if (!res?.success) {
        message.error(res?.error ?? t("Claw.Tasks.resumeFailed"));
        return;
      }
      message.success(t("Claw.Tasks.resumed"));
      void loadTasks();
    },
    [loadTasks],
  );

  const STATUS_FILTERS: Array<{ key: TaskStatus | "all"; label: string }> = [
    { key: "all", label: t("Claw.Tasks.filterAll") },
    { key: "running", label: t("Claw.Tasks.filterRunning") },
    { key: "pending", label: t("Claw.Tasks.filterPending") },
    { key: "completed", label: t("Claw.Tasks.filterCompleted") },
    { key: "failed", label: t("Claw.Tasks.filterFailed") },
  ];

  const runningCount = tasks.filter((t) => t.status === "running").length;

  return (
    <div
      style={{
        height: "100%",
        display: "flex",
        flexDirection: "column",
        overflow: "hidden",
      }}
    >
      {/* 审批横幅 */}
      <ApprovalBanner />

      {/* 页头 */}
      <div
        style={{
          padding: "12px 16px",
          borderBottom: "1px solid var(--color-border)",
          display: "flex",
          alignItems: "center",
          gap: 8,
          flexShrink: 0,
        }}
      >
        <span style={{ fontWeight: 600, fontSize: 14, flex: 1 }}>
          {t("Claw.Tasks.title")}
        </span>
        {runningCount > 0 && (
          <Badge count={runningCount} color="var(--color-info)" />
        )}
        <Button
          size="small"
          icon={<ReloadOutlined />}
          onClick={() => void loadTasks()}
          loading={loading}
        />
        <Button
          size="small"
          type="primary"
          icon={<PlusOutlined />}
          onClick={() => setCreateOpen(true)}
        >
          {t("Claw.Tasks.create")}
        </Button>
      </div>

      {/* 状态过滤 */}
      <div
        style={{
          padding: "8px 16px",
          borderBottom: "1px solid var(--color-border-secondary)",
          display: "flex",
          gap: 6,
          flexShrink: 0,
        }}
      >
        {STATUS_FILTERS.map(({ key, label }) => (
          <Tag
            key={key}
            color={filterStatus === key ? "blue" : undefined}
            style={{ cursor: "pointer", userSelect: "none" }}
            onClick={() => setFilterStatus(key)}
          >
            {label}
          </Tag>
        ))}
      </div>

      {/* 任务列表 */}
      <div style={{ flex: 1, overflowY: "auto" }}>
        {loading && tasks.length === 0 ? (
          <div style={{ textAlign: "center", padding: 48 }}>
            <Spin />
          </div>
        ) : tasks.length === 0 ? (
          <Empty
            description={t("Claw.Tasks.empty")}
            style={{ paddingTop: 48 }}
          />
        ) : (
          tasks.map((task) => (
            <TaskRow
              key={task.id}
              task={task}
              onCancel={(id) => void handleCancel(id)}
              onResume={(id) => void handleResume(id)}
              onViewDetail={(id) => setDetailTaskId(id)}
            />
          ))
        )}
      </div>

      {/* 创建任务 Modal */}
      <CreateTaskModal
        open={createOpen}
        engineType={engineType}
        onClose={() => setCreateOpen(false)}
        onCreate={handleCreate}
      />

      {/* 任务详情 Modal */}
      <TaskDetailModal
        taskId={detailTaskId}
        onClose={() => setDetailTaskId(null)}
      />
    </div>
  );
}
