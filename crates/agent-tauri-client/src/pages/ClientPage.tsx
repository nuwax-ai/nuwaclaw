/**
 * 客户端页面
 *
 * 功能：
 * - 显示所有服务状态
 * - 启动/停止服务
 * - 显示连接信息
 * - 快速操作入口
 */

import React, { useState, useEffect, useCallback } from "react";
import { Button, Tag, Alert, Spin, message } from "antd";
import {
  PlayCircleOutlined,
  StopOutlined,
  ReloadOutlined,
  CheckCircleOutlined,
  CloseCircleOutlined,
  LoadingOutlined,
} from "@ant-design/icons";
import { Typography } from "antd";
import { AgentStatus, LogEntry } from "../services";
import {
  getServicesStatus,
  restartAllServices,
  stopAllServices,
  checkAllSetupDependencies,
  ServiceInfo,
  SERVICE_DISPLAY_NAMES,
  LocalDependencyItem,
} from "../services/dependencies";
import LoginForm from "../components/LoginForm";
import { SERVICE_STATE_NAMES, SERVICE_DESCRIPTIONS } from "../constants";

const { Text } = Typography;

// 连接信息类型
interface ConnectionInfo {
  id: string;
  server: string;
}

// Tab 类型
type TabType =
  | "client"
  | "settings"
  | "dependencies"
  | "permissions"
  | "logs"
  | "about";

interface ClientPageProps {
  status: AgentStatus;
  sessionId: string;
  onlineStatus: boolean | null;
  logs: LogEntry[];
  connectionInfo: ConnectionInfo;
  badge: {
    status: "success" | "processing" | "error" | "default" | "warning";
    text: string;
  };
  loading: boolean;
  onStart: () => void;
  onStop: () => void;
  onNavigate?: (tab: TabType) => void;
}

