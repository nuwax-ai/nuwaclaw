/**
 * 权限管理页面
 *
 * 功能：
 * - 显示关键系统权限状态
 * - 提供权限授权入口
 * - 自动检测权限状态变化
 */

import React, { useState, useEffect, useCallback, useRef } from "react";
import { Space, Card, Button, Tag, List, Alert, Avatar, message } from "antd";
import {
  ApiOutlined,
  FolderOutlined,
  SafetyOutlined,
  ReloadOutlined,
  SettingOutlined,
} from "@ant-design/icons";
import { Typography } from "antd";
import { listen } from "@tauri-apps/api/event";
import {
  PermissionItem,
  getPermissions,
  refreshPermissions,
  openSystemPreferences,
  openFullDiskAccessPanel,
} from "../services";

const { Title, Text } = Typography;

// 权限轮询间隔（毫秒）
const POLLING_INTERVAL = 2000;

/**
 * 权限管理页面组件
 */
export default function PermissionsPage() {
  // 权限列表
  const [permissions, setPermissions] = useState<PermissionItem[]>([]);
  // 加载状态
  const [permissionsLoading, setPermissionsLoading] = useState(false);
  // 是否正在等待授权（启动轮询）
  const [waitingForAuth, setWaitingForAuth] = useState(false);
  // 轮询定时器引用
  const pollingTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  // 上一次的权限状态（用于检测变化）
  const lastPermissionsRef = useRef<Map<string, string>>(new Map());

  // 关键权限列表（只显示需要系统授权的权限）
  const KEY_PERMISSIONS = ["accessibility", "screen_recording", "file_access"];

  // 过滤后的权限列表
  const filteredPermissions = permissions.filter((p) =>
    KEY_PERMISSIONS.includes(p.id),
  );

  /**
   * 加载权限数据
   */
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

  /**
   * 检测权限状态变化
   */
  const checkPermissionChanges = useCallback(async () => {
    try {
      const data = await getPermissions();
      const currentPermissions = data.items;

      // 检查是否有权限状态变化
      const changedPermissions: PermissionItem[] = [];

      for (const perm of currentPermissions) {
        const lastStatus = lastPermissionsRef.current.get(perm.id);
        if (lastStatus && lastStatus !== perm.status) {
          console.log(
            `[PermissionsPage] 权限状态变化: ${perm.id} ${lastStatus} -> ${perm.status}`,
          );
          changedPermissions.push(perm);
        }
        lastPermissionsRef.current.set(perm.id, perm.status);
      }

      // 更新权限列表
      setPermissions(currentPermissions);

      // 如果有权限变为已授权，显示提示
      const newlyGranted = changedPermissions.filter(
        (p) => p.status === "granted",
      );
      if (newlyGranted.length > 0) {
        message.success(
          `权限已授权: ${newlyGranted.map((p) => p.displayName).join(", ")}`,
        );
      }

      // 检查所有关键权限是否都已授权
      const keyPermissions = currentPermissions.filter((p) =>
        KEY_PERMISSIONS.includes(p.id),
      );
      const allGranted = keyPermissions.every((p) => p.status === "granted");

      if (allGranted && waitingForAuth) {
        message.success("所有关键权限已授权");
        stopPermissionPolling();
      }

      return changedPermissions;
    } catch (error) {
      console.error("[PermissionsPage] 检测权限变化失败:", error);
      return [];
    }
  }, [waitingForAuth]);

  /**
   * 启动权限状态轮询
   */
  const startPermissionPolling = useCallback(() => {
    if (pollingTimerRef.current) {
      return; // 已经在轮询中
    }

    console.log("[PermissionsPage] 启动权限状态轮询");
    setWaitingForAuth(true);

    // 记录当前权限状态作为基准
    permissions.forEach((p) => {
      lastPermissionsRef.current.set(p.id, p.status);
    });

    // 启动定时轮询
    pollingTimerRef.current = setInterval(() => {
      checkPermissionChanges();
    }, POLLING_INTERVAL);
  }, [permissions, checkPermissionChanges]);

  /**
   * 停止权限状态轮询
   */
  const stopPermissionPolling = useCallback(() => {
    if (pollingTimerRef.current) {
      console.log("[PermissionsPage] 停止权限状态轮询");
      clearInterval(pollingTimerRef.current);
      pollingTimerRef.current = null;
    }
    setWaitingForAuth(false);
  }, []);

  // 组件挂载时加载数据
  useEffect(() => {
    loadPermissions().then((items) => {
      // 初始化权限状态记录
      items.forEach((p) => {
        lastPermissionsRef.current.set(p.id, p.status);
      });
    });

    // 组件卸载时停止轮询
    return () => {
      stopPermissionPolling();
    };
  }, [loadPermissions, stopPermissionPolling]);

  // 监听应用焦点事件：获得焦点时检查权限变化
  useEffect(() => {
    let unlisten: (() => void) | undefined;

    const setupFocusListener = async () => {
      unlisten = await listen("tauri://focus", () => {
        console.log("[PermissionsPage] 应用获得焦点，检查权限状态");
        checkPermissionChanges();
      });
    };

    setupFocusListener();

    return () => {
      if (unlisten) {
        unlisten();
      }
    };
  }, [checkPermissionChanges]);

  /**
   * 刷新权限状态
   */
  const handleRefreshPermissions = async () => {
    message.loading("正在刷新权限状态...", 1);
    const data = await refreshPermissions();
    setPermissions(data.items);
    // 更新状态记录
    data.items.forEach((p) => {
      lastPermissionsRef.current.set(p.id, p.status);
    });
    message.success("权限状态已刷新");
  };

  /**
   * 打开完全磁盘访问权限面板（专用函数）
   */
  const handleOpenFullDiskAccessPanel = async () => {
    await openFullDiskAccessPanel();
    // 打开面板后启动轮询检测权限状态变化
    startPermissionPolling();
    message.info("请在系统设置中勾选本应用，完成后返回将自动更新状态");
  };

  /**
   * 打开系统偏好设置
   */
  const handleOpenSettings = async (permissionId: string) => {
    if (permissionId === "file_access") {
      // 文件访问权限使用专用面板
      await handleOpenFullDiskAccessPanel();
    } else {
      // 其他权限使用通用方法
      await openSystemPreferences(permissionId);
      // 启动轮询检测权限状态变化
      startPermissionPolling();
      message.info("请在系统设置中授权，完成后返回将自动更新状态");
    }
  };

  /**
   * 获取权限状态配置
   */
  const getStatusConfig = (status: string) => {
    const baseConfig: Record<string, { color: string; text: string }> = {
      granted: { color: "success", text: "已授权" },
      denied: { color: "error", text: "已拒绝" },
      pending: { color: "warning", text: "待授权" },
      unknown: { color: "default", text: "未知" },
    };
    return baseConfig[status] || baseConfig.unknown;
  };

  /**
   * 获取权限图标
   */
  const getPermissionIcon = (permissionId: string) => {
    switch (permissionId) {
      case "accessibility":
        return <ApiOutlined />;
      case "screen_recording":
        return <SafetyOutlined />;
      case "file_access":
        return <FolderOutlined />;
      default:
        return <SafetyOutlined />;
    }
  };

  // 计算权限统计（只统计关键权限）
  const grantedCount = filteredPermissions.filter(
    (p) => p.status === "granted",
  ).length;
  const totalCount = filteredPermissions.length;
  const allGranted = grantedCount === totalCount && totalCount > 0;

  // 未授权的权限
  const ungrantedPermissions = filteredPermissions.filter(
    (p) => p.status !== "granted",
  );

  return (
    <div style={{ maxWidth: 900 }}>
      {/* 标题栏 */}
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginBottom: 16,
        }}
      >
        <Title level={4} style={{ margin: 0 }}>
          系统权限
        </Title>
        <Space>
          <Button
            icon={<ReloadOutlined />}
            onClick={handleRefreshPermissions}
            loading={permissionsLoading}
          >
            刷新状态
          </Button>
        </Space>
      </div>

      {/* 权限状态摘要 */}
      <Alert
        message={allGranted ? "权限正常" : "需要授权"}
        description={
          allGranted
            ? "所有关键权限已授权，客户端可正常工作"
            : `已授权 ${grantedCount}/${totalCount} 个关键权限`
        }
        type={allGranted ? "success" : "warning"}
        showIcon
        style={{ marginBottom: 16 }}
      />

      {/* 权限列表 */}
      <Card title="关键权限">
        <List
          loading={permissionsLoading}
          dataSource={filteredPermissions}
          renderItem={(item) => {
            const statusConfig = getStatusConfig(item.status);
            const isGranted = item.status === "granted";

            return (
              <List.Item
                style={{
                  background: !isGranted ? "#fffbe6" : undefined,
                  borderRadius: 8,
                  marginBottom: 8,
                  padding: "12px 16px",
                }}
                actions={[
                  <Tag color={statusConfig.color}>{statusConfig.text}</Tag>,
                  !isGranted && (
                    <Button
                      type="primary"
                      size="small"
                      icon={<SettingOutlined />}
                      onClick={() => handleOpenSettings(item.id)}
                    >
                      前往授权
                    </Button>
                  ),
                ].filter(Boolean)}
              >
                <List.Item.Meta
                  avatar={
                    <Avatar
                      icon={getPermissionIcon(item.id)}
                      style={{
                        backgroundColor: isGranted ? "#52c41a" : "#faad14",
                      }}
                    />
                  }
                  title={
                    <Space>
                      <span>{item.displayName}</span>
                      <Tag color="blue">必需</Tag>
                    </Space>
                  }
                  description={<Text type="secondary">{item.description}</Text>}
                />
              </List.Item>
            );
          }}
        />
      </Card>

      {/* 只在有未授权权限时显示简要提示 */}
      {ungrantedPermissions.length > 0 && (
        <Alert
          message="点击「前往授权」按钮后，完成授权并返回本应用，权限状态将自动更新"
          type="info"
          style={{ marginTop: 16 }}
        />
      )}
    </div>
  );
}
