/**
 * 开发工具面板
 *
 * 仅在开发模式下加载，提供：
 * - 重置初始化状态（重新显示设置向导）
 * - 清除登录状态
 * - 清除全部数据并刷新
 * - 查看应用存储数据
 * - MCP Proxy 服务管理（仅开发可见，不对正式用户开放）
 * - SetupDependencies UI 测试
 */

import { useState } from 'react';
import { Button, Modal, Tag, message } from 'antd';
import {
  ReloadOutlined,
  DeleteOutlined,
  ClearOutlined,
  DatabaseOutlined,
  ExperimentOutlined,
} from '@ant-design/icons';
import { setupService } from '../../services/core/setup';
import MCPSettings from '../settings/MCPSettings';
import SetupDependenciesTest from './SetupDependenciesTest';
import SetupWizardTest from './SetupWizardTest';

export default function DevToolsPanel() {
  const [storeData, setStoreData] = useState<Record<string, unknown> | null>(null);
  const [storeModalVisible, setStoreModalVisible] = useState(false);
  const [setupDepsTestVisible, setSetupDepsTestVisible] = useState(false);
  const [setupWizardTestVisible, setSetupWizardTestVisible] = useState(false);

  // 重置初始化
  const handleResetSetup = async () => {
    try {
      await setupService.resetSetup();
      message.success('初始化状态已重置，刷新页面后将重新显示设置向导');
    } catch {
      message.error('重置失败');
    }
  };

  // 清除登录
  const handleClearAuth = async () => {
    try {
      await window.electronAPI?.settings.set('auth.username', null);
      await window.electronAPI?.settings.set('auth.password', null);
      await window.electronAPI?.settings.set('auth.config_key', null);
      await window.electronAPI?.settings.set('auth.user_info', null);
      await window.electronAPI?.settings.set('auth.online_status', null);
      message.success('登录状态已清除');
    } catch {
      message.error('清除失败');
    }
  };

  // 清除全部并刷新
  const handleClearAll = () => {
    Modal.confirm({
      title: '清除全部数据',
      content: '将重置初始化状态和登录信息，页面将自动刷新。确定继续？',
      okText: '清除并刷新',
      okType: 'danger',
      cancelText: '取消',
      onOk: async () => {
        try {
          await setupService.resetSetup();
          await window.electronAPI?.settings.set('auth.username', null);
          await window.electronAPI?.settings.set('auth.password', null);
          await window.electronAPI?.settings.set('auth.config_key', null);
          await window.electronAPI?.settings.set('auth.user_info', null);
          await window.electronAPI?.settings.set('auth.online_status', null);
          message.success('所有数据已清除，正在刷新...');
          setTimeout(() => window.location.reload(), 500);
        } catch {
          message.error('清除失败');
        }
      },
    });
  };

  // 查看存储数据
  const handleViewStore = async () => {
    try {
      const keys = [
        'setup_state',
        'step1_config',
        'anthropic_api_key',
        'app_settings',
        'agent_config',
        'mcp_config',
        'lanproxy_config',
        'auth.username',
        'auth.password',
        'auth.config_key',
        'auth.saved_key',
        'auth.user_info',
        'auth.online_status',
        'lanproxy.server_host',
        'lanproxy.server_port',
      ];

      const data: Record<string, unknown> = {};
      for (const key of keys) {
        const value = await window.electronAPI?.settings.get(key);
        if (value !== null && value !== undefined) {
          // 敏感字段脱敏
          if (key === 'auth.password' || key === 'anthropic_api_key') {
            data[key] = '******';
          } else {
            data[key] = value;
          }
        }
      }
      setStoreData(data);
      setStoreModalVisible(true);
    } catch {
      message.error('读取存储数据失败');
    }
  };

  return (
    <div>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          marginBottom: 10,
        }}
      >
        <span style={{ fontSize: 13, fontWeight: 500, color: '#18181b' }}>
          开发工具
        </span>
        <Tag color="orange" style={{ margin: 0, fontSize: 10 }}>DEV</Tag>
      </div>

      <div
        style={{
          border: '1px solid #e4e4e7',
          borderRadius: 8,
          background: '#fff',
        }}
      >
        {/* 重置初始化 */}
        <div style={rowStyle}>
          <div>
            <div style={{ fontSize: 13, color: '#18181b' }}>重置初始化</div>
            <div style={{ fontSize: 11, color: '#a1a1aa', marginTop: 1 }}>
              清除设置向导完成标记，刷新后重新显示向导
            </div>
          </div>
          <Button
            size="small"
            icon={<ReloadOutlined />}
            onClick={handleResetSetup}
          >
            重置
          </Button>
        </div>

        {/* 清除登录 */}
        <div style={rowStyle}>
          <div>
            <div style={{ fontSize: 13, color: '#18181b' }}>清除登录</div>
            <div style={{ fontSize: 11, color: '#a1a1aa', marginTop: 1 }}>
              清除用户名、密码、ConfigKey（保留 SavedKey）
            </div>
          </div>
          <Button
            size="small"
            icon={<ClearOutlined />}
            onClick={handleClearAuth}
          >
            清除
          </Button>
        </div>

        {/* 清除全部并刷新 */}
        <div style={rowStyle}>
          <div>
            <div style={{ fontSize: 13, color: '#18181b' }}>清除全部并刷新</div>
            <div style={{ fontSize: 11, color: '#a1a1aa', marginTop: 1 }}>
              重置初始化 + 清除登录，自动刷新页面
            </div>
          </div>
          <Button
            size="small"
            danger
            icon={<DeleteOutlined />}
            onClick={handleClearAll}
          >
            清除全部
          </Button>
        </div>

        {/* 查看存储数据 */}
        <div style={{ ...rowStyle, borderBottom: 'none' }}>
          <div>
            <div style={{ fontSize: 13, color: '#18181b' }}>存储数据</div>
            <div style={{ fontSize: 11, color: '#a1a1aa', marginTop: 1 }}>
              查看 SQLite 中的键值数据（敏感字段已脱敏）
            </div>
          </div>
          <Button
            size="small"
            icon={<DatabaseOutlined />}
            onClick={handleViewStore}
          >
            查看
          </Button>
        </div>
      </div>

      {/* MCP Proxy 服务管理：仅开发模式展示，不对正式用户开放 */}
      <div style={{ marginTop: 16 }}>
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            marginBottom: 10,
          }}
        >
          <span style={{ fontSize: 13, fontWeight: 500, color: '#18181b' }}>
            MCP Proxy 服务管理
          </span>
          <Tag color="orange" style={{ margin: 0, fontSize: 10 }}>DEV</Tag>
        </div>
        <div
          style={{
            border: '1px solid #e4e4e7',
            borderRadius: 8,
            background: '#fff',
            overflow: 'hidden',
          }}
        >
          <MCPSettings />
        </div>
      </div>

      {/* 存储数据弹窗 */}
      <Modal
        title="存储数据"
        open={storeModalVisible}
        onCancel={() => setStoreModalVisible(false)}
        footer={null}
        width={520}
      >
        {storeData && (
          <pre
            style={{
              fontSize: 11,
              background: '#f5f5f5',
              padding: 12,
              borderRadius: 6,
              maxHeight: 400,
              overflow: 'auto',
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-all',
            }}
          >
            {JSON.stringify(storeData, null, 2)}
          </pre>
        )}
      </Modal>

      {/* SetupDependencies UI 测试入口 */}
      <div style={{ marginTop: 16 }}>
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            marginBottom: 10,
          }}
        >
          <span style={{ fontSize: 13, fontWeight: 500, color: '#18181b' }}>
            UI 测试
          </span>
          <Tag color="purple" style={{ margin: 0, fontSize: 10 }}>TEST</Tag>
        </div>
        <div
          style={{
            border: '1px solid #e4e4e7',
            borderRadius: 8,
            background: '#fff',
            overflow: 'hidden',
          }}
        >
          <div style={{ ...rowStyle }}>
            <div>
              <div style={{ fontSize: 13, color: '#18181b' }}>初始化安装向导</div>
              <div style={{ fontSize: 11, color: '#a1a1aa', marginTop: 1 }}>
                测试 SetupDependencies 各阶段 UI 效果
              </div>
            </div>
            <Button
              size="small"
              icon={<ExperimentOutlined />}
              onClick={() => setSetupDepsTestVisible(true)}
            >
              测试
            </Button>
          </div>
          <div style={{ ...rowStyle, borderBottom: 'none' }}>
            <div>
              <div style={{ fontSize: 13, color: '#18181b' }}>完整初始化流程</div>
              <div style={{ fontSize: 11, color: '#a1a1aa', marginTop: 1 }}>
                测试依赖安装 + 配置 + 登录完整流程
              </div>
            </div>
            <Button
              size="small"
              type="primary"
              icon={<ExperimentOutlined />}
              onClick={() => setSetupWizardTestVisible(true)}
            >
              测试
            </Button>
          </div>
        </div>
      </div>

      {/* SetupDependencies 测试弹窗 */}
      <Modal
        title="SetupDependencies UI 测试"
        open={setupDepsTestVisible}
        onCancel={() => setSetupDepsTestVisible(false)}
        footer={null}
        width={680}
        styles={{
          body: {
            maxHeight: '70vh',
            overflow: 'auto',
            padding: 0,
          },
        }}
      >
        <SetupDependenciesTest />
      </Modal>

      {/* SetupWizardTest 测试弹窗 */}
      <Modal
        title="初始化向导完整流程测试"
        open={setupWizardTestVisible}
        onCancel={() => setSetupWizardTestVisible(false)}
        footer={null}
        width={800}
        styles={{
          body: {
            maxHeight: '80vh',
            overflow: 'auto',
            padding: 0,
          },
        }}
      >
        <SetupWizardTest />
      </Modal>
    </div>
  );
}

const rowStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  padding: '10px 14px',
  borderBottom: '1px solid #f4f4f5',
};
