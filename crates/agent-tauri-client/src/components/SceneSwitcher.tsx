/**
 * 场景切换组件
 * 快速切换不同的部署环境配置
 */

import { useState, useEffect } from 'react';
import { Select, Space, Tooltip, Tag, Button, Typography, Badge } from 'antd';
import { 
  EnvironmentOutlined, 
  CloudServerOutlined, 
  SettingOutlined,
  SwapOutlined,
} from '@ant-design/icons';
import { 
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
  const [currentSceneId, setCurrentSceneId] = useState<string>('local');

  useEffect(() => {
    setScenes(getAllScenes());
    setCurrentSceneId(getCurrentScene().id);
  }, []);

  const handleChange = async (value: string) => {
    await switchScene(value);
    setCurrentSceneId(value);
  };

  const currentScene = getCurrentScene();

  const options = scenes.map(scene => ({
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
