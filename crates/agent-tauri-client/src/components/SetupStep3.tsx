/**
 * 初始化向导 - 步骤3: 依赖安装
 * 
 * 功能:
 * - 检测 Node.js 版本 (>= 22.0.0)
 * - 安装本地 npm 包
 * - 显示安装进度
 * - 支持重试和手动检测
 */

import React, { useState, useEffect, useCallback } from 'react';
import {
  Typography,
  Divider,
  Button,
  Space,
  Progress,
  List,
  Tag,
  Alert,
  Spin,
  Result,
  message,
  Tooltip,
} from 'antd';
import {
  CloudDownloadOutlined,
  CheckCircleOutlined,
  CloseCircleOutlined,
  LoadingOutlined,
  ExclamationCircleOutlined,
  ReloadOutlined,
  LinkOutlined,
  NodeIndexOutlined,
  CodeOutlined,
  FolderOutlined,
} from '@ant-design/icons';
import { openUrl } from '@tauri-apps/plugin-opener';
import {
  checkNodeVersion,
  checkUvVersion,
  checkAllSetupDependencies,
  getAppDataDir,
  initLocalNpmEnv,
  checkLocalNpmPackage,
  installLocalNpmPackage,
  type LocalDependencyItem,
  type NodeVersionResult,
  type UvVersionResult,
} from '../services/dependencies';

const { Title, Text, Paragraph } = Typography;

interface SetupStep3Props {
  /** 完成回调 */
  onComplete: () => void;
}

// 安装状态
type InstallPhase = 'checking' | 'node-missing' | 'uv-missing' | 'system-deps-missing' | 'ready' | 'installing' | 'completed' | 'error';

/**
 * 步骤3: 依赖安装组件
 */
