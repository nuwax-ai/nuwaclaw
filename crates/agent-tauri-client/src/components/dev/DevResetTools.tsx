/**
 * 开发工具 - 重置工具
 *
 * 功能：
 * - 重置初始化状态（进入向导）
 * - 清除登录状态
 * - 清除所有缓存数据
 * - 测试系统级 Node.js 安装
 *
 * 注意：此组件仅在开发环境下加载
 */

import React, { useState } from "react";
import {
  Card,
  Space,
  Button,
  List,
  Modal,
  message,
  Tag,
  Typography,
} from "antd";
import {
  ReloadOutlined,
  DeleteOutlined,
  ExclamationCircleOutlined,
  ClearOutlined,
  UserDeleteOutlined,
  UndoOutlined,
  DownloadOutlined,
} from "@ant-design/icons";
import { resetSetup } from "../../services/setup";
import { clearAuthInfo } from "../../services/auth";
import { systemInstallNode } from "../../services/dependencies";

const { Text } = Typography;

/**
 * 重置工具项配置
 */
interface ResetTool {
  key: string;
  title: string;
  description: string;
  icon: React.ReactNode;
  action: () => Promise<void>;
  danger?: boolean;
  requireReload?: boolean;
}

/**
 * 开发重置工具组件
 */
export default function DevResetTools() {
  const [loading, setLoading] = useState<string | null>(null);

  /**
   * 重置初始化状态
   * 清除 setup_completed 标记，刷新后进入初始化向导
   */
  const handleResetSetup = async () => {
    await resetSetup();
    message.success("初始化状态已重置");
  };

  /**
   * 清除登录状态
   * 清除用户名、密码、configKey 等认证信息
   */
  const handleClearAuth = async () => {
    await clearAuthInfo();
    message.success("登录状态已清除");
  };

  /**
   * 清除所有数据并重载
   * 重置初始化 + 清除登录 + 刷新页面
   */
  const handleClearAll = async () => {
    await resetSetup();
    await clearAuthInfo();
    message.success("所有数据已清除，正在刷新...");
    setTimeout(() => {
      window.location.reload();
    }, 500);
  };

  /**
   * 测试系统级 Node.js 安装
   * 从内置安装包（MSI/PKG）安装到系统全局
   */
  const handleTestSystemInstallNode = async () => {
    try {
      const result = await systemInstallNode();

      if (result.success) {
        let msg = `Node.js v${result.version} 安装成功！`;
        if (result.needsRestart) {
          msg += " 请重启应用以使用新安装的 Node.js。";
        }
        message.success(msg);
        console.log("[DevTools] Node.js 安装详情:", result);
      } else {
        message.error(`Node.js 安装失败: ${result.error || "未知错误"}`);
        console.error("[DevTools] Node.js 安装失败:", result);
      }
    } catch (error) {
      message.error(`Node.js 安装异常: ${error}`);
      console.error("[DevTools] Node.js 安装异常:", error);
    }
  };

  /**
   * 重置工具列表
   */
  const tools: ResetTool[] = [
    {
      key: "reset-setup",
      title: "重置初始化",
      description: "清除初始化完成标记，刷新后进入配置向导",
      icon: <UndoOutlined />,
      action: handleResetSetup,
      requireReload: true,
    },
    {
      key: "clear-auth",
      title: "清除登录",
      description: "清除用户名、密码、ConfigKey 等认证信息",
      icon: <UserDeleteOutlined />,
      action: handleClearAuth,
    },
    {
      key: "clear-all",
      title: "清除全部并刷新",
      description: "重置初始化状态 + 清除登录信息，然后刷新页面",
      icon: <ClearOutlined />,
      action: handleClearAll,
      danger: true,
    },
    {
      key: "test-system-install-node",
      title: "测试系统级安装 Node.js",
      description: "从内置安装包（MSI/PKG）安装到系统全局（macOS/Linux 需要管理员权限）",
      icon: <DownloadOutlined />,
      action: handleTestSystemInstallNode,
      requireReload: false,
    },
  ];

  /**
   * 执行重置操作
   */
  const handleExecute = async (tool: ResetTool) => {
    // 危险操作需要确认
    if (tool.danger) {
      Modal.confirm({
        title: "确认操作",
        icon: <ExclamationCircleOutlined />,
        content: `确定要执行"${tool.title}"吗？此操作不可撤销。`,
        okText: "确定",
        okType: "danger",
        cancelText: "取消",
        onOk: async () => {
          setLoading(tool.key);
          try {
            await tool.action();
          } catch (error) {
            console.error(`[DevResetTools] ${tool.title} 失败:`, error);
            message.error(`${tool.title}失败: ${error}`);
          } finally {
            setLoading(null);
          }
        },
      });
      return;
    }

    // 普通操作直接执行
    setLoading(tool.key);
    try {
      await tool.action();
      if (tool.requireReload) {
        message.info("刷新页面后生效");
      }
    } catch (error) {
      console.error(`[DevResetTools] ${tool.title} 失败:`, error);
      message.error(`${tool.title}失败: ${error}`);
    } finally {
      setLoading(null);
    }
  };

  return (
    <Card
      size="small"
      title={
        <Space>
          <DeleteOutlined />
          <span>重置工具</span>
        </Space>
      }
      extra={
        <Button
          size="small"
          icon={<ReloadOutlined />}
          onClick={() => window.location.reload()}
        >
          刷新页面
        </Button>
      }
    >
      <List
        size="small"
        dataSource={tools}
        renderItem={(tool) => (
          <List.Item
            actions={[
              <Button
                size="small"
                danger={tool.danger}
                loading={loading === tool.key}
                onClick={() => handleExecute(tool)}
              >
                执行
              </Button>,
            ]}
          >
            <List.Item.Meta
              avatar={tool.icon}
              title={
                <Space>
                  <span>{tool.title}</span>
                  {tool.danger && <Tag color="red">危险</Tag>}
                  {tool.requireReload && <Tag color="blue">需刷新</Tag>}
                </Space>
              }
              description={
                <Text type="secondary" style={{ fontSize: 12 }}>
                  {tool.description}
                </Text>
              }
            />
          </List.Item>
        )}
      />
    </Card>
  );
}
