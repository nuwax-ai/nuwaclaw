/**
 * 开发工具 - 场景配置管理
 *
 * 功能：
 * - 查看/切换部署环境
 * - 添加/编辑/删除自定义配置
 * - 重置为默认配置
 *
 * 注意：此组件仅在开发环境下加载
 */

import React, { useState, useEffect, useCallback } from "react";
import {
  Card,
  Space,
  Button,
  List,
  Tag,
  Avatar,
  Modal,
  message,
  Spin,
} from "antd";
import { Typography } from "antd";
import {
  CloudServerOutlined,
  EnvironmentOutlined,
  RedoOutlined,
  PlusOutlined,
} from "@ant-design/icons";
import {
  initConfigStore,
  getAllScenes,
  getCurrentScene,
  switchScene,
  deleteCustomScene,
  resetConfig,
  SceneConfig,
} from "../../services/config";
import { syncConfigToServer } from "../../services";
import DevConfigEditor from "./DevConfigEditor";

const { Text } = Typography;

/**
 * 开发场景管理组件
 */
export default function DevSceneManager() {
  // 场景配置状态
  const [scenes, setScenes] = useState<SceneConfig[]>([]);
  const [currentScene, setCurrentScene] = useState<SceneConfig | null>(null);
  const [loading, setLoading] = useState(true);

  // 配置编辑器状态
  const [configEditorVisible, setConfigEditorVisible] = useState(false);
  const [editingScene, setEditingScene] = useState<SceneConfig | null>(null);
  const [isNewConfig, setIsNewConfig] = useState(false);

  /**
   * 加载场景数据
   */
  const loadScenes = useCallback(async () => {
    setLoading(true);
    try {
      await initConfigStore();
      const [scenesData, current] = await Promise.all([
        getAllScenes(),
        getCurrentScene(),
      ]);
      setScenes(scenesData);
      setCurrentScene(current);
    } catch (error) {
      console.error("[DevSceneManager] 加载场景失败:", error);
      message.error("加载场景配置失败");
    } finally {
      setLoading(false);
    }
  }, []);

  // 组件挂载时加载数据
  useEffect(() => {
    loadScenes();
  }, [loadScenes]);

  /**
   * 切换场景
   */
  const handleSwitchScene = async (sceneId: string) => {
    const success = await switchScene(sceneId);
    if (success) {
      await loadScenes();
      message.success("场景切换成功");
    }
  };

  /**
   * 添加配置
   */
  const handleAddConfig = () => {
    setIsNewConfig(true);
    setEditingScene(null);
    setConfigEditorVisible(true);
  };

  /**
   * 编辑配置
   */
  const handleEditConfig = (scene: SceneConfig) => {
    setIsNewConfig(false);
    setEditingScene(scene);
    setConfigEditorVisible(true);
  };

  /**
   * 删除配置
   */
  const handleDeleteConfig = async (sceneId: string, sceneName: string) => {
    Modal.confirm({
      title: "确认删除",
      content: `确定要删除配置 "${sceneName}" 吗？`,
      okText: "删除",
      okType: "danger",
      cancelText: "取消",
      onOk: async () => {
        const success = await deleteCustomScene(sceneId);
        if (success) {
          await loadScenes();
          message.success("配置已删除");
        }
      },
    });
  };

  /**
   * 重置配置
   */
  const handleResetConfig = async () => {
    Modal.confirm({
      title: "重置配置",
      content: "确定要重置为默认配置吗？所有自定义配置将被删除。",
      okText: "重置",
      okType: "danger",
      cancelText: "取消",
      onOk: async () => {
        await resetConfig();
        await loadScenes();
        message.success("配置已重置");
      },
    });
  };

  /**
   * 保存配置后刷新
   */
  const handleConfigSaved = async () => {
    await loadScenes();
    // 同步配置到后端
    await syncConfigToServer();
  };

  /**
   * 判断是否为当前场景
   */
  const isCurrentScene = (sceneId: string) => currentScene?.id === sceneId;

  // 加载中
  if (loading) {
    return (
      <Card size="small" style={{ textAlign: "center", padding: 20 }}>
        <Spin />
        <div style={{ marginTop: 8 }}>加载场景配置...</div>
      </Card>
    );
  }

  return (
    <>
      <Card
        size="small"
        title={
          <Space>
            <CloudServerOutlined />
            <span>部署环境</span>
          </Space>
        }
        extra={
          <Space>
            <Button
              size="small"
              icon={<RedoOutlined />}
              onClick={handleResetConfig}
            >
              重置
            </Button>
            <Button
              size="small"
              type="primary"
              icon={<PlusOutlined />}
              onClick={handleAddConfig}
            >
              添加
            </Button>
          </Space>
        }
      >
        <List
          size="small"
          dataSource={scenes}
          renderItem={(scene) => (
            <List.Item
              actions={[
                isCurrentScene(scene.id) ? (
                  <Tag color="green">当前</Tag>
                ) : (
                  <Button
                    size="small"
                    onClick={() => handleSwitchScene(scene.id)}
                  >
                    切换
                  </Button>
                ),
                !scene.isDefault && !isCurrentScene(scene.id) && (
                  <>
                    <Button
                      size="small"
                      onClick={() => handleEditConfig(scene)}
                    >
                      编辑
                    </Button>
                    <Button
                      size="small"
                      danger
                      onClick={() => handleDeleteConfig(scene.id, scene.name)}
                    >
                      删除
                    </Button>
                  </>
                ),
              ].filter(Boolean)}
            >
              <List.Item.Meta
                avatar={
                  <Avatar
                    icon={<EnvironmentOutlined />}
                    style={{
                      backgroundColor: isCurrentScene(scene.id)
                        ? "#1890ff"
                        : "#52c41a",
                    }}
                  />
                }
                title={
                  <Space>
                    <span>{scene.name}</span>
                    {scene.isDefault && <Tag color="blue">默认</Tag>}
                  </Space>
                }
                description={
                  <Space direction="vertical" size={0}>
                    <Text type="secondary">
                      {scene.description || "无描述"}
                    </Text>
                    <Text type="secondary" style={{ fontSize: 12 }}>
                      API: {scene.server.apiUrl}
                    </Text>
                  </Space>
                }
              />
            </List.Item>
          )}
        />
      </Card>

      {/* 配置编辑弹窗 */}
      <DevConfigEditor
        visible={configEditorVisible}
        onCancel={() => setConfigEditorVisible(false)}
        scene={editingScene}
        isNew={isNewConfig}
        onSave={handleConfigSaved}
      />
    </>
  );
}
