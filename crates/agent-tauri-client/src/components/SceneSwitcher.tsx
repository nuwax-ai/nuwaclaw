/**
 * 场景切换组件
 * 快速切换不同的部署环境配置
 */

import { useState, useEffect, useCallback } from 'react';
import { Select, Space, Tooltip, Tag, Typography, Badge } from 'antd';
import {
  EnvironmentOutlined,
  SwapOutlined,
} from '@ant-design/icons';
import {
  initConfigStore,
  getAllScenes,
  getCurrentScene,
  switchScene,
  SceneConfig,
} from '../services/config';

const { Text } = Typography;

interface SceneSwitcherProps {
  showLabel?: boolean;
  size?: 'small' | 'middle' | 'large';
}

export default function SceneSwitcher({ showLabel = true, size = 'middle' }: SceneSwitcherProps) {
  const [scenes, setScenes] = useState<SceneConfig[]>([]);
  const [currentSceneId, setCurrentSceneId] = useState<string>('');
  const [currentScene, setCurrentScene] = useState<SceneConfig | null>(null);
  const [loading, setLoading] = useState(true);

  // 加载场景数据
  useEffect(() => {
    const loadScenes = async () => {
      try {
        await initConfigStore();
        const [scenesData, scene] = await Promise.all([
          getAllScenes(),
          getCurrentScene(),
        ]);
        setScenes(scenesData);
        setCurrentSceneId(scene.id);
        setCurrentScene(scene);
      } catch (error) {
        console.error('加载场景失败:', error);
      } finally {
        setLoading(false);
      }
    };
    loadScenes();
  }, []);

  const handleChange = useCallback(async (value: string) => {
    const success = await switchScene(value);
    if (success) {
      const scene = scenes.find((s) => s.id === value);
      if (scene) {
        setCurrentSceneId(value);
        setCurrentScene(scene);
      }
    }
  }, [scenes]);

  const options = scenes.map((scene) => ({
    value: scene.id,
    label: (
      <Space>
        <span>{scene.name}</span>
        {scene.description && (
          <Text type="secondary" style={{ fontSize: 12 }}>
            {scene.description}
          </Text>
        )}
        {scene.isDefault && <Tag color="blue" style={{ marginLeft: 8 }}>默认</Tag>}
      </Space>
    ),
  }));

  // 显示加载中状态
  if (loading) {
    return (
      <Space>
        {showLabel && <EnvironmentOutlined style={{ color: '#1890ff' }} />}
        <Select
          loading
          style={{ width: 180 }}
          size={size}
          suffixIcon={<SwapOutlined />}
        />
      </Space>
    );
  }

  // 如果还没有当前场景，显示空状态
  if (!currentScene) {
    return null;
  }

  return (
    <Space>
      {showLabel && (
        <Tooltip title="选择部署环境">
          <EnvironmentOutlined style={{ color: '#1890ff' }} />
        </Tooltip>
      )}
      <Select
        value={currentSceneId}
        onChange={handleChange}
        options={options}
        style={{ width: 180 }}
        size={size}
        suffixIcon={<SwapOutlined />}
      />
      <Badge
        status={currentScene.server.apiUrl.includes('localhost') ? 'processing' : 'success'}
        text={
          <Text type="secondary" style={{ fontSize: 12 }}>
            {currentScene.server.apiUrl.replace('https://', '').replace('http://', '')}
          </Text>
        }
      />
    </Space>
  );
}
