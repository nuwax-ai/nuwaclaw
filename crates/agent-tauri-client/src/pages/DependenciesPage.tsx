/**
 * 依赖管理页面
 * 
 * 功能：
 * - 显示 Node.js 状态
 * - 显示 uv 状态
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
  message,
} from 'antd';
import {
  CodeOutlined,
  CloudDownloadOutlined,
  ReloadOutlined,
  CheckCircleOutlined,
  ExclamationCircleOutlined,
  LoadingOutlined,
  CloseCircleOutlined,
  ThunderboltOutlined,
} from '@ant-design/icons';
import { Typography } from 'antd';
import {
  DependencyStatus,
  checkNodeVersion,
  checkUvVersion,
  checkAllSetupDependencies,
  initLocalNpmEnv,
  checkLocalNpmPackage,
  installLocalNpmPackage,
  type LocalDependencyItem,
  type NodeVersionResult,
  type UvVersionResult,
} from '../services/dependencies';

const { Text } = Typography;

/**
 * 依赖管理页面组件
 */
export default function DependenciesPage() {
  // Node.js 状态
  const [nodeResult, setNodeResult] = useState<NodeVersionResult | null>(null);
  // uv 状态
  const [uvResult, setUvResult] = useState<UvVersionResult | null>(null);
  // 本地依赖列表
  const [localDeps, setLocalDeps] = useState<LocalDependencyItem[]>([]);
  // 加载状态
  const [depLoading, setDepLoading] = useState(false);
  // 安装状态
  const [depInstalling, setDepInstalling] = useState(false);
  // 当前安装的依赖名称
  const [currentInstallingDep, setCurrentInstallingDep] = useState<string>('');

  /**
   * 加载依赖数据（Node.js + uv + npm 包）
   */
  const loadDependencies = useCallback(async () => {
    setDepLoading(true);
    try {
      // 并行检测 Node.js 和 uv 版本
      const [nodeRes, uvRes] = await Promise.all([
        checkNodeVersion(),
        checkUvVersion(),
      ]);
      setNodeResult(nodeRes);
      setUvResult(uvRes);
      
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

  // 系统依赖是否都满足
  const systemDepsReady = nodeResult?.meetsRequirement && uvResult?.meetsRequirement;

  return (
    <div style={{ maxWidth: 900 }}>
      {/* 系统依赖状态卡片（只读） */}
      <Card 
        size="small" 
        style={{ marginBottom: 16 }}
        title={
          <Space>
            <Text strong>系统依赖环境</Text>
            {systemDepsReady ? (
              <Tag color="success">已就绪</Tag>
            ) : (
              <Tag color="warning">需要配置</Tag>
            )}
          </Space>
        }
      >
        <Space direction="vertical" style={{ width: '100%' }} size={12}>
          {/* Node.js 状态 */}
          <div style={{ 
            padding: '8px 12px', 
            background: nodeResult?.meetsRequirement ? '#f6ffed' : '#fffbe6', 
            borderRadius: 6,
            border: nodeResult?.meetsRequirement ? '1px solid #b7eb8f' : '1px solid #ffe58f',
          }}>
            <Space>
              <CodeOutlined style={{ fontSize: 18, color: nodeResult?.meetsRequirement ? '#52c41a' : '#faad14' }} />
              <Text strong>Node.js</Text>
              {nodeResult?.installed ? (
                nodeResult.meetsRequirement ? (
                  <Tag color="success">v{nodeResult.version}</Tag>
                ) : (
                  <>
                    <Tag color="warning">v{nodeResult.version}</Tag>
                    <Text type="danger" style={{ fontSize: 12 }}>(需要 &gt;= 22.0.0)</Text>
                  </>
                )
              ) : (
                <Tag color="error">未安装</Tag>
              )}
            </Space>
            {!nodeResult?.installed && (
              <div style={{ marginTop: 4, marginLeft: 26 }}>
                <Text type="secondary" style={{ fontSize: 12 }}>
                  请访问 <a href="https://nodejs.org" target="_blank" rel="noopener noreferrer">nodejs.org</a> 安装
                </Text>
              </div>
            )}
          </div>

          {/* uv 状态 */}
          <div style={{ 
            padding: '8px 12px', 
            background: uvResult?.meetsRequirement ? '#f6ffed' : '#fffbe6', 
            borderRadius: 6,
            border: uvResult?.meetsRequirement ? '1px solid #b7eb8f' : '1px solid #ffe58f',
          }}>
            <Space>
              <ThunderboltOutlined style={{ fontSize: 18, color: uvResult?.meetsRequirement ? '#52c41a' : '#faad14' }} />
              <Text strong>uv</Text>
              {uvResult?.installed ? (
                uvResult.meetsRequirement ? (
                  <Tag color="success">v{uvResult.version}</Tag>
                ) : (
                  <>
                    <Tag color="warning">v{uvResult.version}</Tag>
                    <Text type="danger" style={{ fontSize: 12 }}>(需要 &gt;= 0.5.0)</Text>
                  </>
                )
              ) : (
                <Tag color="error">未安装</Tag>
              )}
              <Text type="secondary" style={{ fontSize: 12 }}>高性能 Python 包管理器</Text>
            </Space>
            {!uvResult?.installed && (
              <div style={{ marginTop: 4, marginLeft: 26 }}>
                <Text type="secondary" style={{ fontSize: 12 }}>
                  安装命令: <Text code copyable>curl -LsSf https://astral.sh/uv/install.sh | sh</Text>
                </Text>
              </div>
            )}
          </div>
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
                disabled={!systemDepsReady}
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
                               systemDepsReady && 
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

      {/* 系统依赖未满足要求时的提示 */}
      {!systemDepsReady && (
        <Alert
          message="系统依赖环境不满足要求"
          description={
            <Space direction="vertical" size={4}>
              {!nodeResult?.meetsRequirement && (
                <Text>请安装或升级 Node.js 到 22.0.0 或更高版本</Text>
              )}
              {!uvResult?.meetsRequirement && (
                <Text>请安装 uv 0.5.0 或更高版本</Text>
              )}
              <Text type="secondary">满足系统依赖要求后才能安装 npm 包</Text>
            </Space>
          }
          type="warning"
          showIcon
          style={{ marginTop: 16 }}
        />
      )}
    </div>
  );
}
