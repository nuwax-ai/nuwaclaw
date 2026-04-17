/**
 * LogViewer - 日志查看器 (Electron 版)
 *
 * - 两个子 Tab：应用日志（原有）+ 审计日志（从 ComplianceAuditPage 整合）
 * - 应用日志：级别筛选、自动滚动、分页加载
 * - 审计日志：事件类型筛选、仅显示被拦截、刷新、导出
 */

import React, {
  useState,
  useEffect,
  useRef,
  useCallback,
  useLayoutEffect,
  useMemo,
} from "react";
import {
  Button,
  Select,
  Switch,
  Empty,
  Spin,
  Tag,
  Tabs,
  Table,
  Space,
  Input,
  Tooltip,
  message,
} from "antd";
import {
  ReloadOutlined,
  VerticalAlignBottomOutlined,
  DownloadOutlined,
  SearchOutlined,
  CheckCircleOutlined,
  CloseCircleOutlined,
} from "@ant-design/icons";
import type { ColumnsType } from "antd/es/table";
import type { AuditEventEntry } from "@shared/types/electron";
import dayjs from "dayjs";
import { t } from "@renderer/services/core/i18n";
import { I18N_KEYS } from "@shared/constants";
import styles from "../../styles/components/ClientPage.module.css";

// ─── 通用常量 ───────────────────────────────────────────────

const PAGE_SIZE = 2000;
const LOAD_MORE_THRESHOLD = 80;

const LEVEL_TAG_COLORS: Record<string, string> = {
  error: "red",
  warn: "orange",
  info: "blue",
  debug: "default",
};

// ─── 审计日志类型 ────────────────────────────────────────────

type AuditLogEntry = AuditEventEntry;

const EVENT_TYPE_MAP: Record<string, { color: string; labelKey: string }> = {
  path_blocked: {
    color: "red",
    labelKey: I18N_KEYS.Audit.EVENT_TYPE.PATH_BLOCKED,
  },
  path_allowed: {
    color: "green",
    labelKey: I18N_KEYS.Audit.EVENT_TYPE.PATH_ALLOWED,
  },
  command_blocked: {
    color: "red",
    labelKey: I18N_KEYS.Audit.EVENT_TYPE.COMMAND_BLOCKED,
  },
  command_allowed: {
    color: "green",
    labelKey: I18N_KEYS.Audit.EVENT_TYPE.COMMAND_ALLOWED,
  },
  permission_requested: {
    color: "blue",
    labelKey: I18N_KEYS.Audit.EVENT_TYPE.PERMISSION_REQUESTED,
  },
  permission_approved: {
    color: "green",
    labelKey: I18N_KEYS.Audit.EVENT_TYPE.PERMISSION_APPROVED,
  },
  permission_denied: {
    color: "red",
    labelKey: I18N_KEYS.Audit.EVENT_TYPE.PERMISSION_DENIED,
  },
  permission_auto_approved: {
    color: "cyan",
    labelKey: I18N_KEYS.Audit.EVENT_TYPE.PERMISSION_AUTO_APPROVED,
  },
  operation_executed: {
    color: "green",
    labelKey: I18N_KEYS.Audit.EVENT_TYPE.OPERATION_EXECUTED,
  },
  operation_failed: {
    color: "orange",
    labelKey: I18N_KEYS.Audit.EVENT_TYPE.OPERATION_FAILED,
  },
  sandbox_created: {
    color: "blue",
    labelKey: I18N_KEYS.Audit.EVENT_TYPE.SANDBOX_CREATED,
  },
  sandbox_destroyed: {
    color: "default",
    labelKey: I18N_KEYS.Audit.EVENT_TYPE.SANDBOX_DESTROYED,
  },
};

// ─── 应用日志类型 ────────────────────────────────────────────

interface LogEntry {
  timestamp: string;
  level: string;
  message: string;
}

// ─── 审计日志子 Tab ──────────────────────────────────────────