export default function SetupStep3({ onComplete }: SetupStep3Props) {
  // Node.js 状态
  const [nodeResult, setNodeResult] = useState<NodeVersionResult | null>(null);
  const [checkingNode, setCheckingNode] = useState(true);
  
  // uv 状态
  const [uvResult, setUvResult] = useState<UvVersionResult | null>(null);
  const [checkingUv, setCheckingUv] = useState(true);
  
  // 依赖状态
  const [dependencies, setDependencies] = useState<LocalDependencyItem[]>([]);
  
  // 安装状态
  const [installPhase, setInstallPhase] = useState<InstallPhase>('checking');
  const [installProgress, setInstallProgress] = useState(0);
  const [currentInstalling, setCurrentInstalling] = useState<string>('');
  const [installError, setInstallError] = useState<string>('');
  
  // 应用目录
  const [appDir, setAppDir] = useState<string>('');

  /**
   * 检测系统依赖（Node.js 和 uv）
   */
  const checkSystemDeps = useCallback(async () => {
    setCheckingNode(true);
    setCheckingUv(true);
    
    try {
      // 并行检测 Node.js 和 uv
      const [nodeRes, uvRes] = await Promise.all([
        checkNodeVersion(),
        checkUvVersion(),
      ]);
      
      setNodeResult(nodeRes);
      setUvResult(uvRes);
      
      const nodeReady = nodeRes.installed && nodeRes.meetsRequirement;
      const uvReady = uvRes.installed && uvRes.meetsRequirement;
      
      if (!nodeReady && !uvReady) {
        // 两个都缺失
        setInstallPhase('system-deps-missing');
      } else if (!nodeReady) {
        // 只缺 Node.js
        setInstallPhase('node-missing');
      } else if (!uvReady) {
        // 只缺 uv
        setInstallPhase('uv-missing');
      } else {
        // 系统依赖都满足，检测其他依赖
        await checkDependencies();
      }
    } catch (error) {
      console.error('[SetupStep3] 检测系统依赖失败:', error);
      setInstallPhase('system-deps-missing');
    } finally {
      setCheckingNode(false);
      setCheckingUv(false);
    }
  }, []);

  /**
   * 检测所有依赖状态
   * 只显示 npm-local 类型的包（Node.js 状态单独显示）
   */
  const checkDependencies = useCallback(async () => {
    try {
      const deps = await checkAllSetupDependencies();
      // 过滤只显示 npm 包（不显示 nodejs，因为已在上方单独展示）
      const npmDeps = deps.filter(d => d.type === 'npm-local');
      setDependencies(npmDeps);
      
      // 检查是否所有 npm 依赖都已安装
      const allInstalled = npmDeps.every(d => d.status === 'installed');
      if (allInstalled) {
        setInstallPhase('completed');
      } else {
        setInstallPhase('ready');
      }
    } catch (error) {
      console.error('[SetupStep3] 检测依赖失败:', error);
      setInstallPhase('error');
      setInstallError('检测依赖状态失败');
    }
  }, []);

  /**
   * 获取应用目录
   */
  const loadAppDir = useCallback(async () => {
    try {
      const dir = await getAppDataDir();
      setAppDir(dir);
    } catch (error) {
      console.error('[SetupStep3] 获取应用目录失败:', error);
    }
  }, []);

  /**
   * 初始化
   */
  useEffect(() => {
    loadAppDir();
    checkSystemDeps();
  }, [checkSystemDeps, loadAppDir]);

  /**
   * 打开 Node.js 官网
   */
  const handleOpenNodejs = async () => {
    try {
      await openUrl('https://nodejs.org');
    } catch (error) {
      console.error('[SetupStep3] 打开链接失败:', error);
      message.error('打开链接失败');
    }
  };

  /**
   * 打开 uv 安装页面
   */
  const handleOpenUv = async () => {
    try {
      await openUrl('https://docs.astral.sh/uv/getting-started/installation/');
    } catch (error) {
      console.error('[SetupStep3] 打开链接失败:', error);
      message.error('打开链接失败');
    }
  };

  /**
   * 重新检测系统依赖
   */
  const handleRetrySystemCheck = async () => {
    await checkSystemDeps();
  };

  /**
   * 开始安装依赖
   * 逐个安装 npm 包，实时更新每个包的状态
   */
  const handleStartInstall = async () => {
    setInstallPhase('installing');
    setInstallProgress(0);
    setInstallError('');
    
    try {
      // 获取需要安装的 npm 包列表
      const npmPackages = dependencies.filter(d => d.type === 'npm-local');
      const total = npmPackages.length;
      
      // 初始化 npm 环境
      await initLocalNpmEnv();
      
      // 依次安装每个包
      for (let i = 0; i < npmPackages.length; i++) {
        const pkg = npmPackages[i];
        setCurrentInstalling(pkg.displayName);
        setInstallProgress(Math.round((i / total) * 100));
        
        // 更新当前包状态为 installing
        setDependencies(prev => prev.map(d => 
          d.name === pkg.name ? { ...d, status: 'installing' as const } : d
        ));
        
        // 检查是否已安装
        const checkResult = await checkLocalNpmPackage(pkg.name);
        if (checkResult.installed) {
          // 已安装，更新状态
          setDependencies(prev => prev.map(d => 
            d.name === pkg.name 
              ? { ...d, status: 'installed' as const, version: checkResult.version, binPath: checkResult.binPath }
              : d
          ));
          continue;
        }
        
        // 安装包
        const installResult = await installLocalNpmPackage(pkg.name);
        if (installResult.success) {
          // 安装成功，更新状态
          setDependencies(prev => prev.map(d => 
            d.name === pkg.name 
              ? { ...d, status: 'installed' as const, version: installResult.version, binPath: installResult.binPath }
              : d
          ));
        } else {
          // 安装失败
          setDependencies(prev => prev.map(d => 
            d.name === pkg.name 
              ? { ...d, status: 'error' as const, errorMessage: installResult.error }
              : d
          ));
          setInstallPhase('error');
          setInstallError(installResult.error || `安装 ${pkg.displayName} 失败`);
          return;
        }
      }
      
      // 全部安装成功
      setInstallProgress(100);
      setInstallPhase('completed');
      message.success('所有依赖安装完成，正在启动服务...');
      
      // 自动触发完成回调（调用 restart_all_services）
      setTimeout(() => {
        onComplete();
      }, 1000);
      
    } catch (error) {
      console.error('[SetupStep3] 安装失败:', error);
      setInstallPhase('error');
      setInstallError(error instanceof Error ? error.message : '安装失败');
    }
  };

  /**
   * 重试安装
   */
  const handleRetryInstall = async () => {
    await handleStartInstall();
  };

  /**
   * 获取状态图标
   */
  const getStatusIcon = (status: string) => {
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

  /**
   * 获取状态标签
   */
  const getStatusTag = (item: LocalDependencyItem) => {
    const config: Record<string, { color: string; text: string }> = {
      installed: { color: 'success', text: '已安装' },
      missing: { color: 'warning', text: '待安装' },
      installing: { color: 'processing', text: '安装中' },
      checking: { color: 'default', text: '检测中' },
      error: { color: 'error', text: '错误' },
      outdated: { color: 'orange', text: '版本过低' },
    };
    const c = config[item.status] || config.checking;
    return <Tag color={c.color}>{c.text}</Tag>;
  };

  /**
   * 渲染 Node.js 缺失提示
   */
  const renderNodeMissing = () => (
    <Result
      icon={<NodeIndexOutlined style={{ color: '#faad14' }} />}
      title={nodeResult?.installed ? 'Node.js 版本过低' : 'Node.js 未安装'}
      subTitle={
        nodeResult?.installed
          ? `当前版本 ${nodeResult.version}，需要 >= 22.0.0`
          : '请先安装 Node.js 22 或更高版本'
      }
      extra={
        <Space direction="vertical" align="center">
          <Space>
            <Button
              type="primary"
              icon={<LinkOutlined />}
              onClick={handleOpenNodejs}
            >
              打开 nodejs.org
            </Button>
            <Button
              icon={<ReloadOutlined />}
              onClick={handleRetrySystemCheck}
            >
              重新检测
            </Button>
          </Space>
          <Text type="secondary" style={{ fontSize: 12 }}>
            安装完成后点击"重新检测"继续
          </Text>
        </Space>
      }
    />
  );

  /**
   * 渲染 uv 缺失提示
   */
  const renderUvMissing = () => (
    <Result
      icon={<CodeOutlined style={{ color: '#faad14' }} />}
      title={uvResult?.installed ? 'uv 版本过低' : 'uv 未安装'}
      subTitle={
        uvResult?.installed
          ? `当前版本 ${uvResult.version}，需要 >= 0.5.0`
          : '请先安装 uv (高性能 Python 包管理器)'
      }
      extra={
        <Space direction="vertical" align="center">
          <Space>
            <Button
              type="primary"
              icon={<LinkOutlined />}
              onClick={handleOpenUv}
            >
              查看安装说明
            </Button>
            <Button
              icon={<ReloadOutlined />}
              onClick={handleRetrySystemCheck}
            >
              重新检测
            </Button>
          </Space>
          <Paragraph style={{ fontSize: 12, color: '#666', marginTop: 8 }}>
            <Text strong>快速安装命令:</Text>
            <br />
            <Text code>curl -LsSf https://astral.sh/uv/install.sh | sh</Text>
          </Paragraph>
        </Space>
      }
    />
  );

  /**
   * 渲染多个系统依赖缺失提示
   */
  const renderSystemDepsMissing = () => {
    const nodeMissing = !nodeResult?.installed || !nodeResult?.meetsRequirement;
    const uvMissing = !uvResult?.installed || !uvResult?.meetsRequirement;
    
    return (
      <Result
        icon={<ExclamationCircleOutlined style={{ color: '#faad14' }} />}
        title="系统依赖未就绪"
        subTitle="请安装以下系统依赖后继续"
        extra={
          <Space direction="vertical" align="center" style={{ width: '100%' }}>
            {/* Node.js 状态 */}
            <div style={{ 
              padding: '12px 16px', 
              background: nodeMissing ? '#fffbe6' : '#f6ffed', 
              borderRadius: 8,
              width: '100%',
              maxWidth: 400,
              textAlign: 'left'
            }}>
              <Space>
                {nodeMissing 
                  ? <ExclamationCircleOutlined style={{ color: '#faad14' }} />
                  : <CheckCircleOutlined style={{ color: '#52c41a' }} />
                }
                <Text strong>Node.js</Text>
                {nodeResult?.version && <Tag>{nodeResult.version}</Tag>}
                {nodeMissing 
                  ? <Tag color="warning">{nodeResult?.installed ? '版本过低' : '未安装'}</Tag>
                  : <Tag color="success">已就绪</Tag>
                }
              </Space>
              {nodeMissing && (
                <div style={{ marginTop: 8 }}>
                  <Button size="small" type="link" onClick={handleOpenNodejs}>
                    <LinkOutlined /> 打开 nodejs.org
                  </Button>
                </div>
              )}
            </div>
            
            {/* uv 状态 */}
            <div style={{ 
              padding: '12px 16px', 
              background: uvMissing ? '#fffbe6' : '#f6ffed', 
              borderRadius: 8,
              width: '100%',
              maxWidth: 400,
              textAlign: 'left'
            }}>
              <Space>
                {uvMissing 
                  ? <ExclamationCircleOutlined style={{ color: '#faad14' }} />
                  : <CheckCircleOutlined style={{ color: '#52c41a' }} />
                }
                <Text strong>uv</Text>
                {uvResult?.version && <Tag>{uvResult.version}</Tag>}
                {uvMissing 
                  ? <Tag color="warning">{uvResult?.installed ? '版本过低' : '未安装'}</Tag>
                  : <Tag color="success">已就绪</Tag>
                }
              </Space>
              {uvMissing && (
                <div style={{ marginTop: 8 }}>
                  <Text type="secondary" style={{ fontSize: 12 }}>
                    <Text code copyable>curl -LsSf https://astral.sh/uv/install.sh | sh</Text>
                  </Text>
                  <Button size="small" type="link" onClick={handleOpenUv}>
                    <LinkOutlined /> 查看文档
                  </Button>
                </div>
              )}
            </div>
            
            <Button
              icon={<ReloadOutlined />}
              onClick={handleRetrySystemCheck}
              style={{ marginTop: 8 }}
            >
              重新检测
            </Button>
            <Text type="secondary" style={{ fontSize: 12 }}>
              安装完成后点击"重新检测"继续
            </Text>
          </Space>
        }
      />
    );
  };

  /**
   * 渲染依赖列表
   */
  const renderDependencyList = () => (
    <List
      dataSource={dependencies}
      renderItem={(item) => (
        <List.Item>
          <List.Item.Meta
            avatar={getStatusIcon(item.status)}
            title={
              <Space>
                <span>{item.displayName}</span>
                {item.type === 'system' && <Tag color="blue">系统</Tag>}
                {item.type === 'npm-local' && <Tag color="purple">npm</Tag>}
              </Space>
            }
            description={
              <Space direction="vertical" size={2}>
                <Text type="secondary">{item.description}</Text>
                {item.version && (
                  <Text type="secondary" style={{ fontSize: 12 }}>
                    版本: {item.version}
                  </Text>
                )}
                {item.binPath && (
                  <Tooltip title={item.binPath}>
                    <Text type="secondary" style={{ fontSize: 12 }}>
                      路径: {item.binPath.length > 40 ? '...' + item.binPath.slice(-40) : item.binPath}
                    </Text>
                  </Tooltip>
                )}
                {item.errorMessage && (
                  <Text type="danger" style={{ fontSize: 12 }}>
                    {item.errorMessage}
                  </Text>
                )}
              </Space>
            }
          />
          {getStatusTag(item)}
        </List.Item>
      )}
    />
  );

  /**
   * 渲染安装进度
   */
  const renderInstallProgress = () => (
    <div className="install-progress">
      <Progress
        percent={installProgress}
        status={installPhase === 'error' ? 'exception' : 'active'}
      />
      <Text style={{ marginTop: 8, display: 'block', textAlign: 'center' }}>
        {currentInstalling ? `正在安装 ${currentInstalling}...` : '准备安装...'}
      </Text>
    </div>
  );

  /**
   * 渲染主内容
   */
  const renderContent = () => {
    // 检测中
    if (checkingNode || checkingUv) {
      return (
        <div className="step-loading">
          <Spin size="large" />
          <Text style={{ marginTop: 16 }}>正在检测系统依赖环境...</Text>
        </div>
      );
    }

    // 多个系统依赖缺失
    if (installPhase === 'system-deps-missing') {
      return renderSystemDepsMissing();
    }

    // Node.js 缺失
    if (installPhase === 'node-missing') {
      return renderNodeMissing();
    }

    // uv 缺失
    if (installPhase === 'uv-missing') {
      return renderUvMissing();
    }

    // 安装完成
    if (installPhase === 'completed') {
      return (
        <Result
          icon={<CheckCircleOutlined style={{ color: '#52c41a' }} />}
          title="依赖安装完成"
          subTitle="所有必需组件已就绪，正在启动服务..."
          extra={<Spin size="large" />}
        />
      );
    }

    // 安装错误
    if (installPhase === 'error') {
      return (
        <Result
          status="error"
          title="安装失败"
          subTitle={installError}
          extra={
            <Space>
              <Button type="primary" onClick={handleRetryInstall}>
                重试安装
              </Button>
              <Button onClick={checkDependencies}>
                重新检测
              </Button>
            </Space>
          }
        />
      );
    }

    // 正常状态
    return (
      <>
        {/* 系统依赖检测成功提示 */}
        <Alert
          message="系统依赖检测通过"
          description={
            <Space direction="vertical" size={4}>
              {/* Node.js 状态 */}
              {nodeResult?.installed && nodeResult?.meetsRequirement && (
                <Text>
                  <CheckCircleOutlined style={{ color: '#52c41a', marginRight: 8 }} />
                  <Text strong>Node.js</Text>: v{nodeResult.version}
                  <Text type="secondary"> (需要 &gt;= 22.0.0)</Text>
                </Text>
              )}
              {/* uv 状态 */}
              {uvResult?.installed && uvResult?.meetsRequirement && (
                <Text>
                  <CheckCircleOutlined style={{ color: '#52c41a', marginRight: 8 }} />
                  <Text strong>uv</Text>: v{uvResult.version}
                  <Text type="secondary"> (需要 &gt;= 0.5.0)</Text>
                </Text>
              )}
            </Space>
          }
          type="success"
          showIcon
          style={{ marginBottom: 16 }}
        />

        {/* 安装目录提示 */}
        {appDir && (
          <Alert
            message="本地安装目录"
            description={
              <Space direction="vertical" size={0}>
                <Text copyable={{ text: `${appDir}/node_modules` }}>
                  <FolderOutlined style={{ marginRight: 8 }} />
                  {appDir}/node_modules
                </Text>
                <Text type="secondary" style={{ fontSize: 12, marginTop: 4 }}>
                  npm 包将安装到应用本地目录，不会影响系统全局环境
                </Text>
              </Space>
            }
            type="info"
            showIcon
            style={{ marginBottom: 16 }}
          />
        )}

        {/* 依赖列表 */}
        {renderDependencyList()}

        {/* 安装进度 */}
        {installPhase === 'installing' && renderInstallProgress()}

        {/* 操作按钮 */}
        <Divider />
        <div className="step-actions">
          {installPhase === 'ready' && (
            <Space>
              <Button
                icon={<ReloadOutlined />}
                onClick={checkDependencies}
              >
                重新检测
              </Button>
              <Button
                type="primary"
                icon={<CloudDownloadOutlined />}
                onClick={handleStartInstall}
                size="large"
              >
                开始安装
              </Button>
            </Space>
          )}
        </div>
      </>
    );
  };

  return (
    <div className="setup-step3">
      <div className="step-header">
        <Title level={4}>
          <CloudDownloadOutlined style={{ marginRight: 8 }} />
          依赖安装
        </Title>
        <Text type="secondary">
          安装运行所需的必要组件
        </Text>
      </div>

      <Divider />

      {/* Node.js 状态 */}
      {nodeResult && nodeResult.installed && nodeResult.meetsRequirement && (
        <Alert
          message={
            <Space>
              <NodeIndexOutlined />
              <span>Node.js {nodeResult.version}</span>
            </Space>
          }
          type="success"
          showIcon={false}
          style={{ marginBottom: 16 }}
        />
      )}

      {renderContent()}

      {/* 内联样式 */}
      <style>{`
        .setup-step3 {
          padding: 16px 0;
        }
        
        .step-header {
          margin-bottom: 8px;
        }
        
        .step-header .ant-typography {
          margin-bottom: 4px;
        }
        
        .step-loading {
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          padding: 60px 0;
        }
        
        .install-progress {
          padding: 24px;
          background: #f5f5f5;
          border-radius: 8px;
          margin-top: 16px;
        }
        
        .step-actions {
          display: flex;
          justify-content: flex-end;
        }
      `}</style>
    </div>
  );
}
