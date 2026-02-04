/**
 * 日志工具栏组件
 * 搜索、过滤、导出等功能
 */

import { useState, useCallback } from 'react';
import { 
  Space, 
  Input, 
  Select, 
  Button, 
  Switch, 
  Dropdown,
  Tooltip,
  message,
  Modal,
} from 'antd';
import {
  SearchOutlined,
  FilterOutlined,
  DownloadOutlined,
  DeleteOutlined,
  ReloadOutlined,
  FileOutlined,
  FileTextOutlined,
} from '@ant-design/icons';
import { LogFilter, ExportFormat, exportLogs, downloadLogs, clearLogs } from '../services/logService';

interface LogToolbarProps {
  filter: LogFilter;
  onFilterChange: (filter: LogFilter) => void;
  onRefresh: () => void;
  autoScroll: boolean;
  onAutoScrollChange: (value: boolean) => void;
}

export default function LogToolbar({
  filter,
  onFilterChange,
  onRefresh,
  autoScroll,
  onAutoScrollChange,
}: LogToolbarProps) {
  const [searchValue, setSearchValue] = useState('');

  // 处理搜索
  const handleSearch = useCallback((value: string) => {
    onFilterChange({ ...filter, keyword: value });
  }, [filter, onFilterChange]);

  // 处理级别过滤
  const handleLevelChange = useCallback((value: string) => {
    onFilterChange({ ...filter, level: value as LogFilter['level'] });
  }, [filter, onFilterChange]);

  // 处理导出
  const handleExport = useCallback(async (format: ExportFormat) => {
    try {
      const blob = await exportLogs(format);
      downloadLogs(blob);
    } catch (error) {
      message.error('导出失败');
    }
  }, []);

  // 导出菜单
  const exportMenu = {
    items: [
      {
        key: 'json',
        icon: <FileTextOutlined />,
        label: 'JSON 格式',
        onClick: () => handleExport('json'),
      },
      {
        key: 'csv',
        icon: <FileTextOutlined />,
        label: 'CSV 格式',
        onClick: () => handleExport('csv'),
      },
      {
        key: 'txt',
        icon: <FileOutlined />,
        label: '纯文本格式',
        onClick: () => handleExport('txt'),
      },
    ],
  };

  // 清空确认
  const handleClear = useCallback(() => {
    Modal.confirm({
      title: '确认清空',
      content: '确定要清空所有日志吗？此操作不可撤销。',
      okText: '清空',
      okType: 'danger',
      cancelText: '取消',
      onOk: () => clearLogs(),
    });
  }, []);

  return (
    <Space wrap style={{ marginBottom: 16 }}>
      {/* 搜索框 */}
      <Input
        placeholder="搜索日志..."
        prefix={<SearchOutlined />}
        value={searchValue}
        onChange={(e) => setSearchValue(e.target.value)}
        onPressEnter={() => handleSearch(searchValue)}
        style={{ width: 200 }}
        allowClear
      />

      {/* 级别过滤 */}
      <Select
        value={filter.level || 'all'}
        onChange={handleLevelChange}
        style={{ width: 120 }}
        options={[
          { value: 'all', label: '全部级别' },
          { value: 'info', label: 'ℹ 信息' },
          { value: 'success', label: '✓ 成功' },
          { value: 'warning', label: '⚠ 警告' },
          { value: 'error', label: '✖ 错误' },
        ]}
      />

      {/* 自动滚动开关 */}
      <Tooltip title="自动滚动到最新日志">
        <Space>
          <Switch 
            size="small" 
            checked={autoScroll} 
            onChange={onAutoScrollChange} 
          />
          <span style={{ fontSize: 12 }}>自动滚动</span>
        </Space>
      </Tooltip>

      <div style={{ flex: 1 }} />

      {/* 操作按钮 */}
      <Space>
        <Tooltip title="刷新日志">
          <Button icon={<ReloadOutlined />} onClick={onRefresh}>
            刷新
          </Button>
        </Tooltip>

        <Dropdown menu={exportMenu} trigger={['click']}>
          <Button icon={<DownloadOutlined />}>
            导出
          </Button>
        </Dropdown>

        <Tooltip title="清空日志">
          <Button 
            danger 
            icon={<DeleteOutlined />} 
            onClick={handleClear}
          >
            清空
          </Button>
        </Tooltip>
      </Space>
    </Space>
  );
}