function AuditLogsTab() {
  const [events, setEvents] = useState<AuditLogEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [eventTypeFilter, setEventTypeFilter] = useState<string>("");
  const [showOnlyBlocked, setShowOnlyBlocked] = useState(false);

  const loadAuditData = useCallback(async () => {
    setLoading(true);
    try {
      const res = await window.electronAPI?.audit?.getRecentEvents({
        limit: 200,
      });
      if (res?.success) {
        setEvents(res.events || []);
      }
    } catch (error) {
      console.error("[AuditLogsTab] Failed to load audit data:", error);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadAuditData();
  }, [loadAuditData]);

  const handleExport = async () => {
    try {
      const result = await window.electronAPI?.audit?.exportLogs({});
      if (result?.success) {
        message.success(t(I18N_KEYS.Audit.EXPORT_SUCCESS, result.count ?? 0));
      } else {
        message.error(t(I18N_KEYS.Audit.EXPORT_FAILED));
      }
    } catch (error) {
      console.error("[AuditLogsTab] Export failed:", error);
      message.error(t(I18N_KEYS.Audit.EXPORT_FAILED));
    }
  };

  const filteredEvents = useMemo(
    () =>
      events.filter((event) => {
        if (eventTypeFilter && event.eventType !== eventTypeFilter)
          return false;
        if (showOnlyBlocked && event.allowed) return false;
        return true;
      }),
    [events, eventTypeFilter, showOnlyBlocked],
  );

  const columns: ColumnsType<AuditLogEntry> = [
    {
      title: t(I18N_KEYS.Audit.TABLE_TIMESTAMP),
      dataIndex: "timestamp",
      key: "timestamp",
      width: 160,
      render: (timestamp: string) => (
        <Tooltip title={timestamp}>
          {dayjs(timestamp).format("MM-DD HH:mm:ss")}
        </Tooltip>
      ),
    },
    {
      title: t(I18N_KEYS.Audit.TABLE_EVENT_TYPE),
      dataIndex: "eventType",
      key: "eventType",
      width: 130,
      render: (eventType: string) => {
        const config = EVENT_TYPE_MAP[eventType] || {
          color: "default",
          labelKey: eventType,
        };
        return <Tag color={config.color}>{t(config.labelKey)}</Tag>;
      },
    },
    {
      title: t(I18N_KEYS.Audit.TABLE_OPERATION),
      dataIndex: "operation",
      key: "operation",
      ellipsis: true,
      render: (operation?: string) => operation || "-",
    },
    {
      title: t(I18N_KEYS.Audit.TABLE_TARGET),
      dataIndex: "target",
      key: "target",
      width: 200,
      ellipsis: true,
      render: (target?: string) => (
        <Tooltip title={target}>
          <span style={{ fontFamily: "monospace", fontSize: 11 }}>
            {target || "-"}
          </span>
        </Tooltip>
      ),
    },
    {
      title: t(I18N_KEYS.Audit.TABLE_STATUS),
      dataIndex: "allowed",
      key: "allowed",
      width: 80,
      render: (allowed: boolean) => (
        <Tag
          color={allowed ? "success" : "error"}
          icon={allowed ? <CheckCircleOutlined /> : <CloseCircleOutlined />}
        >
          {allowed
            ? t(I18N_KEYS.Audit.STATUS_ALLOWED)
            : t(I18N_KEYS.Audit.STATUS_BLOCKED)}
        </Tag>
      ),
    },
    {
      title: t(I18N_KEYS.Audit.TABLE_REASON),
      dataIndex: "reason",
      key: "reason",
      ellipsis: true,
      render: (reason: string | undefined, record: AuditLogEntry) => (
        <Tooltip title={reason || record.error}>
          <span style={{ color: record.allowed ? undefined : "#ff4d4f" }}>
            {reason || record.error || "-"}
          </span>
        </Tooltip>
      ),
    },
  ];

  const eventTypeOptions = Object.entries(EVENT_TYPE_MAP).map(
    ([value, config]) => ({
      value,
      label: t(config.labelKey),
    }),
  );

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        flex: 1,
        minHeight: 0,
        overflow: "hidden",
      }}
    >
      {/* Toolbar */}
      <div className={styles.servicesHeader}>
        <div className={styles.servicesHeaderLeft}>
          <Select
            size="small"
            placeholder={t(I18N_KEYS.Audit.FILTER_EVENT_TYPE)}
            value={eventTypeFilter || undefined}
            onChange={setEventTypeFilter}
            options={eventTypeOptions}
            style={{ width: 160 }}
            allowClear
          />
          <span style={{ fontSize: 12, color: "var(--color-text-secondary)" }}>
            {t(I18N_KEYS.Audit.ONLY_BLOCKED)}
          </span>
          <Switch
            size="small"
            checked={showOnlyBlocked}
            onChange={setShowOnlyBlocked}
          />
        </div>
        <div className={styles.servicesHeaderActions}>
          <Button
            size="small"
            icon={<ReloadOutlined />}
            onClick={loadAuditData}
            loading={loading}
          >
            {t(I18N_KEYS.Pages.LogViewer.REFRESH)}
          </Button>
          <Button
            size="small"
            icon={<DownloadOutlined />}
            onClick={handleExport}
          >
            {t(I18N_KEYS.Audit.EXPORT)}
          </Button>
        </div>
      </div>

      {/* Table */}
      <div style={{ flex: 1, minHeight: 0, overflow: "auto" }}>
        <Spin spinning={loading}>
          {filteredEvents.length === 0 && !loading ? (
            <div
              style={{
                flex: 1,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                minHeight: 200,
              }}
            >
              <Empty
                description={t(I18N_KEYS.Audit.NO_DATA)}
                image={Empty.PRESENTED_IMAGE_SIMPLE}
              />
            </div>
          ) : (
            <Table
              columns={columns}
              dataSource={filteredEvents}
              rowKey="id"
              pagination={{ pageSize: 50, size: "small" }}
              size="small"
              scroll={{ x: 800 }}
            />
          )}
        </Spin>
      </div>
    </div>
  );
}

