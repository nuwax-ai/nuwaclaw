/**
 * 依赖管理页面
 * 
 * 功能：
 * - 显示 Node.js 状态
 * - 显示本地 npm 包列表
 * - 安装/管理 npm 包
 */

import React, { useState, useEffect, useCallback } from 'react';
import {
  Space,
  Card,
  Button,
  Tag,
  List,
  Alert,
  Spin,
  Divider,
  Avatar,
  message,
} from 'antd';
import {
  CodeOutlined,
  CloudServerOutlined,
  FolderOutlined,
  CloudDownloadOutlined,
  ReloadOutlined,
  CheckCircleOutlined,
  ExclamationCircleOutlined,
  LoadingOutlined,
  CloseCircleOutlined,
} from '@ant-design/icons';
import { Typography } from 'antd';
import {
  DependencyStatus,
  checkNodeVersion,
  checkAllSetupDependencies,
  initLocalNpmEnv,
  checkLocalNpmPackage,
  installLocalNpmPackage,
  type LocalDependencyItem,
  type NodeVersionResult,
} from '../services/dependencies';

const { Text } = Typography;

/**
 * 依赖管理页面组件
 */
export default function DependenciesPage() {
  // Node.js 状态
  const [nodeResult, setNodeResult] = useState<NodeVersionResult | null>(null);
  // 本地依赖列表
  const [localDeps, setLocalDeps] = useState<LocalDependencyItem[]>([]);
  // 加载状态
  const [depLoading, setDepLoading] = useState(false);
  // 安装状态
  const [depInstalling, setDepInstalling] = useState(false);
  // 当前安装的依赖名称
  const [currentInstallingDep, setCurrentInstallingDep] = useState<string>('');

  /**
   * 加载依赖数据（Node.js + npm 包）
   */
  const loadDependencies = useCallback(async () => {
    setDepLoading(true);
    try {
      // 检测 Node.js 版本
      const nodeRes = await checkNodeVersion();
      setNodeResult(nodeRes);
      
      // 检测所有依赖状态，只保留 npm-local 类型
      const deps = await checkAllSetupDependencies();
      const npmDeps = deps.filter(d => d.type === 'npm-local');
      setLocalDeps(npmDeps);
    } catch (error) {
      console.error('加载依赖数据失败:', error);
      message.error('加载依赖数据失败');
    } finally {
      setDepLoading(false);
    }
  }, []);

  // 组件挂载时加载数据
  useEffect(() => {
    loadDependencies();
  }, [loadDependencies]);

  // 获取依赖统计
  const depSummary = {
    total: localDeps.length,
    installed: localDeps.filter(d => d.status === 'installed').length,
    missing: localDeps.filter(d => d.status === 'missing').length,
  };

  /**
   * 安装单个依赖
   */
  const handleInstallSingleDep = async (packageName: string, displayName: string) => {
    setDepInstalling(true);
    setCurrentInstallingDep(displayName);
    
    // 更新状态为 installing
    setLocalDeps(prev => prev.map(d => 
      d.name === packageName ? { ...d, status: 'installing' as const } : d
    ));
    
    try {
      await initLocalNpmEnv();
      const result = await installLocalNpmPackage(packageName);
      
      if (result.success) {
        // 更新状态为 installed
        setLocalDeps(prev => prev.map(d => 
          d.name === packageName 
            ? { ...d, status: 'installed' as const, version: result.version, binPath: result.binPath }
            : d
        ));
        message.success(`${displayName} 安装成功`);
      } else {
        // 更新状态为 error
        setLocalDeps(prev => prev.map(d => 
          d.name === packageName 
            ? { ...d, status: 'error' as const, errorMessage: result.error }
            : d
        ));
        message.error(`${displayName} 安装失败: ${result.error}`);
      }
    } catch (error) {
      setLocalDeps(prev => prev.map(d => 
        d.name === packageName 
          ? { ...d, status: 'error' as const, errorMessage: String(error) }
          : d
      ));
      message.error(`安装失败: ${error}`);
    } finally {
      setDepInstalling(false);
      setCurrentInstallingDep('');
    }
  };

  /**
   * 安装所有缺失依赖
   */
  const handleInstallAllDeps = async () => {
    const missingDeps = localDeps.filter(d => d.status === 'missing' || d.status === 'error');
    if (missingDeps.length === 0) {
      message.info('没有需要安装的依赖');
      return;
    }
    
    setDepInstalling(true);
    
    try {
      await initLocalNpmEnv();
      
      for (const dep of missingDeps) {
        setCurrentInstallingDep(dep.displayName);
        
        // 更新状态为 installing
        setLocalDeps(prev => prev.map(d => 
          d.name === dep.name ? { ...d, status: 'installing' as const } : d
        ));
        
        // 检查是否已安装
        const checkResult = await checkLocalNpmPackage(dep.name);
        if (checkResult.installed) {
          setLocalDeps(prev => prev.map(d => 
            d.name === dep.name 
              ? { ...d, status: 'installed' as const, version: checkResult.version, binPath: checkResult.binPath }
              : d
          ));
          continue;
        }
        
        // 安装
        const result = await installLocalNpmPackage(dep.name);
        if (result.success) {
          setLocalDeps(prev => prev.map(d => 
            d.name === dep.name 
              ? { ...d, status: 'installed' as const, version: result.version, binPath: result.binPath }
              : d
          ));
        } else {
          setLocalDeps(prev => prev.map(d => 
            d.name === dep.name 
              ? { ...d, status: 'error' as const, errorMessage: result.error }
              : d
          ));
          message.error(`${dep.displayName} 安装失败: ${result.error}`);
        }
      }
      
      message.success('依赖安装完成');
    } catch (error) {
      message.error(`安装失败: ${error}`);
    } finally {
      setDepInstalling(false);
      setCurrentInstallingDep('');
    }
  };

  /**
   * 获取状态标签配置
   */
  const getDepStatusTag = (status: DependencyStatus) => {
    const config: Record<string, { color: string; text: string }> = {
      installed: { color: 'success', text: '已安装' },
      missing: { color: 'warning', text: '待安装' },
      installing: { color: 'processing', text: '安装中' },
      checking: { color: 'default', text: '检测中' },
      error: { color: 'error', text: '错误' },
      outdated: { color: 'orange', text: '版本过低' },
    };
    return config[status] || config.checking;
  };

  /**
   * 获取状态图标
   */
  const getDepStatusIcon = (status: DependencyStatus) => {
    switch (status) {
      case 'installed':
        return <CheckCircleOutlined style={{ color: '#52c41a' }} />;
      case 'missing':
        return <ExclamationCircleOutlined style={{ color: '#faad14' }} />;
      case 'installing':
        return <LoadingOutlined style={{ color: '#1890ff' }} />;
      case 'error':
        return <CloseCircleOutlined style={{ color: '#ff4d4f' }} />;
      default:
        return <LoadingOutlined />;
    }
  };

  // 加载中
  if (depLoading && !nodeResult) {
    return (
      <div style={{ maxWidth: 900, textAlign: 'center', padding: 40 }}>
        <Spin size="large" />
        <div style={{ marginTop: 16 }}>正在检测依赖状态...</div>
      </div>
    );
  }

  return (
    <div style={{ maxWidth: 900 }}>
      {/* Node.js 状态卡片（只读） */}
      <Card size="small" style={{ marginBottom: 16 }}>
        <Space direction="vertical" style={{ width: '100%' }}>
          <Space>
            <CodeOutlined style={{ fontSize: 20, color: '#1890ff' }} />
            <Text strong>Node.js 运行环境</Text>
            {nodeResult?.installed ? (
              nodeResult.meetsRequirement ? (
                <Tag color="success">已安装</Tag>
              ) : (
                <Tag color="warning">版本过低</Tag>
              )
            ) : (
              <Tag color="error">未安装</Tag>
            )}
          </Space>
          {nodeResult?.installed && (
            <Text type="secondary" style={{ marginLeft: 28 }}>
              当前版本: v{nodeResult.version}
              {!nodeResult.meetsRequirement && (
                <Text type="danger"> (需要 &gt;= 22.0.0，请手动升级)</Text>
              )}
            </Text>
          )}
          {!nodeResult?.installed && (
            <Text type="secondary" style={{ marginLeft: 28 }}>
              请先安装 Node.js 22 或更高版本
            </Text>
          )}
        </Space>
      </Card>

      {/* 统计信息 */}
      <Card size="small" style={{ marginBottom: 16 }}>
        <Space split={<Divider type="vertical" />}>
          <Text>本地 npm 包: {depSummary.total} 个</Text>
          <Text type="success">已安装: {depSummary.installed}</Text>
          <Text type="warning">待安装: {depSummary.missing}</Text>
        </Space>
      </Card>

      {/* npm 包列表 */}
      <Card
        title="本地 npm 包"
        extra={
          <Space>
            <Button 
              icon={<ReloadOutlined />} 
              onClick={loadDependencies} 
              loading={depLoading}
            >
              刷新
            </Button>
            {depSummary.missing > 0 && (
              <Button
                type="primary"
                icon={<CloudDownloadOutlined />}
                onClick={handleInstallAllDeps}
                loading={depInstalling}
                disabled={!nodeResult?.meetsRequirement}
              >
                安装全部
              </Button>
            )}
          </Space>
        }
      >
        <List
          loading={depLoading}
          dataSource={localDeps}
          renderItem={(item) => {
            const statusConfig = getDepStatusTag(item.status);
            const isInstalling = item.status === 'installing';
            const canInstall = (item.status === 'missing' || item.status === 'error') && 
                               nodeResult?.meetsRequirement && 
                               !depInstalling;

            return (
              <List.Item
                actions={[
                  <Tag color={statusConfig.color}>{statusConfig.text}</Tag>,
                  canInstall && (
                    <Button
                      type="primary"
                      size="small"
                      icon={<CloudDownloadOutlined />}
                      onClick={() => handleInstallSingleDep(item.name, item.displayName)}
                    >
                      安装
                    </Button>
                  ),
                ].filter(Boolean)}
              >
                <List.Item.Meta
                  avatar={getDepStatusIcon(item.status)}
                  title={
                    <Space>
                      <span>{item.displayName}</span>
                      <Tag color="purple">npm</Tag>
                      {item.required && <Tag color="blue">必需</Tag>}
                    </Space>
                  }
                  description={
                    <Space direction="vertical" size={0}>
                      <Text type="secondary">{item.description}</Text>
                      {item.version && (
                        <Text type="secondary" style={{ fontSize: 12 }}>
                          版本: {item.version}
                        </Text>
                      )}
                      {item.binPath && (
                        <Text type="secondary" style={{ fontSize: 12 }} copyable={{ text: item.binPath }}>
                          路径: {item.binPath}
                        </Text>
                      )}
                      {item.errorMessage && (
                        <Text type="danger" style={{ fontSize: 12 }}>
                          错误: {item.errorMessage}
                        </Text>
                      )}
                      {isInstalling && currentInstallingDep === item.displayName && (
                        <Text type="secondary" style={{ fontSize: 12 }}>
                          <LoadingOutlined style={{ marginRight: 4 }} />
                          正在安装...
                        </Text>
                      )}
                    </Space>
                  }
                />
              </List.Item>
            );
          }}
        />
      </Card>

      {/* Node.js 未满足要求时的提示 */}
      {nodeResult && !nodeResult.meetsRequirement && (
        <Alert
          message="Node.js 环境不满足要求"
          description="请先安装或升级 Node.js 到 22.0.0 或更高版本后才能安装 npm 包"
          type="warning"
          showIcon
          style={{ marginTop: 16 }}
        />
      )}
    </div>
  );
}