export default function ClientPage({
  status,
  sessionId,
  onlineStatus,
  logs,
  connectionInfo,
  badge,
  loading,
  onStart,
  onStop,
  onNavigate,
}: ClientPageProps) {
  const [services, setServices] = useState<ServiceInfo[]>([]);
  const [servicesLoading, setServicesLoading] = useState(false);
  const [servicesOperating, setServicesOperating] = useState(false);
  const [missingDeps, setMissingDeps] = useState<LocalDependencyItem[]>([]);
  const [depsChecked, setDepsChecked] = useState(false);

  const loadServicesStatus = useCallback(async () => {
    setServicesLoading(true);
    try {
      const result = await getServicesStatus();
      setServices(result);
    } catch (error) {
      console.error("[ClientPage] 获取服务状态失败:", error);
    } finally {
      setServicesLoading(false);
    }
  }, []);

  const checkDependencies = useCallback(async () => {
    try {
      const deps = await checkAllSetupDependencies();
      const missing = deps.filter(
        (d) =>
          d.required &&
          (d.status === "missing" ||
            d.status === "outdated" ||
            d.status === "error"),
      );
      setMissingDeps(missing);
      setDepsChecked(true);
    } catch (error) {
      console.error("[ClientPage] 检测依赖状态失败:", error);
      setDepsChecked(true);
    }
  }, []);

  useEffect(() => {
    loadServicesStatus();
    checkDependencies();
    const interval = setInterval(loadServicesStatus, 5000);
    return () => clearInterval(interval);
  }, [loadServicesStatus, checkDependencies]);

  const handleStartServices = async () => {
    setServicesOperating(true);
    try {
      await restartAllServices();
      await loadServicesStatus();
      message.success("服务启动成功");
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      message.error(`启动失败: ${errorMessage}`);
    } finally {
      setServicesOperating(false);
    }
  };

  const handleStopServices = async () => {
    setServicesOperating(true);
    try {
      await stopAllServices();
      await loadServicesStatus();
      message.success("服务已停止");
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      message.error(`停止失败: ${errorMessage}`);
    } finally {
      setServicesOperating(false);
    }
  };

  const runningCount = services.filter((s) => s.state === "Running").length;
  const totalCount = services.length;
  const allRunning = totalCount > 0 && runningCount === totalCount;
  const allStopped = totalCount > 0 && runningCount === 0;

  const getStateIcon = (state: string) => {
    switch (state) {
      case "Running":
        return (
          <CheckCircleOutlined style={{ color: "#16a34a", fontSize: 12 }} />
        );
      case "Stopped":
        return (
          <CloseCircleOutlined style={{ color: "#a1a1aa", fontSize: 12 }} />
        );
      case "Starting":
      case "Stopping":
        return <LoadingOutlined style={{ color: "#71717a", fontSize: 12 }} />;
      default:
        return (
          <CloseCircleOutlined style={{ color: "#a1a1aa", fontSize: 12 }} />
        );
    }
  };

  const getStateText = (state: string) => {
    return (
      SERVICE_STATE_NAMES[state as keyof typeof SERVICE_STATE_NAMES] || state
    );
  };

  const SERVICE_DESC: Record<string, string> = {
    Rcoder: SERVICE_DESCRIPTIONS.Rcoder,
    NuwaxFileServer: SERVICE_DESCRIPTIONS.NuwaxFileServer,
    NuwaxLanproxy: SERVICE_DESCRIPTIONS.NuwaxLanproxy,
    McpProxy: SERVICE_DESCRIPTIONS.McpProxy,
  };

  return (
    <div>
      {/* 登录 */}
      <LoginForm onLoginSuccess={() => {}} isServiceRunning={allRunning} />

      {/* 服务状态 */}
      <div className="section">
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            marginBottom: 12,
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ fontSize: 13, fontWeight: 500, color: "#18181b" }}>
              服务
            </span>
            <Tag
              color={
                allRunning ? "success" : allStopped ? "default" : "warning"
              }
            >
              {runningCount}/{totalCount}
            </Tag>
          </div>
          <div style={{ display: "flex", gap: 6 }}>
            <Button
              size="small"
              icon={<ReloadOutlined spin={servicesLoading} />}
              onClick={loadServicesStatus}
              disabled={servicesLoading}
            >
              刷新
            </Button>
            {allStopped ? (
              <Button
                size="small"
                type="primary"
                icon={<PlayCircleOutlined />}
                onClick={handleStartServices}
                loading={servicesOperating}
                disabled={!depsChecked || missingDeps.length > 0}
              >
                启动全部
              </Button>
            ) : (
              <Button
                size="small"
                danger
                icon={<StopOutlined />}
                onClick={handleStopServices}
                loading={servicesOperating}
              >
                停止全部
              </Button>
            )}
          </div>
        </div>

        {servicesLoading && services.length === 0 ? (
          <div style={{ textAlign: "center", padding: 24 }}>
            <Spin size="small" />
          </div>
        ) : services.length === 0 ? (
          <Alert message="未检测到服务，请先完成初始化配置" type="info" />
        ) : (
          <div
            style={{
              border: "1px solid #e4e4e7",
              borderRadius: 8,
              overflow: "hidden",
              background: "#fff",
            }}
          >
            {services.map((service, i) => (
              <div
                key={service.serviceType}
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  padding: "10px 14px",
                  borderBottom:
                    i < services.length - 1 ? "1px solid #f4f4f5" : "none",
                }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  {getStateIcon(service.state)}
                  <div>
                    <div
                      style={{
                        fontSize: 13,
                        fontWeight: 500,
                        color: "#18181b",
                      }}
                    >
                      {SERVICE_DISPLAY_NAMES[service.serviceType] ||
                        service.serviceType}
                    </div>
                    <div style={{ fontSize: 11, color: "#a1a1aa" }}>
                      {SERVICE_DESC[service.serviceType] || ""}
                    </div>
                  </div>
                </div>
                <span
                  style={{
                    fontSize: 12,
                    color: service.state === "Running" ? "#16a34a" : "#a1a1aa",
                  }}
                >
                  {getStateText(service.state)}
                </span>
              </div>
            ))}
          </div>
        )}

        {allStopped && services.length > 0 && missingDeps.length > 0 && (
          <Alert
            message="缺少必需依赖，无法启动服务"
            description={
              <div>
                <div style={{ marginBottom: 8 }}>
                  {missingDeps.map((dep) => (
                    <Tag
                      key={dep.name}
                      color="error"
                      style={{ marginBottom: 4 }}
                    >
                      {dep.displayName}
                    </Tag>
                  ))}
                </div>
                <Button
                  size="small"
                  type="primary"
                  onClick={() => onNavigate?.("dependencies")}
                >
                  前往安装
                </Button>
              </div>
            }
            type="error"
            style={{ marginTop: 12 }}
          />
        )}

        {allRunning && (
          <div
            style={{
              marginTop: 8,
              fontSize: 12,
              color: "#16a34a",
              display: "flex",
              alignItems: "center",
              gap: 4,
            }}
          >
            <CheckCircleOutlined />
            所有服务运行正常
          </div>
        )}
      </div>

      {/* 快捷操作 */}
      <div style={{ marginTop: 20, display: "flex", gap: 8, flexWrap: "wrap" }}>
        <Button size="small" onClick={() => onNavigate?.("settings")}>
          设置
        </Button>
        <Button size="small" onClick={() => onNavigate?.("dependencies")}>
          依赖
        </Button>
        <Button size="small" onClick={() => onNavigate?.("about")}>
          关于
        </Button>
      </div>
    </div>
  );
}
