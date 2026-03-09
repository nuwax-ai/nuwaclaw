/**
 * LogViewer - 日志查看器 (Electron 版)
 *
 * - 日志列表（时间戳 + 级别 + 消息）、级别筛选、自动滚动、刷新
 * - 向上滚动到顶部时自动加载更早的日志（分页，保持滚动位置）
 */

import React, { useState, useEffect, useRef, useCallback, useLayoutEffect } from 'react';
import { Button, Select, Switch, Empty, Spin, Tag } from 'antd';
import { ReloadOutlined, VerticalAlignBottomOutlined } from '@ant-design/icons';
import styles from '../../styles/components/ClientPage.module.css';

interface LogEntry {
  timestamp: string;
  level: string;
  message: string;
}

const LEVEL_TAG_COLORS: Record<string, string> = {
  error: 'red',
  warn: 'orange',
  info: 'blue',
  debug: 'default',
};

/** 每页条数，与主进程默认一致 */
const PAGE_SIZE = 2000;
/** 距顶部多少 px 时触发加载更多 */
const LOAD_MORE_THRESHOLD = 80;

export default function LogViewer() {
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const [levelFilter, setLevelFilter] = useState<string>('all');
  const [autoScroll, setAutoScroll] = useState(true);
  const listRef = useRef<HTMLDivElement>(null);
  /** prepend 后用于恢复滚动位置 */
  const scrollRestoreRef = useRef<{ height: number; top: number } | null>(null);
  /** 标记是否正在加载更早日志（prepend 模式，不触发自动滚动） */
  const isLoadingOlderRef = useRef(false);

  /** 首次加载或刷新：取最新一页 */
  const fetchLogs = useCallback(async () => {
    try {
      const result = await window.electronAPI?.log?.list(PAGE_SIZE, 0);
      if (result) {
        setLogs(result);
        setHasMore(result.length >= PAGE_SIZE);
      }
    } catch (error) {
      console.error('[LogViewer] Failed to fetch logs:', error);
    } finally {
      setLoading(false);
    }
  }, []);

  /** 向上加载更早的一页，prepend 并保持滚动位置 */
  const loadMore = useCallback(async () => {
    if (loadingMore || !hasMore) return;
    const el = listRef.current;
    if (!el) return;
    setLoadingMore(true);
    isLoadingOlderRef.current = true; // 标记正在加载更早日志
    try {
      const offset = logs.length;
      const older = await window.electronAPI?.log?.list(PAGE_SIZE, offset);
      if (older && older.length > 0) {
        scrollRestoreRef.current = { height: el.scrollHeight, top: el.scrollTop };
        setLogs((prev) => [...older, ...prev]);
        setHasMore(older.length >= PAGE_SIZE);
      } else {
        setHasMore(false);
      }
    } catch (error) {
      console.error('[LogViewer] Load more failed:', error);
    } finally {
      setLoadingMore(false);
      // 延迟重置标记，让 useLayoutEffect 先完成滚动恢复
      setTimeout(() => {
        isLoadingOlderRef.current = false;
      }, 0);
    }
  }, [logs.length, hasMore, loadingMore]);

  useEffect(() => {
    fetchLogs();
    const timer = setInterval(fetchLogs, 5000);
    return () => clearInterval(timer);
  }, [fetchLogs]);

  /** prepend 后恢复滚动位置，避免列表跳动 */
  useLayoutEffect(() => {
    const ref = scrollRestoreRef.current;
    const el = listRef.current;
    if (!ref || !el) return;
    const diff = el.scrollHeight - ref.height;
    if (diff > 0) {
      el.scrollTop = ref.top + diff;
    }
    scrollRestoreRef.current = null;
  }, [logs]);

  /** 仅当新日志追加到底部时自动滚动（非 prepend 场景） */
  useEffect(() => {
    if (!autoScroll || !listRef.current) return;
    // 如果正在加载更早日志，跳过自动滚动
    if (isLoadingOlderRef.current) return;
    listRef.current.scrollTop = listRef.current.scrollHeight;
  }, [logs, autoScroll]);

  /** 滚动到顶时加载更多 */
  const handleScroll = useCallback(() => {
    const el = listRef.current;
    if (!el || autoScroll || loadingMore || !hasMore) return;
    if (el.scrollTop <= LOAD_MORE_THRESHOLD) {
      loadMore();
    }
  }, [autoScroll, loadingMore, hasMore, loadMore]);

  const handleRefresh = () => {
    setLoading(true);
    setHasMore(true);
    fetchLogs();
  };

  const handleOpenDir = async () => {
    await window.electronAPI?.log?.openDir();
  };

  const filteredLogs =
    levelFilter === 'all'
      ? logs
      : logs.filter((l) => l.level === levelFilter);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0, overflow: 'hidden' }}>
      {/* Header */}
      <div className={styles.section} style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0, marginBottom: 0 }}>
        <div className={styles.servicesHeader}>
          <div className={styles.servicesHeaderLeft}>
            <span className={styles.sectionTitle}>应用日志</span>
            <span style={{ fontSize: 12, color: 'var(--color-text-secondary)' }}>自动滚动</span>
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
          </div>
          <div className={styles.servicesHeaderActions}>
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

        {/* Log list：占满剩余高度，无日志时空状态也撑满 */}
        <div
          style={{
            flex: 1,
            minHeight: 0,
            overflow: 'hidden',
            display: 'flex',
            flexDirection: 'column',
          }}
        >
          {loading && logs.length === 0 ? (
            <div
              style={{
                flex: 1,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <Spin size="small" />
            </div>
          ) : filteredLogs.length === 0 ? (
            <div
              style={{
                flex: 1,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <Empty
                description="暂无日志"
                image={Empty.PRESENTED_IMAGE_SIMPLE}
              />
            </div>
          ) : (
            <div
              ref={listRef}
              onScroll={handleScroll}
              style={{
                flex: 1,
                minHeight: 0,
                overflowY: 'auto',
                padding: '8px 0',
                fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
                fontSize: 12,
                lineHeight: 1.7,
                background: 'var(--color-bg-container)',
              }}
            >
              {hasMore && (
                <div
                  style={{
                    padding: '8px 12px',
                    color: 'var(--color-text-tertiary)',
                    fontSize: 11,
                    textAlign: 'center',
                  }}
                >
                  {loadingMore ? (
                    <Spin size="small" />
                  ) : (
                    '向上滚动加载更早日志'
                  )}
                </div>
              )}
              {filteredLogs.map((entry, idx) => (
                <div
                  key={`${idx}-${entry.timestamp}-${entry.message?.slice(0, 100)}`}
                  style={{
                    padding: '1px 12px',
                    display: 'flex',
                    gap: 8,
                    alignItems: 'flex-start',
                  }}
                >
                  <span style={{ color: 'var(--color-text-tertiary)', flexShrink: 0 }}>
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
                      color: entry.level === 'error' ? 'var(--color-error)' :
                             entry.level === 'warn' ? 'var(--color-warning)' :
                             entry.level === 'info' ? 'var(--color-info)' :
                             'var(--color-text)',
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
      </div>
      {/* Footer */}
      <div
        style={{
          padding: '8px 16px',
          display: 'flex',
          justifyContent: 'space-between',
          fontSize: 11,
          color: 'var(--color-text-tertiary)',
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
