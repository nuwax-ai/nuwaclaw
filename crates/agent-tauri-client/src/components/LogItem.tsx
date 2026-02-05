/**
 * 单条日志组件
 */

import { Tag, Typography, Tooltip } from 'antd';
import { 
  CheckCircleOutlined, 
  WarningOutlined, 
  CloseCircleOutlined, 
  InfoCircleOutlined,
  CopyOutlined,
} from '@ant-design/icons';
import { LogEntry } from '../services/logService';
import dayjs from 'dayjs';
import relativeTime from 'dayjs/plugin/relativeTime';
import 'dayjs/locale/zh-cn';

dayjs.extend(relativeTime);
dayjs.locale('zh-cn');

const { Text, Paragraph } = Typography;

interface LogItemProps {
  log: LogEntry;
  showSource?: boolean;
  onCopy?: (message: string) => void;
}

// 日志级别配置
const levelConfig: Record<string, { color: string; icon: React.ReactNode; label: string }> = {
  error: {
    color: '#ff4d4f',
    icon: <CloseCircleOutlined />,
    label: '错误',
  },
  warning: {
    color: '#faad14',
    icon: <WarningOutlined />,
    label: '警告',
  },
  success: {
    color: '#52c41a',
    icon: <CheckCircleOutlined />,
    label: '成功',
  },
  info: {
    color: '#1890ff',
    icon: <InfoCircleOutlined />,
    label: '信息',
  },
};

export default function LogItem({ log, showSource = true, onCopy }: LogItemProps) {
  const config = levelConfig[log.level] || levelConfig.info;
  const time = dayjs(log.timestamp);
  const displayTime = time.format('HH:mm:ss');
  const relativeTimeStr = time.fromNow();

  const handleCopy = () => {
    navigator.clipboard.writeText(log.message);
    onCopy?.(log.message);
  };

  return (
    <div className="log-item" style={{ padding: '8px', borderBottom: '1px solid #f0f0f0' }}>
      <div style={{ display: 'flex', alignItems: 'middle',gap: 12 }}>
        {/* 时间 */}
        <Text 
          code 
          style={{ 
            fontSize: 12,
            color: '#8c8c8c',
            whiteSpace: 'nowrap',
          }}
        >
          {displayTime}
        </Text>

        {/* 级别标签 */}
        <Tag 
          color={log.level}
          style={{ padding: '0 4px'}}
        >
          <span style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 12 }}>
            {config.icon}
            {config.label}
          </span>
        </Tag>

        {/* 来源 */}
        {showSource && log.source && (
          <Tag style={{ padding: '0 4px', fontSize: 12 }}>
            {log.source}
          </Tag>
        )}

        {/* 消息 */}
        <div style={{ flex: 1, minWidth: 0 }}>
          <Paragraph
            style={{ 
              margin: 0, 
              fontSize: 13,
              wordBreak: 'break-word',
              lineHeight: 1.6,
            }}
            ellipsis={{ rows: 3, expandable: false }}
          >
            {log.message}
          </Paragraph>
          
          {/* 详细信息 */}
          {log.details && (
            <div style={{ marginTop: 4 }}>
              <details>
                <summary style={{ cursor: 'pointer', color: '#8c8c8c', fontSize: 12 }}>
                  详细信息
                </summary>
                <pre style={{ 
                  fontSize: 11, 
                  background: '#f5f5f5', 
                  padding: 8, 
                  borderRadius: 4,
                  overflow: 'auto',
                  marginTop: 4,
                }}>
                  {JSON.stringify(log.details, null, 2)}
                </pre>
              </details>
            </div>
          )}
        </div>

        {/* 相对时间（悬停显示） */}
        <Tooltip title={time.format('YYYY-MM-DD HH:mm:ss')}>
          <Text type="secondary" style={{ fontSize: 11, whiteSpace: 'nowrap' }}>
            {relativeTimeStr}
          </Text>
        </Tooltip>

        {/* 复制按钮 */}
        {onCopy && (
          <Tooltip title="复制消息">
            <CopyOutlined 
              onClick={handleCopy}
              style={{ 
                cursor: 'pointer', 
                color: '#8c8c8c',
                fontSize: 14,
              }}
            />
          </Tooltip>
        )}
      </div>
    </div>
  );
}