// ─── 应用日志子 Tab ──────────────────────────────────────────

function AppLogsTab() {
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const [levelFilter, setLevelFilter] = useState<string>("all");
  const [autoScroll, setAutoScroll] = useState(true);
  const listRef = useRef<HTMLDivElement>(null);
  const scrollRestoreRef = useRef<{ height: number; top: number } | null>(null);
  const isLoadingOlderRef = useRef(false);

  const fetchLogs = useCallback(async () => {
    try {
      const result = await window.electronAPI?.log?.list(PAGE_SIZE, 0);
      if (result) {
        setLogs(result);
        setHasMore(result.length >= PAGE_SIZE);
      }
    } catch (error) {
      console.error("[LogViewer] Failed to fetch logs:", error);
    } finally {
      setLoading(false);
    }
  }, []);

  const loadMore = useCallback(async () => {
    if (loadingMore || !hasMore) return;
    const el = listRef.current;
    if (!el) return;
    setLoadingMore(true);
    isLoadingOlderRef.current = true;
    try {
      const offset = logs.length;
      const older = await window.electronAPI?.log?.list(PAGE_SIZE, offset);
      if (older && older.length > 0) {
        scrollRestoreRef.current = {
          height: el.scrollHeight,
          top: el.scrollTop,
        };
        setLogs((prev) => [...older, ...prev]);
        setHasMore(older.length >= PAGE_SIZE);
      } else {
        setHasMore(false);
      }
    } catch (error) {
      console.error("[LogViewer] Load more failed:", error);
    } finally {
      setLoadingMore(false);
      setTimeout(() => {
        isLoadingOlderRef.current = false;
      }, 0);
    }
  }, [logs.length, hasMore, loadingMore]);

  useEffect(() => {
    fetchLogs();
    const timer = setInterval(fetchLogs, 5000);
    return () => clearInterval(timer);
  }, [fetchLogs]);

  useLayoutEffect(() => {
    const ref = scrollRestoreRef.current;
    const el = listRef.current;
    if (!ref || !el) return;
    const diff = el.scrollHeight - ref.height;
    if (diff > 0) {
      el.scrollTop = ref.top + diff;
    }
    scrollRestoreRef.current = null;
  }, [logs]);

  useEffect(() => {
    if (!autoScroll || !listRef.current) return;
    if (isLoadingOlderRef.current) return;
    listRef.current.scrollTop = listRef.current.scrollHeight;
  }, [logs, autoScroll]);

  const handleScroll = useCallback(() => {
    const el = listRef.current;
    if (!el || autoScroll || loadingMore || !hasMore) return;
    if (el.scrollTop <= LOAD_MORE_THRESHOLD) {
      loadMore();
    }
  }, [autoScroll, loadingMore, hasMore, loadMore]);

  const handleRefresh = () => {
    setLoading(true);
    setHasMore(true);
    fetchLogs();
  };

  const handleOpenDir = async () => {
    await window.electronAPI?.log?.openDir();
  };

  const filteredLogs =
    levelFilter === "all" ? logs : logs.filter((l) => l.level === levelFilter);

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        flex: 1,
        minHeight: 0,
        overflow: "hidden",
      }}
    >
      <div
        className={styles.section}
        style={{
          display: "flex",
          flexDirection: "column",
          flex: 1,
          minHeight: 0,
          marginBottom: 0,
        }}
      >
        <div className={styles.servicesHeader}>
          <div className={styles.servicesHeaderLeft}>
            <span
              style={{ fontSize: 12, color: "var(--color-text-secondary)" }}
            >
              {t(I18N_KEYS.Pages.LogViewer.AUTO_SCROLL)}
            </span>
            <Switch
              size="small"
              checked={autoScroll}
              onChange={setAutoScroll}
            />
            <Select
              size="small"
              value={levelFilter}
              onChange={setLevelFilter}
              style={{ width: 90 }}
              options={[
                { label: t(I18N_KEYS.Pages.LogViewer.ALL), value: "all" },
                { label: "Error", value: "error" },
                { label: "Warn", value: "warn" },
                { label: "Info", value: "info" },
                { label: "Debug", value: "debug" },
              ]}
            />
          </div>
          <div className={styles.servicesHeaderActions}>
            <Button
              size="small"
              icon={<ReloadOutlined />}
              onClick={handleRefresh}
              loading={loading}
            >
              {t(I18N_KEYS.Pages.LogViewer.REFRESH)}
            </Button>
            <Button size="small" onClick={handleOpenDir}>
              {t(I18N_KEYS.Pages.LogViewer.OPEN_DIR)}
            </Button>
          </div>
        </div>

        <div
          style={{
            flex: 1,
            minHeight: 0,
            overflow: "hidden",
            display: "flex",
            flexDirection: "column",
          }}
        >
          {loading && logs.length === 0 ? (
            <div
              style={{
                flex: 1,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <Spin size="small" />
            </div>
          ) : filteredLogs.length === 0 ? (
            <div
              style={{
                flex: 1,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <Empty
                description={t(I18N_KEYS.Pages.LogViewer.NO_LOGS)}
                image={Empty.PRESENTED_IMAGE_SIMPLE}
              />
            </div>
          ) : (
            <div
              ref={listRef}
              onScroll={handleScroll}
              style={{
                flex: 1,
                minHeight: 0,
                overflowY: "auto",
                padding: "8px 0",
                fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
                fontSize: 12,
                lineHeight: 1.7,
                background: "var(--color-bg-container)",
              }}
            >
              {hasMore && (
                <div
                  style={{
                    padding: "8px 12px",
                    color: "var(--color-text-tertiary)",
                    fontSize: 11,
                    textAlign: "center",
                  }}
                >
                  {loadingMore ? (
                    <Spin size="small" />
                  ) : (
                    t(I18N_KEYS.Pages.LogViewer.SCROLL_TO_LOAD_MORE)
                  )}
                </div>
              )}
              {filteredLogs.map((entry, idx) => (
                <div
                  key={`${idx}-${entry.timestamp}-${entry.message?.slice(0, 100)}`}
                  style={{
                    padding: "1px 12px",
                    display: "flex",
                    gap: 8,
                    alignItems: "flex-start",
                  }}
                >
                  <span
                    style={{
                      color: "var(--color-text-tertiary)",
                      flexShrink: 0,
                    }}
                  >
                    {entry.timestamp}
                  </span>
                  <Tag
                    color={LEVEL_TAG_COLORS[entry.level] || "default"}
                    style={{
                      margin: 0,
                      fontSize: 10,
                      lineHeight: "18px",
                      flexShrink: 0,
                    }}
                  >
                    {entry.level.toUpperCase()}
                  </Tag>
                  <span
                    style={{
                      color:
                        entry.level === "error"
                          ? "var(--color-error)"
                          : entry.level === "warn"
                            ? "var(--color-warning)"
                            : entry.level === "info"
                              ? "var(--color-info)"
                              : "var(--color-text)",
                      wordBreak: "break-all",
                    }}
                  >
                    {entry.message}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
      <div
        style={{
          padding: "8px 16px",
          display: "flex",
          justifyContent: "space-between",
          fontSize: 11,
          color: "var(--color-text-tertiary)",
        }}
      >
        <span>
          {t(I18N_KEYS.Pages.LogViewer.TOTAL_LOGS, filteredLogs.length)}
        </span>
        {autoScroll && (
          <span>
            <VerticalAlignBottomOutlined style={{ marginRight: 4 }} />
            {t(I18N_KEYS.Pages.LogViewer.AUTO_SCROLL_ENABLED)}
          </span>
        )}
      </div>
    </div>
  );
}

// ─── 主组件：日志查看器 ──────────────────────────────────────

export default function LogViewer() {
  const [activeSubTab, setActiveSubTab] = useState("app");

  return (
    <div
      className={styles.section}
      style={{
        display: "flex",
        flexDirection: "column",
        flex: 1,
        minHeight: 0,
        overflow: "hidden",
      }}
    >
      <Tabs
        activeKey={activeSubTab}
        onChange={setActiveSubTab}
        size="small"
        className="log-viewer-tabs"
        style={{ padding: "0 16px" }}
        tabBarStyle={{ marginBottom: 0, flexShrink: 0 }}
        items={[
          {
            key: "app",
            label: t("Claw.LogViewer.tabAppLogs"),
            children: <AppLogsTab />,
            forceRender: true,
          },
          {
            key: "audit",
            label: t("Claw.LogViewer.tabAuditLogs"),
            children: <AuditLogsTab />,
          },
        ]}
      />
    </div>
  );
}
