/**
 * 关于页面
 * 
 * 功能：
 * - 显示应用信息
 * - 版本号
 * - 应用描述
 */

import React from 'react';
import { Card, Avatar } from 'antd';
import { RobotOutlined } from '@ant-design/icons';
import { Typography } from 'antd';

const { Title, Text, Paragraph } = Typography;

/**
 * 关于页面组件
 */
export default function AboutPage() {
  return (
    <Card>
      <div style={{ textAlign: 'center', padding: '20px 0' }}>
        <Avatar size={80} icon={<RobotOutlined />} style={{ backgroundColor: '#1890ff' }} />
        <Title level={3} style={{ marginTop: 16 }}>NuWax Agent</Title>
        <Text type="secondary">版本 v0.1.0</Text>
        <Paragraph type="secondary" style={{ marginTop: 8 }}>
          跨平台 Agent 客户端
        </Paragraph>
        <Paragraph type="secondary">
          提供远程桌面控制、AI 编程助手集成等功能
        </Paragraph>
      </div>
    </Card>
  );
}
