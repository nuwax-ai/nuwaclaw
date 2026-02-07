/**
 * 权限管理页面
 */

import React, { useState, useEffect, useCallback, useRef } from "react";
import { Button, Tag, Alert, message } from "antd";
import {
  ApiOutlined,
  FolderOutlined,
  SafetyOutlined,
  ReloadOutlined,
  SettingOutlined,
  CheckCircleOutlined,
  ExclamationCircleOutlined,
} from "@ant-design/icons";
import { listen } from "@tauri-apps/api/event";
import {
  PermissionItem,
  getPermissions,
  refreshPermissions,
  openSystemPreferences,
  openFullDiskAccessPanel,
} from "../services";

const POLLING_INTERVAL = 2000;

export default function PermissionsPage() {
  const [permissions, setPermissions] = useState<PermissionItem[]>([]);
  const [permissionsLoading, setPermissionsLoading] = useState(false);
  const [waitingForAuth, setWaitingForAuth] = useState(false);
  const pollingTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const lastPermissionsRef = useRef<Map<string, string>>(new Map());

  const KEY_PERMISSIONS = ["accessibility", "screen_recording", "file_access"];
  const filteredPermissions = permissions.filter((p) =>
    KEY_PERMISSIONS.includes(p.id),
  );

  const loadPermissions = useCallback(async () => {
    setPermissionsLoading(true);
    try {
      const data = await getPermissions();
      setPermissions(data.items);
      return data.items;
    } catch (error) {
      message.error("加载权限数据失败");
      return [];
    } finally {
      setPermissionsLoading(false);
    }
  }, []);

  const checkPermissionChanges = useCallback(async () => {
    try {
      const data = await getPermissions();
      const currentPermissions = data.items;

      for (const perm of currentPermissions) {
        lastPermissionsRef.current.set(perm.id, perm.status);
      }

      setPermissions(currentPermissions);

      const keyPermissions = currentPermissions.filter((p) =>
        KEY_PERMISSIONS.includes(p.id),
      );
      const allGranted = keyPermissions.every((p) => p.status === "granted");

      if (allGranted && waitingForAuth) {
        message.success("所有关键权限已授权");
        stopPermissionPolling();
      }
    } catch (error) {
      console.error("[PermissionsPage] 检测权限变化失败:", error);
    }
  }, [waitingForAuth]);

  const startPermissionPolling = useCallback(() => {
    if (pollingTimerRef.current) return;
    setWaitingForAuth(true);
    permissions.forEach((p) => {
      lastPermissionsRef.current.set(p.id, p.status);
    });
    pollingTimerRef.current = setInterval(() => {
      checkPermissionChanges();
    }, POLLING_INTERVAL);
  }, [permissions, checkPermissionChanges]);

  const stopPermissionPolling = useCallback(() => {
    if (pollingTimerRef.current) {
      clearInterval(pollingTimerRef.current);
      pollingTimerRef.current = null;
    }
    setWaitingForAuth(false);
  }, []);

  useEffect(() => {
    loadPermissions().then((items) => {
      items.forEach((p) => {
        lastPermissionsRef.current.set(p.id, p.status);
      });
    });
    return () => stopPermissionPolling();
  }, [loadPermissions, stopPermissionPolling]);

  useEffect(() => {
    let unlisten: (() => void) | undefined;
    const setup = async () => {
      unlisten = await listen("tauri://focus", () => {
        checkPermissionChanges();
      });
    };
    setup();
    return () => {
      if (unlisten) unlisten();
    };
  }, [checkPermissionChanges]);

  const handleRefresh = async () => {
    const data = await refreshPermissions();
    setPermissions(data.items);
    data.items.forEach((p) => {
      lastPermissionsRef.current.set(p.id, p.status);
    });
  };

  const handleOpenSettings = async (permissionId: string) => {
    if (permissionId === "file_access") {
      await openFullDiskAccessPanel();
    } else {
      await openSystemPreferences(permissionId);
    }
    startPermissionPolling();
  };

  const getIcon = (id: string) => {
    switch (id) {
      case "accessibility":
        return <ApiOutlined style={{ fontSize: 12 }} />;
      case "screen_recording":
        return <SafetyOutlined style={{ fontSize: 12 }} />;
      case "file_access":
        return <FolderOutlined style={{ fontSize: 12 }} />;
      default:
        return <SafetyOutlined style={{ fontSize: 12 }} />;
    }
  };

  const grantedCount = filteredPermissions.filter(
    (p) => p.status === "granted",
  ).length;
  const totalCount = filteredPermissions.length;
  const allGranted = grantedCount === totalCount && totalCount > 0;

  return (
    <div>
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
            系统权限
          </span>
          <Tag color={allGranted ? "success" : "warning"}>
            {grantedCount}/{totalCount}
          </Tag>
        </div>
        <Button
          size="small"
          icon={<ReloadOutlined />}
          onClick={handleRefresh}
          loading={permissionsLoading}
        >
          刷新
        </Button>
      </div>

      {allGranted && (
        <div
          style={{
            fontSize: 12,
            color: "#16a34a",
            display: "flex",
            alignItems: "center",
            gap: 4,
            marginBottom: 12,
          }}
        >
          <CheckCircleOutlined />
          所有关键权限已授权
        </div>
      )}

      <div
        style={{
          border: "1px solid #e4e4e7",
          borderRadius: 8,
          background: "#fff",
          overflow: "hidden",
        }}
      >
        {filteredPermissions.map((item, i) => {
          const isGranted = item.status === "granted";
          return (
            <div
              key={item.id}
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                padding: "12px 14px",
                borderBottom:
                  i < filteredPermissions.length - 1
                    ? "1px solid #f4f4f5"
                    : "none",
                background: !isGranted ? "#fffbeb" : undefined,
              }}
            >
              <div
                style={{ display: "flex", alignItems: "flex-start", gap: 10 }}
              >
                <div
                  style={{
                    width: 28,
                    height: 28,
                    borderRadius: 6,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    background: isGranted ? "#f0fdf4" : "#fef3c7",
                    color: isGranted ? "#16a34a" : "#ca8a04",
                    flexShrink: 0,
                    marginTop: 1,
                  }}
                >
                  {getIcon(item.id)}
                </div>
                <div>
                  <div
                    style={{ fontSize: 13, fontWeight: 500, color: "#18181b" }}
                  >
                    {item.displayName}
                  </div>
                  <div style={{ fontSize: 11, color: "#a1a1aa", marginTop: 1 }}>
                    {item.description}
                  </div>
                </div>
              </div>

              <div style={{ flexShrink: 0, marginLeft: 12 }}>
                {isGranted ? (
                  <span style={{ fontSize: 12, color: "#16a34a" }}>已授权</span>
                ) : (
                  <Button
                    size="small"
                    type="primary"
                    icon={<SettingOutlined />}
                    onClick={() => handleOpenSettings(item.id)}
                  >
                    授权
                  </Button>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {!allGranted && (
        <div style={{ marginTop: 10, fontSize: 12, color: "#a1a1aa" }}>
          点击「授权」后完成系统设置，返回应用后状态将自动更新
        </div>
      )}
    </div>
  );
}
