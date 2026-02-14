/**
 * 单条日志组件
 */

import { Tag, Typography, Tooltip } from "antd";
import {
  CheckCircleOutlined,
  WarningOutlined,
  CloseCircleOutlined,
  InfoCircleOutlined,
  CopyOutlined,
} from "@ant-design/icons";
import { LogEntry } from "../services/logService";
import { LOG_LEVEL_LABELS } from "../constants";
import dayjs from "dayjs";
import relativeTime from "dayjs/plugin/relativeTime";
import "dayjs/locale/zh-cn";

dayjs.extend(relativeTime);
dayjs.locale("zh-cn");

const { Paragraph } = Typography;

interface LogItemProps {
  log: LogEntry;
  showSource?: boolean;
  onCopy?: (message: string) => void;
}

const levelConfig: Record<
  string,
  { color: string; icon: React.ReactNode; label: string }
> = {
  error: {
    color: "#dc2626",
    icon: <CloseCircleOutlined />,
    label: LOG_LEVEL_LABELS.error,
  },
  warning: {
    color: "#ca8a04",
    icon: <WarningOutlined />,
    label: LOG_LEVEL_LABELS.warning,
  },
  success: {
    color: "#16a34a",
    icon: <CheckCircleOutlined />,
    label: LOG_LEVEL_LABELS.success,
  },
  info: {
    color: "#71717a",
    icon: <InfoCircleOutlined />,
    label: LOG_LEVEL_LABELS.info,
  },
};

export default function LogItem({
  log,
  showSource = true,
  onCopy,
}: LogItemProps) {
  const config = levelConfig[log.level] || levelConfig.info;
  const time = dayjs(log.timestamp);

  return (
    <div
      style={{
        padding: "6px 8px",
        borderBottom: "1px solid #f4f4f5",
        display: "flex",
        alignItems: "flex-start",
        gap: 8,
        fontSize: 12,
      }}
    >
      <span
        style={{
          color: "#a1a1aa",
          fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
          fontSize: 11,
          whiteSpace: "nowrap",
          lineHeight: "20px",
        }}
      >
        {time.format("HH:mm:ss")}
      </span>

      <span style={{ color: config.color, lineHeight: "20px", flexShrink: 0 }}>
        {config.icon}
      </span>

      {showSource && log.source && (
        <span
          style={{
            fontSize: 11,
            color: "#a1a1aa",
            background: "#f4f4f5",
            padding: "1px 4px",
            borderRadius: 3,
            lineHeight: "18px",
            flexShrink: 0,
          }}
        >
          {log.source}
        </span>
      )}

      <div style={{ flex: 1, minWidth: 0, lineHeight: "20px" }}>
        <span
          style={{
            fontSize: 12,
            color: "#18181b",
            wordBreak: "break-word",
          }}
        >
          {log.message}
        </span>

        {log.details && (
          <details style={{ marginTop: 4 }}>
            <summary
              style={{
                cursor: "pointer",
                color: "#a1a1aa",
                fontSize: 11,
              }}
            >
              详情
            </summary>
            <pre
              style={{
                fontSize: 11,
                background: "#f4f4f5",
                padding: 6,
                borderRadius: 4,
                overflow: "auto",
                marginTop: 4,
              }}
            >
              {JSON.stringify(log.details, null, 2)}
            </pre>
          </details>
        )}
      </div>

      {onCopy && (
        <Tooltip title="复制">
          <CopyOutlined
            onClick={() => {
              navigator.clipboard.writeText(log.message);
              onCopy(log.message);
            }}
            style={{
              cursor: "pointer",
              color: "#d4d4d8",
              fontSize: 12,
              lineHeight: "20px",
            }}
          />
        </Tooltip>
      )}
    </div>
  );
}
