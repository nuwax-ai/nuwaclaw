/**
 * 初始化向导 - 步骤3: 依赖安装
 * 
 * 功能:
 * - 检测 Node.js 版本 (>= 22.0.0)
 * - 检测 uv 版本 (>= 0.5.0)
 * - 安装本地 npm 包
 * - 显示完整依赖列表和安装进度
 * - 所有依赖就绪后自动跳转到客户端页面
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
  Card,
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
  FolderOutlined,
  ThunderboltOutlined,
  AppstoreOutlined,
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

const { Title, Text } = Typography;

interface SetupStep3Props {
  /** 完成回调 */
  onComplete: () => void;
}

// 安装阶段
type InstallPhase = 'checking' | 'system-deps-missing' | 'ready' | 'installing' | 'completed' | 'error';

// 统一的依赖项接口（用于完整列表展示）
interface UnifiedDependencyItem {
  name: string;
  displayName: string;
  type: 'system' | 'npm-local';
  description: string;
  status: 'checking' | 'installed' | 'missing' | 'outdated' | 'installing' | 'error';
  version?: string;
  requiredVersion?: string;
  errorMessage?: string;
  installUrl?: string;
  installCommand?: string;
}

/**
 * 步骤3: 依赖安装组件
 */
export default function SetupStep3({ onComplete }: SetupStep3Props) {
  // 统一的依赖列表（系统依赖 + npm 包）
  const [allDependencies, setAllDependencies] = useState<UnifiedDependencyItem[]>([]);
  
  // Node.js 状态（用于逻辑判断）
  const [nodeResult, setNodeResult] = useState<NodeVersionResult | null>(null);
  
  // uv 状态（用于逻辑判断）
  const [uvResult, setUvResult] = useState<UvVersionResult | null>(null);
  
  // npm 依赖状态
  const [npmDependencies, setNpmDependencies] = useState<LocalDependencyItem[]>([]);
  
  // 安装阶段
  const [installPhase, setInstallPhase] = useState<InstallPhase>('checking');
  const [installProgress, setInstallProgress] = useState(0);
  const [currentInstalling, setCurrentInstalling] = useState<string>('');
  const [installError, setInstallError] = useState<string>('');
  
  // 应用目录
  const [appDir, setAppDir] = useState<string>('');
  const [showAllDependencies, setShowAllDependencies] = useState(false);

  /**
   * 构建统一的依赖列表
   * 将系统依赖和 npm 依赖合并到一个列表中展示
   */
  const buildUnifiedDependencies = useCallback((
    nodeRes: NodeVersionResult | null,
    uvRes: UvVersionResult | null,
    npmDeps: LocalDependencyItem[]
  ): UnifiedDependencyItem[] => {
    const unified: UnifiedDependencyItem[] = [];
    
    // 1. Node.js 系统依赖
    const nodeStatus = !nodeRes 
      ? 'checking' 
      : nodeRes.installed 
        ? (nodeRes.meetsRequirement ? 'installed' : 'outdated')
        : 'missing';
    
    unified.push({
      name: 'nodejs',
      displayName: 'Node.js',
      type: 'system',
      description: 'JavaScript 运行时环境',
      status: nodeStatus,
      version: nodeRes?.version,
      requiredVersion: '>= 22.0.0',
      installUrl: 'https://nodejs.org',
      errorMessage: nodeStatus === 'outdated' 
        ? `版本 ${nodeRes?.version} 低于要求的 22.0.0` 
        : undefined,
    });
    
    // 2. uv 系统依赖
    const uvStatus = !uvRes
      ? 'checking'
      : uvRes.installed
        ? (uvRes.meetsRequirement ? 'installed' : 'outdated')
        : 'missing';
    
    unified.push({
      name: 'uv',
      displayName: 'uv',
      type: 'system',
      description: '高性能 Python 包管理器',
      status: uvStatus,
      version: uvRes?.version,
      requiredVersion: '>= 0.5.0',
      installUrl: 'https://docs.astral.sh/uv/getting-started/installation/',
      installCommand: 'curl -LsSf https://astral.sh/uv/install.sh | sh',
      errorMessage: uvStatus === 'outdated'
        ? `版本 ${uvRes?.version} 低于要求的 0.5.0`
        : undefined,
    });
    
    // 3. npm 本地依赖
    npmDeps.forEach(dep => {
      unified.push({
        name: dep.name,
        displayName: dep.displayName,
        type: 'npm-local',
        description: dep.description,
        status: dep.status as UnifiedDependencyItem['status'],
        version: dep.version,
        requiredVersion: dep.minVersion ? `>= ${dep.minVersion}` : undefined,
        errorMessage: dep.errorMessage,
      });
    });
    
    return unified;
  }, []);

  /**
   * 检测所有依赖（系统依赖 + npm 包）
   */
  const checkAllDeps = useCallback(async () => {
    setInstallPhase('checking');
    
    // 初始化统一列表（检测中状态）
    setAllDependencies([
      {
        name: 'nodejs',
        displayName: 'Node.js',
        type: 'system',
        description: 'JavaScript 运行时环境',
        status: 'checking',
        requiredVersion: '>= 22.0.0',
      },
      {
        name: 'uv',
        displayName: 'uv',
        type: 'system',
        description: '高性能 Python 包管理器',
        status: 'checking',
        requiredVersion: '>= 0.5.0',
      },
    ]);
    
    try {
      // 并行检测系统依赖
      const [nodeRes, uvRes] = await Promise.all([
        checkNodeVersion(),
        checkUvVersion(),
      ]);
      
      setNodeResult(nodeRes);
      setUvResult(uvRes);
      
      const nodeReady = nodeRes.installed && nodeRes.meetsRequirement;
      const uvReady = uvRes.installed && uvRes.meetsRequirement;
      
      // 获取 npm 依赖列表
      const deps = await checkAllSetupDependencies();
      const npmDeps = deps.filter(d => d.type === 'npm-local');
      setNpmDependencies(npmDeps);
      
      // 构建统一列表
      const unified = buildUnifiedDependencies(nodeRes, uvRes, npmDeps);
      setAllDependencies(unified);
      
      // 判断系统依赖是否满足
      if (!nodeReady || !uvReady) {
        setInstallPhase('system-deps-missing');
        return;
      }
      
      // 检查所有依赖是否已就绪
      const allReady = unified.every(d => d.status === 'installed');
      if (allReady) {
        // 所有依赖都已安装，直接完成
        setInstallPhase('completed');
        setTimeout(() => {
          onComplete();
        }, 1500);
      } else {
        setInstallPhase('ready');
      }
    } catch (error) {
      console.error('[SetupStep3] 检测依赖失败:', error);
      setInstallPhase('error');
      setInstallError('检测依赖状态失败');
    }
  }, [buildUnifiedDependencies, onComplete]);

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
    checkAllDeps();
  }, [checkAllDeps, loadAppDir]);

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
   * 重新检测所有依赖
   */
  const handleRetryCheck = async () => {
    await checkAllDeps();
  };

  /**
   * 开始安装依赖
   * 逐个安装 npm 包，实时更新统一依赖列表的状态
   */
  const handleStartInstall = async () => {
    setInstallPhase('installing');
    setInstallProgress(0);
    setInstallError('');
    
    try {
      // 获取需要安装的 npm 包列表（状态不是 installed 的）
      const npmPackages = npmDependencies.filter(d => d.status !== 'installed');
      const total = npmPackages.length;
      
      if (total === 0) {
        // 没有需要安装的包
        setInstallProgress(100);
        setInstallPhase('completed');
        setTimeout(() => {
          onComplete();
        }, 1500);
        return;
      }
      
      // 初始化 npm 环境
      await initLocalNpmEnv();
      
      // 依次安装每个包
      for (let i = 0; i < npmPackages.length; i++) {
        const pkg = npmPackages[i];
        setCurrentInstalling(pkg.displayName);
        setInstallProgress(Math.round((i / total) * 100));
        
        // 更新统一列表中当前包状态为 installing
        setAllDependencies(prev => prev.map(d => 
          d.name === pkg.name ? { ...d, status: 'installing' as const } : d
        ));
        
        // 检查是否已安装
        const checkResult = await checkLocalNpmPackage(pkg.name);
        if (checkResult.installed) {
          // 已安装，更新状态
          setAllDependencies(prev => prev.map(d => 
            d.name === pkg.name 
              ? { ...d, status: 'installed' as const, version: checkResult.version }
              : d
          ));
          continue;
        }
        
        // 安装包
        const installResult = await installLocalNpmPackage(pkg.name);
        if (installResult.success) {
          // 安装成功，更新状态
          setAllDependencies(prev => prev.map(d => 
            d.name === pkg.name 
              ? { ...d, status: 'installed' as const, version: installResult.version }
              : d
          ));
        } else {
          // 安装失败
          setAllDependencies(prev => prev.map(d => 
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
      
      // 自动触发完成回调（调用 restart_all_services，然后跳转到客户端页面）
      setTimeout(() => {
        onComplete();
      }, 1500);
      
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
  const getStatusIcon = (item: UnifiedDependencyItem) => {
    // 类型图标
    if (item.type === 'system') {
      if (item.name === 'nodejs') {
        return <NodeIndexOutlined style={{ color: item.status === 'installed' ? '#52c41a' : '#faad14' }} />;
      }
      if (item.name === 'uv') {
        return <ThunderboltOutlined style={{ color: item.status === 'installed' ? '#52c41a' : '#faad14' }} />;
      }
    }
    
    // 状态图标
    switch (item.status) {
      case 'installed':
        return <CheckCircleOutlined style={{ color: '#52c41a' }} />;
      case 'missing':
        return <ExclamationCircleOutlined style={{ color: '#faad14' }} />;
      case 'outdated':
        return <ExclamationCircleOutlined style={{ color: '#fa8c16' }} />;
      case 'installing':
        return <LoadingOutlined style={{ color: '#1890ff' }} />;
      case 'error':
        return <CloseCircleOutlined style={{ color: '#ff4d4f' }} />;
      case 'checking':
      default:
        return <LoadingOutlined style={{ color: '#1890ff' }} />;
    }
  };

  /**
   * 获取状态标签
   */
  const getStatusTag = (item: UnifiedDependencyItem) => {
    const config: Record<string, { color: string; text: string }> = {
      installed: { color: 'success', text: '已就绪' },
      missing: { color: 'warning', text: '未安装' },
      outdated: { color: 'orange', text: '版本过低' },
      installing: { color: 'processing', text: '安装中' },
      checking: { color: 'default', text: '检测中' },
      error: { color: 'error', text: '错误' },
    };
    const c = config[item.status] || config.checking;
    return <Tag color={c.color}>{c.text}</Tag>;
  };

  /**
   * 获取类型标签
   */
  const getTypeTag = (item: UnifiedDependencyItem) => {
    if (item.type === 'system') {
      return <Tag color="blue">系统依赖</Tag>;
    }
    return <Tag color="purple">npm 包</Tag>;
  };

  /**
   * 计算依赖统计信息
   */
  const getDependencyStats = () => {
    const total = allDependencies.length;
    const ready = allDependencies.filter(d => d.status === 'installed').length;
    const systemDeps = allDependencies.filter(d => d.type === 'system');
    const systemReady = systemDeps.filter(d => d.status === 'installed').length;
    const npmDeps = allDependencies.filter(d => d.type === 'npm-local');
    const npmReady = npmDeps.filter(d => d.status === 'installed').length;
    
    // 只有当有依赖项且都已安装时才算全部就绪
    const allReady = total > 0 && total === ready;
    const systemAllReady = systemDeps.length > 0 && systemDeps.length === systemReady;
    
    return {
      total,
      ready,
      systemTotal: systemDeps.length,
      systemReady,
      npmTotal: npmDeps.length,
      npmReady,
      allReady,
      systemAllReady,
    };
  };

  const stats = getDependencyStats();

  /**
   * 渲染完整依赖列表（系统依赖 + npm 包）
   */
  const renderDependencyList = () => (
    <Card 
      size="small"
      title={
        <Space>
          <AppstoreOutlined />
          <span>依赖清单</span>
          <Tag color={stats.allReady ? 'success' : 'processing'}>
            {stats.ready}/{stats.total}
          </Tag>
        </Space>
      }
      extra={
        <Button
          type="link"
          size="small"
          onClick={() => setShowAllDependencies(prev => !prev)}
        >
          {showAllDependencies ? '仅显示问题' : '展开全部'}
        </Button>
      }
      style={{ marginBottom: 12 }}
    >
      <List
        size="small"
        dataSource={
          showAllDependencies
            ? allDependencies
            : allDependencies.filter(item => item.status !== 'installed')
        }
        locale={{ emptyText: '暂无问题项' }}
        renderItem={(item) => {
          const isSystemDep = item.type === 'system';
          const needsAction = item.status === 'missing' || item.status === 'outdated';
          const isProblem = item.status !== 'installed';
          
          return (
            <List.Item
              style={{
                background: item.status === 'installed' ? '#f6ffed' : 
                           item.status === 'error' ? '#fff2f0' :
                           item.status === 'installing' ? '#e6f7ff' : '#fffbe6',
                borderRadius: 6,
                marginBottom: 6,
                padding: '8px 12px',
              }}
              actions={[
                getStatusTag(item),
                // 系统依赖显示安装链接
                isSystemDep && needsAction && item.installUrl && (
                  <Button 
                    size="small" 
                    type="link"
                    icon={<LinkOutlined />}
                    onClick={() => openUrl(item.installUrl!)}
                  >
                    安装说明
                  </Button>
                ),
              ].filter(Boolean)}
            >
              <List.Item.Meta
                avatar={getStatusIcon(item)}
                title={
                  <Space>
                    <Text strong>{item.displayName}</Text>
                    {getTypeTag(item)}
                    {item.version && (
                      <Text type="secondary" style={{ fontSize: 12 }}>
                        v{item.version}
                      </Text>
                    )}
                  </Space>
                }
                description={
                  isProblem ? (
                    <Space direction="vertical" size={2}>
                      <Text type="secondary" style={{ fontSize: 12 }}>
                        {item.description}
                        {item.requiredVersion && (
                          <span> (要求 {item.requiredVersion})</span>
                        )}
                      </Text>
                      {/* 系统依赖的安装命令 */}
                      {isSystemDep && needsAction && item.installCommand && (
                        <Text code copyable style={{ fontSize: 11 }}>
                          {item.installCommand}
                        </Text>
                      )}
                      {/* 错误信息 */}
                      {item.errorMessage && (
                        <Text type="danger" style={{ fontSize: 12 }}>
                          {item.errorMessage}
                        </Text>
                      )}
                    </Space>
                  ) : (
                    <Text type="secondary" style={{ fontSize: 12 }}>
                      已就绪
                    </Text>
                  )
                }
              />
            </List.Item>
          );
        }}
      />
    </Card>
  );

  /**
   * 渲染安装进度
   */
  const renderInstallProgress = () => (
    <div className="install-progress compact-status">
      <Space size={8} align="center">
        <Spin size="small" />
        <Text>
          {currentInstalling ? `正在安装 ${currentInstalling}` : '准备安装'}
        </Text>
      </Space>
      <Progress
        size="small"
        percent={installProgress}
        status={installPhase === 'error' ? 'exception' : 'active'}
        style={{ marginTop: 6 }}
      />
    </div>
  );

  /**
   * 渲染主内容
   */
  const renderContent = () => {
    // 检测中
    if (installPhase === 'checking') {
      return (
        <div className="compact-status">
          <Space size={8} align="center">
            <Spin size="small" />
            <Text>正在检测依赖环境...</Text>
          </Space>
        </div>
      );
    }

    // 安装完成
    if (installPhase === 'completed') {
      return (
        <>
          {/* 显示完整依赖列表（全部已就绪） */}
          {renderDependencyList()}
          
          <Result
            icon={<CheckCircleOutlined style={{ color: '#52c41a' }} />}
            title="所有依赖已就绪"
            subTitle="正在启动服务，即将进入客户端页面..."
            extra={<Spin size="large" />}
          />
        </>
      );
    }

    // 安装错误
    if (installPhase === 'error') {
      return (
        <>
          {/* 显示依赖列表（含错误状态） */}
          {renderDependencyList()}
          
          <Alert
            message="安装失败"
            description={installError}
            type="error"
            showIcon
            style={{ marginBottom: 12 }}
          />
          
          <div className="step-actions">
            <Space>
              <Button type="primary" onClick={handleRetryInstall}>
                重试安装
              </Button>
              <Button onClick={handleRetryCheck}>
                重新检测
              </Button>
            </Space>
          </div>
        </>
      );
    }

    // 系统依赖未就绪 或 准备安装
    return (
      <>
        {/* 统计信息 */}
          <Alert
            message={
              <Space>
                <span>依赖检测结果</span>
                <Tag color={stats.systemAllReady ? 'success' : 'warning'}>
                系统依赖 {stats.systemReady}/{stats.systemTotal}
              </Tag>
              <Tag color={stats.npmReady === stats.npmTotal ? 'success' : 'processing'}>
                npm 包 {stats.npmReady}/{stats.npmTotal}
              </Tag>
            </Space>
          }
          description={
            !stats.systemAllReady 
              ? '请先安装所有系统依赖，然后点击"重新检测"继续'
              : stats.allReady
                ? '所有依赖已就绪'
                : '系统依赖已就绪，点击"开始安装"安装 npm 包'
          }
          type={stats.systemAllReady ? (stats.allReady ? 'success' : 'info') : 'warning'}
          showIcon
          style={{ marginBottom: 12 }}
        />

        {/* 安装目录提示 */}
        {appDir && stats.systemAllReady && (
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
            style={{ marginBottom: 12 }}
          />
        )}

        {/* 完整依赖列表 */}
        {renderDependencyList()}

        {/* 安装进度 */}
        {installPhase === 'installing' && renderInstallProgress()}

        {/* 操作按钮 */}
        <Divider />
        <div className="step-actions">
          <Space>
            <Button
              icon={<ReloadOutlined />}
              onClick={handleRetryCheck}
            >
              重新检测
            </Button>
            {/* 只有系统依赖都就绪才能安装 npm 包 */}
            {stats.systemAllReady && !stats.allReady && installPhase !== 'installing' && (
              <Button
                type="primary"
                icon={<CloudDownloadOutlined />}
                onClick={handleStartInstall}
                size="middle"
              >
                开始安装 ({stats.npmTotal - stats.npmReady} 个)
              </Button>
            )}
          </Space>
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
          检测并安装运行所需的系统依赖和 npm 包
        </Text>
      </div>

      <Divider />

      {renderContent()}

      {/* 内联样式 */}
      <style>{`
        .setup-step3 {
          padding: 8px 0;
        }
        
        .step-header {
          margin-bottom: 6px;
        }
        
        .step-header .ant-typography {
          margin-bottom: 2px;
        }
        
        .step-loading {
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          padding: 36px 0;
        }
        
        .install-progress {
          padding: 8px 10px;
          background: #f5f5f5;
          border-radius: 8px;
          margin-top: 10px;
        }

        .compact-status {
          padding: 8px 10px;
          background: #f5f5f5;
          border-radius: 8px;
          margin-bottom: 12px;
          font-size: 12px;
        }
        
        .step-actions {
          display: flex;
          justify-content: flex-end;
        }

        .setup-step3 .ant-divider {
          margin: 12px 0;
        }
      `}</style>
    </div>
  );
}
