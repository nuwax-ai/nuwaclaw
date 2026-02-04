/**
 * 日志查看器主组件
 * 整合工具栏、统计、日志列表
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { Card, Empty, Spin, Typography, Space } from 'antd';
import { 
  FileTextOutlined, 
  ReloadOutlined,
} from '@ant-design/icons';
import LogToolbar from './LogToolbar';
import LogStats from './LogStats';
import LogItem from './LogItem';
import { 
  LogEntry, 
  LogFilter, 
  LogStats as LogStatsType,
  getLogs, 
  getLogStats, 
  subscribeLogs,
  generateMockLogs,
} from '../services/logService';

const { Text } = Typography;

interface LogViewerProps {
  maxHeight?: number;
  showSource?: boolean;
  enableRealtime?: boolean;
  autoScrollDefault?: boolean;
}

export default function LogViewer({
  maxHeight = 500,
  showSource = true,
  enableRealtime = true,
  autoScrollDefault = true,
}: LogViewerProps) {
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [stats, setStats] = useState<LogStatsType>({
    total: 0,
    error: 0,
    warning: 0,
    success: 0,
    info: 0,
  });
  const [filter, setFilter] = useState<LogFilter>({ level: 'all' });
  const [loading, setLoading] = useState(false);
  const [autoScroll, setAutoScroll] = useState(autoScrollDefault);
  const listRef = useRef<HTMLDivElement>(null);
  const shouldAutoScroll = useRef(true);

  // 加载日志
  const loadLogs = useCallback(async () => {
    setLoading(true);
    try {
      const [logsData, statsData] = await Promise.all([
        getLogs(filter),
        getLogStats(),
      ]);
      setLogs(logsData);
      setStats(statsData);
    } catch (error) {
      console.error('加载日志失败:', error);
    } finally {
      setLoading(false);
    }
  }, [filter]);

  // 初始加载
  useEffect(() => {
    loadLogs();
  }, [loadLogs]);

  // 实时日志订阅
  useEffect(() => {
    if (!enableRealtime) return;

    const unsubscribe = subscribeLogs((newLog: LogEntry) => {
      setLogs(prev => {
        const updated = [newLog, ...prev];
        return updated.slice(0, 1000); // 限制最多显示1000条
      });

      setStats(prev => ({
        ...prev,
        total: prev.total + 1,
        [newLog.level]: prev[newLog.level as keyof LogStatsType] + 1,
      }));
    });

    return () => unsubscribe();
  }, [enableRealtime]);

  // 自动滚动
  useEffect(() => {
    if (autoScroll && shouldAutoScroll.current) {
      listRef.current?.scrollTo({ top: 0, behavior: 'smooth' });
    }
  }, [logs, autoScroll]);

  // 处理过滤变更
  const handleFilterChange = useCallback((newFilter: LogFilter) => {
    setFilter(newFilter);
  }, []);

  // 处理刷新
  const handleRefresh = useCallback(() => {
    loadLogs();
  }, [loadLogs]);

  // 处理自动滚动变更
  const handleAutoScrollChange = useCallback((value: boolean) => {
    setAutoScroll(value);
    shouldAutoScroll.current = value;
  }, []);

  // 处理级别点击过滤
  const handleLevelClick = useCallback((level: string) => {
    setFilter(prev => ({
      ...prev,
      level: level === prev.level ? 'all' : level,
    }));
  }, []);

  // 处理复制
  const handleCopy = useCallback((message: string) => {
    navigator.clipboard.writeText(message);
  }, []);

  // 生成模拟数据（用于测试）
  const handleGenerateMock = useCallback(() => {
    generateMockLogs(50);
    loadLogs();
  }, [loadLogs]);

  return (
    <Card
      title={
        <Space>
          <FileTextOutlined />
          <span>操作日志</span>
          <Text type="secondary" style={{ fontSize: 12 }}>
            ({stats.total} 条)
          </Text>
        </Space>
      }
      extra={
        <Space>
          <Tooltip title="刷新" onClick={handleRefresh}>
            <ReloadOutlined spin={loading} style={{ cursor: 'pointer', fontSize: 16 }} />
          </Tooltip>
        </Space>
      }
      style={{ height: '100%' }}
    >
      {/* 工具栏 */}
      <LogToolbar
        filter={filter}
        onFilterChange={handleFilterChange}
        onRefresh={handleRefresh}
        autoScroll={autoScroll}
        onAutoScrollChange={handleAutoScrollChange}
      />

      {/* 统计信息 */}
      <div style={{ marginBottom: 16 }}>
        <LogStats
          stats={stats}
          currentFilter={filter.level}
          onFilterClick={handleLevelClick}
        />
      </div>

      {/* 日志列表 */}
      <div
        ref={listRef}
        style={{
          maxHeight: maxHeight,
          overflow: 'auto',
          padding: '8px 12px',
          background: '#fafafa',
          borderRadius: 4,
          border: '1px solid #f0f0f0',
        }}
      >
        {loading && logs.length === 0 ? (
          <div style={{ textAlign: 'center', padding: 40 }}>
            <Spin tip="加载中..." />
          </div>
        ) : logs.length === 0 ? (
          <Empty 
            description="暂无日志" 
            image={Empty.PRESENTED_IMAGE_SIMPLE}
          >
            <Button type="link" onClick={handleGenerateMock}>
              生成模拟数据
            </Button>
          </Empty>
        ) : (
          <div className="log-list">
            {logs.map(log => (
              <LogItem
                key={log.id}
                log={log}
                showSource={showSource}
                onCopy={handleCopy}
              />
            ))}
          </div>
        )}
      </div>
    </Card>
  );
}

// 引入 Tooltip
import { Tooltip, Button, Empty } from 'antd';
