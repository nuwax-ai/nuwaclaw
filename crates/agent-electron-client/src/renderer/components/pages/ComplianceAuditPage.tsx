/**
 * 合规审计页面
 *
 * 展示审计日志记录，支持按会话筛选、导出等功能
 *
 * @version 1.0.0
 * @updated 2026-04-15
 */

import React, { useState, useEffect, useCallback } from "react";
import {
  Card,
  Table,
  Tag,
  Space,
  Button,
  Input,
  Select,
  DatePicker,
  Statistic,
  Row,
  Col,
  message,
  Tooltip,
  Empty,
  Spin,
} from "antd";
import {
  DownloadOutlined,
  ReloadOutlined,
  SearchOutlined,
  SafetyOutlined,
  CheckCircleOutlined,
  CloseCircleOutlined,
  WarningOutlined,
} from "@ant-design/icons";
import type { ColumnsType } from "antd/es/table";
import dayjs from "dayjs";
import { t } from "@renderer/services/core/i18n";
import { createLogger } from "@renderer/services/utils/rendererLog";

const log = createLogger("ComplianceAuditPage");

/** 审计日志条目类型 */
interface AuditLogEntry {
  id: string;
  timestamp: string;
  sessionId: string;
  eventType: string;
  operation?: string;
  target?: string;
  allowed: boolean;
  reason?: string;
  approvedBy?: "system" | "user";
  duration?: number;
  error?: string;
}

/** 安全指标类型 */
interface SecurityMetrics {
  totalOperations: number;
  blockedOperations: number;
  allowedOperations: number;
  userConfirmations: number;
  autoApprovals: number;
  pathViolations: number;
  commandViolations: number;
}

/** 事件类型映射 */
const EVENT_TYPE_MAP: Record<string, { color: string; labelKey: string }> = {
  path_blocked: { color: "red", labelKey: "Claw.Audit.eventType.pathBlocked" },
  path_allowed: {
    color: "green",
    labelKey: "Claw.Audit.eventType.pathAllowed",
  },
  command_blocked: {
    color: "red",
    labelKey: "Claw.Audit.eventType.commandBlocked",
  },
  command_allowed: {
    color: "green",
    labelKey: "Claw.Audit.eventType.commandAllowed",
  },
  permission_requested: {
    color: "blue",
    labelKey: "Claw.Audit.eventType.permissionRequested",
  },
  permission_approved: {
    color: "green",
    labelKey: "Claw.Audit.eventType.permissionApproved",
  },
  permission_denied: {
    color: "red",
    labelKey: "Claw.Audit.eventType.permissionDenied",
  },
  permission_auto_approved: {
    color: "cyan",
    labelKey: "Claw.Audit.eventType.permissionAutoApproved",
  },
  operation_executed: {
    color: "green",
    labelKey: "Claw.Audit.eventType.operationExecuted",
  },
  operation_failed: {
    color: "orange",
    labelKey: "Claw.Audit.eventType.operationFailed",
  },
  sandbox_created: {
    color: "blue",
    labelKey: "Claw.Audit.eventType.sandboxCreated",
  },
  sandbox_destroyed: {
    color: "default",
    labelKey: "Claw.Audit.eventType.sandboxDestroyed",
  },
};

