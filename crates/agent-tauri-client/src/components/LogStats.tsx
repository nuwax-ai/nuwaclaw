/**
 * 日志统计组件
 */

import {
  CheckCircleOutlined,
  WarningOutlined,
  CloseCircleOutlined,
  FileTextOutlined,
} from "@ant-design/icons";
import { LogStats } from "../services/logService";
import { LOG_LEVEL_LABELS } from "../constants";

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
  const items = [
    {
      key: "total",
      icon: <FileTextOutlined />,
      color: "#71717a",
      label: LOG_LEVEL_LABELS.all,
      count: stats.total,
    },
    {
      key: "success",
      icon: <CheckCircleOutlined />,
      color: "#16a34a",
      label: LOG_LEVEL_LABELS.success,
      count: stats.success,
    },
    {
      key: "warning",
      icon: <WarningOutlined />,
      color: "#ca8a04",
      label: LOG_LEVEL_LABELS.warning,
      count: stats.warning,
    },
    {
      key: "error",
      icon: <CloseCircleOutlined />,
      color: "#dc2626",
      label: LOG_LEVEL_LABELS.error,
      count: stats.error,
    },
  ];

  return (
    <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
      {items.map((item) => {
        const isActive = currentFilter === item.key;
        return (
          <span
            key={item.key}
            onClick={() => onFilterClick?.(item.key)}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 4,
              fontSize: 12,
              cursor: onFilterClick ? "pointer" : "default",
              color: isActive ? item.color : "#a1a1aa",
              fontWeight: isActive ? 500 : 400,
              padding: "2px 6px",
              borderRadius: 4,
              background: isActive ? "#f4f4f5" : "transparent",
              transition: "all 0.15s",
            }}
          >
            {item.icon}
            {item.label} {item.count}
          </span>
        );
      })}
    </div>
  );
}
