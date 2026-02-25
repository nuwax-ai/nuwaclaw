/**
 * LogViewer - 日志查看器 (Electron 版)
 *
 * 从 Tauri 客户端 LogViewerWithBackend 简化移植：
 * - 日志列表显示（时间戳 + 级别 + 消息）
 * - 级别筛选（All/Info/Warn/Error）
 * - 自动滚动开关
 * - 刷新按钮
 */

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Button, Select, Switch, Empty, Spin, Tag } from 'antd';
import { ReloadOutlined, VerticalAlignBottomOutlined } from '@ant-design/icons';

interface LogEntry {
  timestamp: string;
  level: string;
  message: string;
}

const LEVEL_COLORS: Record<string, string> = {
  error: '#ef4444',
  warn: '#f59e0b',
  info: '#3b82f6',
  debug: '#a1a1aa',
};

const LEVEL_TAG_COLORS: Record<string, string> = {
  error: 'red',
  warn: 'orange',
  info: 'blue',
  debug: 'default',
};

export default function LogViewer() {
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [levelFilter, setLevelFilter] = useState<string>('all');
  const [autoScroll, setAutoScroll] = useState(true);
  const listRef = useRef<HTMLDivElement>(null);

  const fetchLogs = useCallback(async () => {
    try {
      const result = await window.electronAPI?.log?.list(500);
      if (result) {
        setLogs(result);
      }
    } catch (error) {
      console.error('[LogViewer] Failed to fetch logs:', error);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchLogs();
    const timer = setInterval(fetchLogs, 5000);
    return () => clearInterval(timer);
  }, [fetchLogs]);

  useEffect(() => {
    if (autoScroll && listRef.current) {
      listRef.current.scrollTop = listRef.current.scrollHeight;
    }
  }, [logs, autoScroll]);

  const handleRefresh = () => {
    setLoading(true);
    fetchLogs();
  };

  const handleOpenDir = async () => {
    await window.electronAPI?.log?.openDir();
  };

  const filteredLogs = levelFilter === 'all'
    ? logs
    : logs.filter((l) => l.level === levelFilter);

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
        <span style={{ fontSize: 13, fontWeight: 500, color: '#18181b' }}>
          应用日志
        </span>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <span style={{ fontSize: 12, color: '#71717a' }}>自动滚动</span>
          <Switch
            size="small"
            checked={autoScroll}
            onChange={setAutoScroll}
          />
          <Select
            size="small"
            value={levelFilter}
            onChange={setLevelFilter}
            style={{ width: 90 }}
            options={[
              { label: '全部', value: 'all' },
              { label: 'Error', value: 'error' },
              { label: 'Warn', value: 'warn' },
              { label: 'Info', value: 'info' },
              { label: 'Debug', value: 'debug' },
            ]}
          />
          <Button
            size="small"
            icon={<ReloadOutlined />}
            onClick={handleRefresh}
            loading={loading}
          >
            刷新
          </Button>
          <Button size="small" onClick={handleOpenDir}>
            打开目录
          </Button>
        </div>
      </div>

      {/* Log list */}
      <div
        style={{
          border: '1px solid #e4e4e7',
          borderRadius: 8,
          background: '#18181b',
          overflow: 'hidden',
        }}
      >
        {loading && logs.length === 0 ? (
          <div style={{ textAlign: 'center', padding: 40 }}>
            <Spin size="small" />
          </div>
        ) : filteredLogs.length === 0 ? (
          <div style={{ padding: 40 }}>
            <Empty
              description="暂无日志"
              image={Empty.PRESENTED_IMAGE_SIMPLE}
            />
          </div>
        ) : (
          <div
            ref={listRef}
            style={{
              height: 480,
              overflowY: 'auto',
              padding: '8px 0',
              fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
              fontSize: 12,
              lineHeight: 1.7,
            }}
          >
            {filteredLogs.map((entry, idx) => (
              <div
                key={idx}
                style={{
                  padding: '1px 12px',
                  display: 'flex',
                  gap: 8,
                  alignItems: 'flex-start',
                }}
              >
                <span style={{ color: '#71717a', flexShrink: 0 }}>
                  {entry.timestamp}
                </span>
                <Tag
                  color={LEVEL_TAG_COLORS[entry.level] || 'default'}
                  style={{
                    margin: 0,
                    fontSize: 10,
                    lineHeight: '18px',
                    flexShrink: 0,
                  }}
                >
                  {entry.level.toUpperCase()}
                </Tag>
                <span
                  style={{
                    color: LEVEL_COLORS[entry.level] || '#e4e4e7',
                    wordBreak: 'break-all',
                  }}
                >
                  {entry.message}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Footer */}
      <div
        style={{
          marginTop: 8,
          display: 'flex',
          justifyContent: 'space-between',
          fontSize: 11,
          color: '#a1a1aa',
        }}
      >
        <span>共 {filteredLogs.length} 条日志</span>
        {autoScroll && (
          <span>
            <VerticalAlignBottomOutlined style={{ marginRight: 4 }} />
            自动滚动已开启
          </span>
        )}
      </div>
    </div>
  );
}
