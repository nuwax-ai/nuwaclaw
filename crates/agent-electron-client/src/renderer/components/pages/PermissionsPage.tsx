/**
 * PermissionsPage - 系统授权页面 (Electron 版, 仅 macOS)
 *
 * 从 Tauri 客户端 PermissionsPage 简化移植：
 * - 权限列表：全磁盘访问、辅助功能、屏幕录制
 * - 每项显示状态（已授权/未授权）
 * - "前往设置"按钮
 */

import React, { useState, useEffect, useCallback, useRef } from "react";
import { Button, Tag, Spin, message } from "antd";
import {
  CheckCircleOutlined,
  CloseCircleOutlined,
  QuestionCircleOutlined,
  ReloadOutlined,
  SettingOutlined,
} from "@ant-design/icons";
import styles from "../../styles/components/ClientPage.module.css";

interface PermissionItem {
  key: string;
  name: string;
  description: string;
  status: "granted" | "denied" | "unknown";
}

const STATUS_ICON: Record<string, React.ReactNode> = {
  granted: (
    <CheckCircleOutlined
      style={{ color: "var(--color-success)", fontSize: 16 }}
    />
  ),
  denied: (
    <CloseCircleOutlined
      style={{ color: "var(--color-error)", fontSize: 16 }}
    />
  ),
  unknown: (
    <QuestionCircleOutlined
      style={{ color: "var(--color-text-secondary)", fontSize: 16 }}
    />
  ),
};

const STATUS_TAG: Record<string, { color: string; text: string }> = {
  granted: { color: "green", text: "已授权" },
  denied: { color: "red", text: "未授权" },
  unknown: { color: "default", text: "未知" },
};

export default function PermissionsPage() {
  const [permissions, setPermissions] = useState<PermissionItem[]>([]);
  const [loading, setLoading] = useState(true);
  const pollTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const pollTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearPollTimers = useCallback(() => {
    if (pollTimerRef.current) {
      clearInterval(pollTimerRef.current);
      pollTimerRef.current = null;
    }
    if (pollTimeoutRef.current) {
      clearTimeout(pollTimeoutRef.current);
      pollTimeoutRef.current = null;
    }
  }, []);

  const checkPermissions = useCallback(async () => {
    try {
      const result = await window.electronAPI?.permissions?.check();
      if (result) {
        setPermissions(result);
      }
    } catch (error) {
      console.error("[PermissionsPage] Check failed:", error);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    checkPermissions();
    return clearPollTimers;
  }, [checkPermissions, clearPollTimers]);

  const handleOpenSettings = async (key: string) => {
    try {
      await window.electronAPI?.permissions?.openSettings(key);
      // Poll for changes after user opens settings
      clearPollTimers();
      pollTimerRef.current = setInterval(async () => {
        await checkPermissions();
      }, 2000);
      pollTimeoutRef.current = setTimeout(() => {
        if (pollTimerRef.current) {
          clearInterval(pollTimerRef.current);
          pollTimerRef.current = null;
        }
      }, 30000);
    } catch {
      message.error("无法打开系统设置");
    }
  };

  const handleRefresh = () => {
    setLoading(true);
    checkPermissions();
  };

  const grantedCount = permissions.filter((p) => p.status === "granted").length;
  const totalCount = permissions.length;

  if (loading && permissions.length === 0) {
    return (
      <div className={styles.page}>
        <div style={{ textAlign: "center", padding: 40 }}>
          <Spin size="small" />
        </div>
      </div>
    );
  }

  return (
    <div className={styles.page}>
      {/* Header */}
      <div className={styles.section}>
        <div className={styles.servicesHeader}>
          <div className={styles.servicesHeaderLeft}>
            <span className={styles.sectionTitle}>系统授权</span>
            {totalCount > 0 && (
              <Tag color={grantedCount === totalCount ? "green" : "orange"}>
                {grantedCount}/{totalCount}
              </Tag>
            )}
            <span
              className={styles.sectionDescription}
              style={{ marginTop: 0, marginLeft: 12 }}
            >
              以下权限可能影响应用的正常运行，请根据需要授权
            </span>
          </div>
          <Button
            size="small"
            icon={<ReloadOutlined />}
            onClick={handleRefresh}
            loading={loading}
          >
            刷新
          </Button>
        </div>

        {/* Permission list */}
        <div className={styles.sectionBody} style={{ padding: "0 16px" }}>
          {permissions.map((perm) => (
            <div key={perm.key} className={styles.serviceRow}>
              <div className={styles.serviceInfo}>
                {STATUS_ICON[perm.status]}
                <div>
                  <span className={styles.serviceLabel}>{perm.name}</span>
                  <div className={styles.serviceDescription}>
                    {perm.description}
                  </div>
                </div>
              </div>

              <div className={styles.serviceActions}>
                <Tag
                  color={STATUS_TAG[perm.status]?.color || "default"}
                  style={{ margin: 0, fontSize: 11 }}
                >
                  {STATUS_TAG[perm.status]?.text || "未知"}
                </Tag>
                {perm.status !== "granted" && (
                  <Button
                    size="small"
                    icon={<SettingOutlined />}
                    onClick={() => handleOpenSettings(perm.key)}
                  >
                    前往设置
                  </Button>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>

      {grantedCount === totalCount && totalCount > 0 && (
        <div
          style={{
            padding: "10px 14px",
            background: "var(--color-bg-section)",
            border: "1px solid var(--color-border)",
            borderRadius: "var(--border-radius-lg)",
            fontSize: 12,
            color: "var(--color-success)",
            display: "flex",
            alignItems: "center",
            gap: 6,
          }}
        >
          <CheckCircleOutlined />
          所有权限已授权
        </div>
      )}
    </div>
  );
}
