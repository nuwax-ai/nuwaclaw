/**
 * 日志统计组件
 * 显示各级别日志数量
 */

import { Space, Badge } from 'antd';
import {
  CheckCircleOutlined,
  WarningOutlined,
  CloseCircleOutlined,
  FileTextOutlined,
} from '@ant-design/icons';
import { LogStats } from '../services/logService';

interface LogStatsProps {
  stats: LogStats;
  currentFilter?: string;
  onFilterClick?: (level: string) => void;
}

export default function LogStatsComponent({
  stats,
  currentFilter,
  onFilterClick,
}: LogStatsProps) {
  // 日志级别配置
  const items = [
    {
      key: 'total',
      icon: <FileTextOutlined />,
      color: '#1890ff',
      label: '全部',
      count: stats.total,
    },
    {
      key: 'success',
      icon: <CheckCircleOutlined />,
      color: '#52c41a',
      label: '成功',
      count: stats.success,
    },
    {
      key: 'warning',
      icon: <WarningOutlined />,
      color: '#faad14',
      label: '警告',
      count: stats.warning,
    },
    {
      key: 'error',
      icon: <CloseCircleOutlined />,
      color: '#ff4d4f',
      label: '错误',
      count: stats.error,
    },
  ];

  return (
    <Space split="|" size={16}>
      {items.map((item) => (
        <Badge
          key={item.key}
          showZero
          style={{
            backgroundColor: currentFilter === item.key ? item.color : '#f0f0f0',
            color: currentFilter === item.key ? '#fff' : item.color,
          }}
          onClick={() => onFilterClick?.(item.key)}
          className={onFilterClick ? 'log-stats-item' : ''}
        >
          <span
            style={{
              color: item.color,
              marginRight: 4,
              cursor: onFilterClick ? 'pointer' : 'default',
            }}
          >
            {item.icon}
          </span>
          <span
            style={{
              fontWeight: currentFilter === item.key ? 600 : 400,
              cursor: onFilterClick ? 'pointer' : 'default',
            }}
          >
            {item.label} {item.count}
          </span>
        </Badge>
      ))}
    </Space>
  );
}
