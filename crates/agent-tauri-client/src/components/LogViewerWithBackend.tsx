/**
 * 日志查看器（含前后端日志 Tab）
 */

import { useState, useEffect, useCallback } from "react";
import { Tabs, Empty, Spin, Button, Input, Tag } from "antd";
import {
  FileTextOutlined,
  ReloadOutlined,
  FolderOutlined,
  SearchOutlined,
  RobotOutlined,
} from "@ant-design/icons";
import { invoke } from "@tauri-apps/api/core";
import LogToolbar from "./LogToolbar";
import LogStats from "./LogStats";
import LogItem from "./LogItem";
import {
  LogEntry,
  LogFilter,
  LogStats as LogStatsType,
  getLogs,
  getLogStats,
  subscribeLogs,
} from "../services/logService";

interface LogViewerWithBackendProps {
  showSource?: boolean;
  enableRealtime?: boolean;
  autoScrollDefault?: boolean;
}

interface ParsedBackendLog {
  raw: string;
  timestamp?: string;
  level?: string;
  message: string;
}

function parseBackendLogLine(line: string): ParsedBackendLog {
  const timeMatch = line.match(
    /\[(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z?)\]/,
  );
  const levelMatch = line.match(/\]\s*(ERROR|WARN|INFO|DEBUG|TRACE)\s*/i);
  return {
    raw: line,
    timestamp: timeMatch?.[1],
    level: levelMatch?.[1]?.toUpperCase(),
    message: line,
  };
}

function getBackendLevelColor(level?: string): string {
  switch (level) {
    case "ERROR":
      return "#dc2626";
    case "WARN":
    case "WARNING":
      return "#ca8a04";
    case "INFO":
      return "#569cd6";
    case "DEBUG":
    case "TRACE":
      return "#71717a";
    default:
      return "#a1a1aa";
  }
}

