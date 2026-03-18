/**
 * NuwaClaw GUI Agent - 权限检查 UI (Electron)
 * 检查 macOS 权限状态并提供授权引导
 */

import React, { useState, useEffect } from 'react';
import { Button, Card, Progress, Modal, Typography, Space, Alert, Steps, Divider } from 'antd';
import {
  CheckCircleOutlined,
  CloseCircleOutlined,
  WarningOutlined,
  ReloadOutlined,
  SettingOutlined,
  SafetyOutlined,
} from '@ant-design/icons';

const { Title, Text, Paragraph } = Typography;
const { Step } = Steps;

// ========== 权限类型 ==========

interface PermissionStatus {
  type: 'screen_recording' | 'accessibility';
  granted: boolean;
  label: string;
  description: string;
  icon: string;
}

// ========== 权限检查 UI ==========

const PermissionChecker: React.FC = () => {
  const [permissions, setPermissions] = useState<PermissionStatus[]>([
    {
      type: 'screen_recording',
      granted: false,
      label: '屏幕录制',
      description: '截图、屏幕定位功能需要此权限',
      icon: '🖥️',
    },
    {
      type: 'accessibility',
      granted: false,
      label: '辅助功能',
      description: '鼠标键盘控制、操作录制需要此权限',
      icon: '⌨️',
    },
  ]);

  const [loading, setLoading] = useState(false);
  const [modalVisible, setModalVisible] = useState(false);
  const [currentPermission, setCurrentPermission] = useState<PermissionStatus | null>(null);

  // 检查权限
  const checkPermissions = async () => {
    setLoading(true);
    try {
      // 调用后端检查权限
      const result = await window.electronAPI?.gui.checkPermissions();
      
      if (result) {
        setPermissions([
          {
            ...permissions[0],
            granted: result.screen_recording,
          },
          {
            ...permissions[1],
            granted: result.accessibility,
          },
        ]);
      }
    } catch (error) {
      console.error('检查权限失败:', error);
    } finally {
      setLoading(false);
    }
  };

  // 打开系统设置
  const openSystemSettings = (permissionType: string) => {
    window.electronAPI?.gui.openPermissionSettings(permissionType);
  };

  // 显示授权引导
  const showAuthGuide = (permission: PermissionStatus) => {
    setCurrentPermission(permission);
    setModalVisible(true);
  };

  // 初始化检查
  useEffect(() => {
    checkPermissions();
  }, []);

  // 计算进度
  const grantedCount = permissions.filter(p => p.granted).length;
  const progress = (grantedCount / permissions.length) * 100;

  return (
    <div style={{ padding: 24, maxWidth: 800, margin: '0 auto' }}>
      <Card>
        <Space direction="vertical" style={{ width: '100%' }} size="large">
          {/* 标题 */}
          <div style={{ textAlign: 'center' }}>
            <SafetyOutlined style={{ fontSize: 48, color: '#1890ff' }} />
            <Title level={3} style={{ marginTop: 16 }}>
              macOS 权限检查
            </Title>
            <Text type="secondary">
              GUI Agent 需要以下权限才能正常工作
            </Text>
          </div>

          <Divider />

          {/* 进度条 */}
          <div style={{ textAlign: 'center' }}>
            <Progress
              type="circle"
              percent={progress}
              format={() => `${grantedCount}/${permissions.length}`}
              strokeColor={{
                '0%': '#ff4d4f',
                '100%': '#52c41a',
              }}
            />
            <Paragraph style={{ marginTop: 16 }}>
              {grantedCount === permissions.length ? (
                <Alert
                  message="所有权限已授予"
                  description="GUI Agent 可以正常工作"
                  type="success"
                  showIcon
                />
              ) : (
                <Alert
                  message="部分权限未授予"
                  description="部分功能可能受限"
                  type="warning"
                  showIcon
                />
              )}
            </Paragraph>
          </div>

          <Divider />

          {/* 权限列表 */}
          <Space direction="vertical" style={{ width: '100%' }} size="middle">
            {permissions.map((permission) => (
              <Card
                key={permission.type}
                size="small"
                hoverable
                onClick={() => !permission.granted && showAuthGuide(permission)}
              >
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <Space>
                    <span style={{ fontSize: 24 }}>{permission.icon}</span>
                    <div>
                      <Title level={5} style={{ margin: 0 }}>
                        {permission.label}
                        {permission.granted ? (
                          <CheckCircleOutlined style={{ color: '#52c41a', marginLeft: 8 }} />
                        ) : (
                          <CloseCircleOutlined style={{ color: '#ff4d4f', marginLeft: 8 }} />
                        )}
                      </Title>
                      <Text type="secondary" style={{ fontSize: 12 }}>
                        {permission.description}
                      </Text>
                    </div>
                  </Space>
                  
                  {!permission.granted && (
                    <Button
                      type="primary"
                      size="small"
                      icon={<SettingOutlined />}
                      onClick={(e) => {
                        e.stopPropagation();
                        showAuthGuide(permission);
                      }}
                    >
                      授权
                    </Button>
                  )}
                </div>
              </Card>
            ))}
          </Space>

          <Divider />

          {/* 操作按钮 */}
          <div style={{ textAlign: 'center' }}>
            <Button
              type="default"
              icon={<ReloadOutlined />}
              onClick={checkPermissions}
              loading={loading}
            >
              重新检查
            </Button>
          </div>
        </Space>
      </Card>

      {/* 授权引导对话框 */}
      <Modal
        title={
          <Space>
            <WarningOutlined style={{ color: '#faad14' }} />
            <span>授权 {currentPermission?.label}</span>
          </Space>
        }
        open={modalVisible}
        onCancel={() => setModalVisible(false)}
        footer={[
          <Button key="cancel" onClick={() => setModalVisible(false)}>
            取消
          </Button>,
          <Button
            key="open"
            type="primary"
            icon={<SettingOutlined />}
            onClick={() => {
              if (currentPermission) {
                openSystemSettings(currentPermission.type);
                setModalVisible(false);
              }
            }}
          >
            打开系统设置
          </Button>,
        ]}
        width={600}
      >
        {currentPermission && (
          <div>
            <Paragraph>
              <Text strong>为什么需要此权限？</Text>
              <br />
              <Text type="secondary">{currentPermission.description}</Text>
            </Paragraph>

            <Divider />

            <Text strong>授权步骤：</Text>
            <Steps
              direction="vertical"
              size="small"
              current={-1}
              style={{ marginTop: 16 }}
            >
              <Step
                title="打开系统设置"
                description="点击下方按钮自动跳转"
              />
              <Step
                title="找到对应权限"
                description={
                  currentPermission.type === 'screen_recording'
                    ? '隐私与安全性 → 屏幕录制'
                    : '隐私与安全性 → 辅助功能'
                }
              />
              <Step
                title="勾选应用"
                description="找到并勾选「Terminal」或「Python」"
              />
              <Step
                title="重启应用"
                description="重启终端或应用，重新检查权限"
              />
            </Steps>

            <Divider />

            <Alert
              message="注意"
              description="授权后需要重启应用才能生效"
              type="info"
              showIcon
            />
          </div>
        )}
      </Modal>
    </div>
  );
};

export default PermissionChecker;
