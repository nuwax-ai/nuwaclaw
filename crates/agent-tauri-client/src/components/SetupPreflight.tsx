/**
 * 环境预检组件
 * 在向导开始前检查端口、目录、依赖等基本环境条件
 */

import React, { useState, useEffect, useCallback } from "react";
import { Button, Typography, Tag, Spin, Alert } from "antd";
import {
  CheckCircleOutlined,
  CloseCircleOutlined,
  WarningOutlined,
  ReloadOutlined,
} from "@ant-design/icons";
import { invoke } from "@tauri-apps/api/core";

const { Text } = Typography;

interface PreflightCheck {
  id: string;
  name: string;
  category: string;
  status: "Pass" | "Warn" | "Fail";
  message: string;
  fix_hint: string | null;
  auto_fixable: boolean;
}

interface PreflightResult {
  passed: boolean;
  checks: PreflightCheck[];
}

interface FixResult {
  check_id: string;
  success: boolean;
  message: string;
}

interface SetupPreflightProps {
  onComplete: () => void;
}

export default function SetupPreflight({ onComplete }: SetupPreflightProps) {
  const [loading, setLoading] = useState(true);
  const [fixing, setFixing] = useState(false);
  const [result, setResult] = useState<PreflightResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const runCheck = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await invoke<PreflightResult>("preflight_check");
      setResult(res);
    } catch (err) {
      console.error("[Preflight] 预检失败:", err);
      setError(String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    runCheck();
  }, [runCheck]);

  const handleFix = useCallback(async () => {
    if (!result) return;
    const fixableIds = result.checks
      .filter((c) => c.auto_fixable && c.status === "Fail")
      .map((c) => c.id);
    if (fixableIds.length === 0) return;

    setFixing(true);
    try {
      await invoke<FixResult[]>("preflight_fix", { checkIds: fixableIds });
      await runCheck();
    } catch (err) {
      console.error("[Preflight] 修复失败:", err);
    } finally {
      setFixing(false);
    }
  }, [result, runCheck]);

  const statusIcon = (status: string) => {
    switch (status) {
      case "Pass":
        return <CheckCircleOutlined style={{ color: "#16a34a" }} />;
      case "Warn":
        return <WarningOutlined style={{ color: "#d97706" }} />;
      case "Fail":
        return <CloseCircleOutlined style={{ color: "#dc2626" }} />;
      default:
        return null;
    }
  };

  const statusColor = (status: string): string => {
    switch (status) {
      case "Pass":
        return "success";
      case "Warn":
        return "warning";
      case "Fail":
        return "error";
      default:
        return "default";
    }
  };

  const categoryLabel = (cat: string): string => {
    switch (cat) {
      case "Network":
        return "网络";
      case "Directory":
        return "目录";
      case "Dependency":
        return "依赖";
      case "Permission":
        return "权限";
      default:
        return cat;
    }
  };

  if (loading) {
    return (
      <div style={{ textAlign: "center", padding: 40 }}>
        <Spin size="default" />
        <div style={{ marginTop: 12, color: "#71717a", fontSize: 13 }}>
          正在检查运行环境...
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div>
        <Alert
          type="error"
          message="环境预检失败"
          description={error}
          showIcon
          style={{ marginBottom: 16 }}
        />
        <Button icon={<ReloadOutlined />} onClick={runCheck}>
          重新检查
        </Button>
      </div>
    );
  }

  if (!result) return null;

  const failCount = result.checks.filter((c) => c.status === "Fail").length;
  const warnCount = result.checks.filter((c) => c.status === "Warn").length;
  const hasFixable = result.checks.some(
    (c) => c.auto_fixable && c.status === "Fail",
  );

  return (
    <div>
      <div style={{ marginBottom: 16 }}>
        <Text strong style={{ fontSize: 14 }}>
          环境预检
        </Text>
        <div style={{ color: "#71717a", fontSize: 12, marginTop: 2 }}>
          {result.passed
            ? "所有检查已通过，可以继续安装"
            : `发现 ${failCount} 个问题${warnCount > 0 ? `、${warnCount} 个警告` : ""}`}
        </div>
      </div>

      <div style={{ marginBottom: 16 }}>
        {result.checks.map((check) => (
          <div
            key={check.id}
            style={{
              display: "flex",
              alignItems: "flex-start",
              gap: 8,
              padding: "8px 0",
              borderBottom: "1px solid #f4f4f5",
            }}
          >
            <div style={{ marginTop: 2 }}>{statusIcon(check.status)}</div>
            <div style={{ flex: 1 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <Text style={{ fontSize: 13 }}>{check.name}</Text>
                <Tag
                  color={statusColor(check.status)}
                  style={{ fontSize: 10, lineHeight: "16px", padding: "0 4px" }}
                >
                  {categoryLabel(check.category)}
                </Tag>
              </div>
              <div style={{ color: "#71717a", fontSize: 12, marginTop: 2 }}>
                {check.message}
              </div>
              {check.fix_hint && check.status !== "Pass" && (
                <div style={{ color: "#d97706", fontSize: 11, marginTop: 2 }}>
                  {check.fix_hint}
                </div>
              )}
            </div>
          </div>
        ))}
      </div>

      <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
        <Button icon={<ReloadOutlined />} onClick={runCheck} disabled={fixing}>
          重新检查
        </Button>
        {hasFixable && (
          <Button onClick={handleFix} loading={fixing}>
            自动修复
          </Button>
        )}
        <Button type="primary" onClick={onComplete}>
          {result.passed ? "继续" : "跳过并继续"}
        </Button>
      </div>
    </div>
  );
}