export default function LogViewerWithBackend({
  showSource = true,
  enableRealtime = true,
  autoScrollDefault = true,
}: LogViewerWithBackendProps) {
  const [activeTab, setActiveTab] = useState<"operation" | "backend">(
    "operation",
  );
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [stats, setStats] = useState<LogStatsType>({
    total: 0,
    error: 0,
    warning: 0,
    success: 0,
    info: 0,
  });
  const [filter, setFilter] = useState<LogFilter>({ level: "all" });
  const [loading, setLoading] = useState(false);
  const [autoScroll, setAutoScroll] = useState(autoScrollDefault);

  const [backendLogs, setBackendLogs] = useState<ParsedBackendLog[]>([]);
  const [backendLoading, setBackendLoading] = useState(false);
  const [backendCount, setBackendCount] = useState(200);
  const [backendSearch, setBackendSearch] = useState("");
  const [backendError, setBackendError] = useState<string | null>(null);

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
      console.error("加载日志失败:", error);
    } finally {
      setLoading(false);
    }
  }, [filter]);

  useEffect(() => {
    loadLogs();
  }, [loadLogs]);

  useEffect(() => {
    if (!enableRealtime) return;
    const unsubscribe = subscribeLogs((newLog: LogEntry) => {
      setLogs((prev) => [newLog, ...prev].slice(0, 1000));
      setStats((prev) => ({
        ...prev,
        total: prev.total + 1,
        [newLog.level]: prev[newLog.level as keyof LogStatsType] + 1,
      }));
    });
    return () => unsubscribe();
  }, [enableRealtime]);

  const handleFilterChange = useCallback((newFilter: LogFilter) => {
    setFilter(newFilter);
  }, []);

  const handleLevelClick = useCallback((level: string) => {
    setFilter((prev: LogFilter) => ({
      ...prev,
      level: (level === prev.level ? "all" : level) as LogFilter["level"],
    }));
  }, []);

  const loadBackendLogs = useCallback(async () => {
    setBackendLoading(true);
    setBackendError(null);
    try {
      const lines = await invoke<string[]>("read_logs", {
        count: backendCount,
      });
      setBackendLogs(lines.map(parseBackendLogLine));
    } catch (err) {
      setBackendError(err instanceof Error ? err.message : "加载失败");
    } finally {
      setBackendLoading(false);
    }
  }, [backendCount]);

  useEffect(() => {
    if (activeTab === "backend") loadBackendLogs();
  }, [activeTab, loadBackendLogs]);

  const filteredBackendLogs = backendLogs.filter((log) => {
    if (!backendSearch) return true;
    return log.raw.toLowerCase().includes(backendSearch.toLowerCase());
  });

  const handleOpenLogDir = async () => {
    try {
      await invoke<void>("open_log_directory");
    } catch (err) {
      console.error("打开日志目录失败:", err);
    }
  };

  return (
    <div style={{ height: "100%", display: "flex", flexDirection: "column" }}>
      {/* 外层容器：flex: 1 撑满剩余空间，overflow: hidden 防止溢出 */}
      <div
        style={{
          flex: 1,
          overflow: "hidden",
          border: "1px solid #e4e4e7",
          borderRadius: 8,
          background: "#fff",
          display: "flex",
          flexDirection: "column",
        }}
      >
        <Tabs
          activeKey={activeTab}
          onChange={(key) => setActiveTab(key as "operation" | "backend")}
          // Tabs 组件设置为 100% 高度，内部会自动处理子元素的 flex 布局
          style={{ height: "100%" }}
          tabBarStyle={{ padding: "0 16px", marginBottom: 0 }}
          items={[
            {
              key: "operation",
              label: (
                <span style={{ fontSize: 13 }}>
                  <FileTextOutlined style={{ marginRight: 4 }} />
                  操作日志
                </span>
              ),
              children: (
                // 内容容器：使用 flex 纵向布局，height: 100% 撑满 Tabs 内容区
                <div
                  style={{
                    display: "flex",
                    flexDirection: "column",
                    height: "100%",
                    overflow: "hidden",
                    padding: "12px 16px",
                  }}
                >
                  {/* 工具栏：flexShrink: 0 防止被压缩 */}
                  <LogToolbar
                    filter={filter}
                    onFilterChange={handleFilterChange}
                    onRefresh={loadLogs}
                    autoScroll={autoScroll}
                    onAutoScrollChange={setAutoScroll}
                  />
                  {/* 统计信息区域：flexShrink: 0 保持固定高度 */}
                  <div style={{ marginBottom: 10, flexShrink: 0 }}>
                    <LogStats
                      stats={stats}
                      currentFilter={filter.level}
                      onFilterClick={handleLevelClick}
                    />
                  </div>
                  {/* 日志列表区域：flex: 1 撑满剩余空间，overflow: auto 超出时滚动 */}
                  <div
                    style={{
                      flex: 1,
                      overflow: "auto",
                      background: "#fafafa",
                      borderRadius: 6,
                      border: "1px solid #f4f4f5",
                    }}
                  >
                    {loading && logs.length === 0 ? (
                      <div style={{ textAlign: "center", padding: 32 }}>
                        <Spin size="small" />
                      </div>
                    ) : logs.length === 0 ? (
                      <Empty
                        description="暂无日志"
                        image={Empty.PRESENTED_IMAGE_SIMPLE}
                      />
                    ) : (
                      // 内层容器再次使用 flex 确保日志项正确显示
                      <div style={{ height: "100%", overflow: "auto" }}>
                        {logs.map((log) => (
                          <LogItem
                            key={log.id}
                            log={log}
                            showSource={showSource}
                            onCopy={(msg) => navigator.clipboard.writeText(msg)}
                          />
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              ),
            },
            {
              key: "backend",
              label: (
                <span style={{ fontSize: 13 }}>
                  <RobotOutlined style={{ marginRight: 4 }} />
                  后端日志
                </span>
              ),
              children: (
                // 内容容器：使用 flex 纵向布局，flex: 1 撑满剩余空间
                <div
                  style={{
                    flex: 1,
                    display: "flex",
                    flexDirection: "column",
                    overflow: "hidden",
                    padding: "12px 16px",
                  }}
                >
                  {/* 搜索和控制栏：flexShrink: 0 防止被压缩 */}
                  <div
                    style={{
                      marginBottom: 10,
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                      flexShrink: 0,
                    }}
                  >
                    <div
                      style={{ display: "flex", alignItems: "center", gap: 8 }}
                    >
                      <Input
                        placeholder="搜索..."
                        prefix={<SearchOutlined />}
                        value={backendSearch}
                        onChange={(e) => setBackendSearch(e.target.value)}
                        style={{ width: 160 }}
                        size="small"
                        allowClear
                      />
                      <span style={{ fontSize: 12, color: "#a1a1aa" }}>
                        {filteredBackendLogs.length} 条
                      </span>
                    </div>
                    <div style={{ display: "flex", gap: 6 }}>
                      <Button
                        size="small"
                        icon={<ReloadOutlined spin={backendLoading} />}
                        onClick={loadBackendLogs}
                      >
                        刷新
                      </Button>
                      <Button
                        size="small"
                        icon={<FolderOutlined />}
                        onClick={handleOpenLogDir}
                      >
                        打开目录
                      </Button>
                    </div>
                  </div>

                  {/* 错误提示区域：flexShrink: 0 保持固定高度 */}
                  {backendError && (
                    <div
                      style={{
                        marginBottom: 10,
                        padding: "6px 10px",
                        background: "#fef2f2",
                        border: "1px solid #fee2e2",
                        borderRadius: 4,
                        color: "#dc2626",
                        fontSize: 12,
                        flexShrink: 0,
                      }}
                    >
                      {backendError}
                    </div>
                  )}

                  {/* 日志内容区域：flex: 1 撑满剩余空间，overflow: auto 超出时滚动 */}
                  <div
                    style={{
                      flex: 1,
                      overflow: "auto",
                      padding: "8px 10px",
                      background: "#18181b",
                      borderRadius: 6,
                      fontFamily:
                        "ui-monospace, SFMono-Regular, Menlo, monospace",
                      fontSize: 11,
                      lineHeight: 1.6,
                    }}
                  >
                    {backendLoading && backendLogs.length === 0 ? (
                      <div
                        style={{
                          textAlign: "center",
                          padding: 32,
                          color: "#71717a",
                        }}
                      >
                        <Spin size="small" />
                      </div>
                    ) : filteredBackendLogs.length === 0 ? (
                      <div
                        style={{
                          textAlign: "center",
                          padding: 32,
                          color: "#52525b",
                          fontSize: 12,
                        }}
                      >
                        {backendSearch ? "没有匹配的日志" : "暂无日志"}
                      </div>
                    ) : (
                      filteredBackendLogs.map((log, index) => (
                        <div
                          key={index}
                          style={{
                            padding: "1px 0",
                            borderBottom: "1px solid #27272a",
                            color: "#d4d4d8",
                          }}
                        >
                          {log.timestamp && (
                            <span style={{ color: "#52525b", marginRight: 6 }}>
                              [{log.timestamp}]
                            </span>
                          )}
                          {log.level && (
                            <span
                              style={{
                                color: getBackendLevelColor(log.level),
                                marginRight: 6,
                                fontWeight: 500,
                              }}
                            >
                              {log.level}
                            </span>
                          )}
                          <span style={{ color: "#a1a1aa" }}>{log.raw}</span>
                        </div>
                      ))
                    )}
                  </div>

                  {/* 行数控制栏：flexShrink: 0 保持固定高度 */}
                  <div
                    style={{
                      marginTop: 8,
                      display: "flex",
                      alignItems: "center",
                      gap: 6,
                      fontSize: 11,
                      color: "#a1a1aa",
                      flexShrink: 0,
                    }}
                  >
                    <span>显示最近</span>
                    <Input
                      type="number"
                      min={50}
                      max={1000}
                      value={backendCount}
                      onChange={(e) =>
                        setBackendCount(Number(e.target.value) || 100)
                      }
                      style={{ width: 64 }}
                      size="small"
                    />
                    <span>行</span>
                  </div>
                </div>
              ),
            },
          ]}
        />
      </div>
    </div>
  );
}
