/**
 * PermissionsPage - 系统授权页面 (Electron 版, 仅 macOS)
 *
 * 从 Tauri 客户端 PermissionsPage 简化移植：
 * - 权限列表：全磁盘访问、辅助功能、屏幕录制
 * - 每项显示状态（已授权/未授权）
 * - "前往设置"按钮
 */

import React, { useState, useEffect, useCallback } from 'react';
import { Button, Tag, Spin, message } from 'antd';
import {
  CheckCircleOutlined,
  CloseCircleOutlined,
  QuestionCircleOutlined,
  ReloadOutlined,
  SafetyOutlined,
  SettingOutlined,
} from '@ant-design/icons';

interface PermissionItem {
  key: string;
  name: string;
  description: string;
  status: 'granted' | 'denied' | 'unknown';
}

const STATUS_ICON: Record<string, React.ReactNode> = {
  granted: <CheckCircleOutlined style={{ color: '#16a34a', fontSize: 16 }} />,
  denied: <CloseCircleOutlined style={{ color: '#ef4444', fontSize: 16 }} />,
  unknown: <QuestionCircleOutlined style={{ color: '#a1a1aa', fontSize: 16 }} />,
};

const STATUS_TAG: Record<string, { color: string; text: string }> = {
  granted: { color: 'green', text: '已授权' },
  denied: { color: 'red', text: '未授权' },
  unknown: { color: 'default', text: '未知' },
};

export default function PermissionsPage() {
  const [permissions, setPermissions] = useState<PermissionItem[]>([]);
  const [loading, setLoading] = useState(true);

  const checkPermissions = useCallback(async () => {
    try {
      const result = await window.electronAPI?.permissions?.check();
      if (result) {
        setPermissions(result);
      }
    } catch (error) {
      console.error('[PermissionsPage] Check failed:', error);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    checkPermissions();
  }, [checkPermissions]);

  const handleOpenSettings = async (key: string) => {
    try {
      await window.electronAPI?.permissions?.openSettings(key);
      // Poll for changes after user opens settings
      const timer = setInterval(async () => {
        await checkPermissions();
      }, 2000);
      setTimeout(() => clearInterval(timer), 30000);
    } catch {
      message.error('无法打开系统设置');
    }
  };

  const handleRefresh = () => {
    setLoading(true);
    checkPermissions();
  };

  const grantedCount = permissions.filter((p) => p.status === 'granted').length;
  const totalCount = permissions.length;

  if (loading && permissions.length === 0) {
    return (
      <div style={{ textAlign: 'center', padding: 40 }}>
        <Spin size="small" />
      </div>
    );
  }

  return (
    <div>
      {/* Header */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          marginBottom: 12,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 13, fontWeight: 500, color: '#18181b' }}>
            系统授权
          </span>
          {totalCount > 0 && (
            <Tag color={grantedCount === totalCount ? 'green' : 'orange'}>
              {grantedCount}/{totalCount}
            </Tag>
          )}
        </div>
        <Button
          size="small"
          icon={<ReloadOutlined />}
          onClick={handleRefresh}
          loading={loading}
        >
          刷新
        </Button>
      </div>

      <div style={{ fontSize: 12, color: '#71717a', marginBottom: 16 }}>
        以下权限可能影响应用的正常运行，请根据需要授权。
      </div>

      {/* Permission list */}
      <div
        style={{
          border: '1px solid #e4e4e7',
          borderRadius: 8,
          background: '#fff',
          overflow: 'hidden',
        }}
      >
        {permissions.map((perm, idx) => (
          <div
            key={perm.key}
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              padding: '12px 16px',
              borderBottom: idx < permissions.length - 1 ? '1px solid #f4f4f5' : 'none',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              {STATUS_ICON[perm.status]}
              <div>
                <div style={{ fontSize: 13, color: '#18181b', fontWeight: 500 }}>
                  {perm.name}
                </div>
                <div style={{ fontSize: 11, color: '#a1a1aa', marginTop: 2 }}>
                  {perm.description}
                </div>
              </div>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <Tag
                color={STATUS_TAG[perm.status]?.color || 'default'}
                style={{ margin: 0, fontSize: 11 }}
              >
                {STATUS_TAG[perm.status]?.text || '未知'}
              </Tag>
              {perm.status !== 'granted' && (
                <Button
                  size="small"
                  icon={<SettingOutlined />}
                  onClick={() => handleOpenSettings(perm.key)}
                >
                  前往设置
                </Button>
              )}
            </div>
          </div>
        ))}
      </div>

      {grantedCount === totalCount && totalCount > 0 && (
        <div
          style={{
            marginTop: 16,
            padding: '10px 14px',
            background: '#f0fdf4',
            border: '1px solid #bbf7d0',
            borderRadius: 8,
            fontSize: 12,
            color: '#16a34a',
            display: 'flex',
            alignItems: 'center',
            gap: 6,
          }}
        >
          <CheckCircleOutlined />
          所有权限已授权
        </div>
      )}
    </div>
  );
}
