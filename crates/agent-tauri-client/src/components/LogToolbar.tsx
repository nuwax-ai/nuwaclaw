/**
 * 日志工具栏组件
 */

import { useState, useCallback } from "react";
import { Input, Select, Button, Switch, Dropdown, message, Modal } from "antd";
import {
  SearchOutlined,
  DownloadOutlined,
  DeleteOutlined,
  ReloadOutlined,
} from "@ant-design/icons";
import {
  LogFilter,
  ExportFormat,
  exportLogs,
  downloadLogs,
  clearLogs,
} from "../services/logService";
import { LOG_LEVEL_LABELS } from "../constants";

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
  const [searchValue, setSearchValue] = useState("");

  const handleSearch = useCallback(
    (value: string) => {
      onFilterChange({ ...filter, keyword: value });
    },
    [filter, onFilterChange],
  );

  const handleLevelChange = useCallback(
    (value: string) => {
      onFilterChange({ ...filter, level: value as LogFilter["level"] });
    },
    [filter, onFilterChange],
  );

  const handleExport = useCallback(async (format: ExportFormat) => {
    try {
      const blob = await exportLogs(format);
      downloadLogs(blob);
    } catch (error) {
      message.error("导出失败");
    }
  }, []);

  const handleClear = useCallback(() => {
    Modal.confirm({
      title: "清空日志",
      content: "确定清空所有日志？此操作不可撤销。",
      okText: "清空",
      okType: "danger",
      cancelText: "取消",
      onOk: () => clearLogs(),
    });
  }, []);

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 8,
        marginBottom: 10,
        flexWrap: "wrap",
      }}
    >
      <Input
        placeholder="搜索..."
        prefix={<SearchOutlined />}
        value={searchValue}
        onChange={(e) => setSearchValue(e.target.value)}
        onPressEnter={() => handleSearch(searchValue)}
        style={{ width: 160 }}
        size="small"
        allowClear
      />

      <Select
        value={filter.level || "all"}
        onChange={handleLevelChange}
        style={{ width: 100 }}
        size="small"
        options={[
          { value: "all", label: LOG_LEVEL_LABELS.all },
          { value: "info", label: LOG_LEVEL_LABELS.info },
          { value: "success", label: LOG_LEVEL_LABELS.success },
          { value: "warning", label: LOG_LEVEL_LABELS.warning },
          { value: "error", label: LOG_LEVEL_LABELS.error },
        ]}
      />

      <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
        <Switch
          size="small"
          checked={autoScroll}
          onChange={onAutoScrollChange}
        />
        <span style={{ fontSize: 11, color: "#a1a1aa" }}>自动滚动</span>
      </div>

      <div style={{ flex: 1 }} />

      <Button size="small" icon={<ReloadOutlined />} onClick={onRefresh}>
        刷新
      </Button>

      <Dropdown
        menu={{
          items: [
            { key: "json", label: "JSON", onClick: () => handleExport("json") },
            { key: "csv", label: "CSV", onClick: () => handleExport("csv") },
            { key: "txt", label: "纯文本", onClick: () => handleExport("txt") },
          ],
        }}
        trigger={["click"]}
      >
        <Button size="small" icon={<DownloadOutlined />}>
          导出
        </Button>
      </Dropdown>

      <Button
        size="small"
        danger
        icon={<DeleteOutlined />}
        onClick={handleClear}
      >
        清空
      </Button>
    </div>
  );
}