const ComplianceAuditPage: React.FC = () => {
  const [events, setEvents] = useState<AuditLogEntry[]>([]);
  const [metrics, setMetrics] = useState<SecurityMetrics | null>(null);
  const [loading, setLoading] = useState(false);
  const [sessionIdFilter, setSessionIdFilter] = useState<string>("");
  const [eventTypeFilter, setEventTypeFilter] = useState<string>("");
  const [showOnlyBlocked, setShowOnlyBlocked] = useState(false);

  // 加载审计数据
  const loadAuditData = useCallback(async () => {
    setLoading(true);
    try {
      const [eventsRes, metricsRes] = await Promise.all([
        window.electronAPI?.audit?.getRecentEvents({ limit: 100 }),
        window.electronAPI?.audit?.getMetrics(),
      ]);

      if (eventsRes?.success) {
        setEvents(eventsRes.events || []);
      }
      if (metricsRes?.success) {
        setMetrics(metricsRes.metrics);
      }
    } catch (error) {
      log.error("Failed to load audit data:", error);
      message.error(t("Claw.Audit.loadFailed"));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadAuditData();
  }, [loadAuditData]);

  // 导出日志
  const handleExport = async () => {
    try {
      const result = await window.electronAPI?.audit?.exportLogs({
        outputPath: `audit-export-${dayjs().format("YYYY-MM-DD-HHmmss")}.json`,
      });
      if (result?.success) {
        message.success(t("Claw.Audit.exportSuccess", { count: result.count }));
      } else {
        message.error(t("Claw.Audit.exportFailed"));
      }
    } catch (error) {
      log.error("Export failed:", error);
      message.error(t("Claw.Audit.exportFailed"));
    }
  };

  // 筛选后的事件
  const filteredEvents = events.filter((event) => {
    if (sessionIdFilter && !event.sessionId.includes(sessionIdFilter)) {
      return false;
    }
    if (eventTypeFilter && event.eventType !== eventTypeFilter) {
      return false;
    }
    if (showOnlyBlocked && event.allowed) {
      return false;
    }
    return true;
  });

  // 表格列定义
  const columns: ColumnsType<AuditLogEntry> = [
    {
      title: t("Claw.Audit.column.timestamp"),
      dataIndex: "timestamp",
      key: "timestamp",
      width: 180,
      render: (timestamp: string) => (
        <Tooltip title={timestamp}>
          {dayjs(timestamp).format("MM-DD HH:mm:ss")}
        </Tooltip>
      ),
    },
    {
      title: t("Claw.Audit.column.sessionId"),
      dataIndex: "sessionId",
      key: "sessionId",
      width: 120,
      ellipsis: true,
      render: (sessionId: string) => (
        <Tooltip title={sessionId}>
          <span style={{ fontFamily: "monospace", fontSize: 12 }}>
            {sessionId.slice(0, 8)}...
          </span>
        </Tooltip>
      ),
    },
    {
      title: t("Claw.Audit.column.eventType"),
      dataIndex: "eventType",
      key: "eventType",
      width: 140,
      render: (eventType: string) => {
        const config = EVENT_TYPE_MAP[eventType] || {
          color: "default",
          labelKey: eventType,
        };
        return <Tag color={config.color}>{t(config.labelKey)}</Tag>;
      },
    },
    {
      title: t("Claw.Audit.column.operation"),
      dataIndex: "operation",
      key: "operation",
      ellipsis: true,
      render: (operation?: string) => operation || "-",
    },
    {
      title: t("Claw.Audit.column.target"),
      dataIndex: "target",
      key: "target",
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
      title: t("Claw.Audit.column.status"),
      dataIndex: "allowed",
      key: "allowed",
      width: 80,
      render: (allowed: boolean) => (
        <Tag
          color={allowed ? "success" : "error"}
          icon={allowed ? <CheckCircleOutlined /> : <CloseCircleOutlined />}
        >
          {allowed
            ? t("Claw.Audit.status.allowed")
            : t("Claw.Audit.status.blocked")}
        </Tag>
      ),
    },
    {
      title: t("Claw.Audit.column.approvedBy"),
      dataIndex: "approvedBy",
      key: "approvedBy",
      width: 100,
      render: (approvedBy?: "system" | "user") => {
        if (!approvedBy) return "-";
        return (
          <Tag color={approvedBy === "system" ? "cyan" : "blue"}>
            {approvedBy === "system"
              ? t("Claw.Audit.approvedBy.system")
              : t("Claw.Audit.approvedBy.user")}
          </Tag>
        );
      },
    },
    {
      title: t("Claw.Audit.column.reason"),
      dataIndex: "reason",
      key: "reason",
      ellipsis: true,
      render: (reason?: string, record: AuditLogEntry) => (
        <Tooltip title={reason || record.error}>
          <span style={{ color: record.allowed ? undefined : "#ff4d4f" }}>
            {reason || record.error || "-"}
          </span>
        </Tooltip>
      ),
    },
  ];

  // 事件类型选项
  const eventTypeOptions = Object.entries(EVENT_TYPE_MAP).map(
    ([value, config]) => ({
      value,
      label: t(config.labelKey),
    }),
  );

  return (
    <div style={{ padding: 24 }}>
      <h2 style={{ marginBottom: 24 }}>
        <SafetyOutlined style={{ marginRight: 8 }} />
        {t("Claw.Audit.title")}
      </h2>

      {/* 统计卡片 */}
      {metrics && (
        <Row gutter={16} style={{ marginBottom: 24 }}>
          <Col span={4}>
            <Card size="small">
              <Statistic
                title={t("Claw.Audit.metric.totalOperations")}
                value={metrics.totalOperations}
              />
            </Card>
          </Col>
          <Col span={4}>
            <Card size="small">
              <Statistic
                title={t("Claw.Audit.metric.allowedOperations")}
                value={metrics.allowedOperations}
                valueStyle={{ color: "#3f8600" }}
              />
            </Card>
          </Col>
          <Col span={4}>
            <Card size="small">
              <Statistic
                title={t("Claw.Audit.metric.blockedOperations")}
                value={metrics.blockedOperations}
                valueStyle={{ color: "#cf1322" }}
              />
            </Card>
          </Col>
          <Col span={4}>
            <Card size="small">
              <Statistic
                title={t("Claw.Audit.metric.userConfirmations")}
                value={metrics.userConfirmations}
                prefix={<SafetyOutlined />}
              />
            </Card>
          </Col>
          <Col span={4}>
            <Card size="small">
              <Statistic
                title={t("Claw.Audit.metric.autoApprovals")}
                value={metrics.autoApprovals}
              />
            </Card>
          </Col>
          <Col span={4}>
            <Card size="small">
              <Statistic
                title={t("Claw.Audit.metric.violations")}
                value={metrics.pathViolations + metrics.commandViolations}
                valueStyle={{
                  color:
                    metrics.pathViolations + metrics.commandViolations > 0
                      ? "#cf1322"
                      : "#3f8600",
                }}
                prefix={
                  metrics.pathViolations + metrics.commandViolations > 0 ? (
                    <WarningOutlined />
                  ) : (
                    <CheckCircleOutlined />
                  )
                }
              />
            </Card>
          </Col>
        </Row>
      )}

      {/* 筛选工具栏 */}
      <Card size="small" style={{ marginBottom: 16 }}>
        <Space wrap>
          <Input
            placeholder={t("Claw.Audit.filter.sessionId")}
            prefix={<SearchOutlined />}
            value={sessionIdFilter}
            onChange={(e) => setSessionIdFilter(e.target.value)}
            style={{ width: 200 }}
            allowClear
          />
          <Select
            placeholder={t("Claw.Audit.filter.eventType")}
            value={eventTypeFilter || undefined}
            onChange={setEventTypeFilter}
            options={eventTypeOptions}
            style={{ width: 180 }}
            allowClear
          />
          <Button
            type={showOnlyBlocked ? "primary" : "default"}
            danger={showOnlyBlocked}
            onClick={() => setShowOnlyBlocked(!showOnlyBlocked)}
          >
            {t("Claw.Audit.filter.showBlockedOnly")}
          </Button>
          <Button icon={<ReloadOutlined />} onClick={loadAuditData}>
            {t("Claw.Common.refresh")}
          </Button>
          <Button
            type="primary"
            icon={<DownloadOutlined />}
            onClick={handleExport}
          >
            {t("Claw.Audit.export")}
          </Button>
        </Space>
      </Card>

      {/* 事件表格 */}
      <Card>
        <Spin spinning={loading}>
          {filteredEvents.length === 0 && !loading ? (
            <Empty description={t("Claw.Common.noData")} />
          ) : (
            <Table
              columns={columns}
              dataSource={filteredEvents}
              rowKey="id"
              pagination={{
                pageSize: 20,
                showSizeChanger: true,
                showTotal: (total) =>
                  t("Claw.Audit.pagination.total", { total }),
              }}
              size="small"
              scroll={{ x: 1200 }}
            />
          )}
        </Spin>
      </Card>
    </div>
  );
};

export default ComplianceAuditPage;
