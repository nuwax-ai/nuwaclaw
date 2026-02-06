/**
 * 日志查看器（含前后端日志 Tab）
 * 整合操作日志（前端）和后端日志，使用 Tab 切换
 */

import { useState, useEffect, useCallback } from "react";
import {
  Card,
  Tabs,
  Empty,
  Spin,
  Space,
  Tooltip,
  Button,
  Input,
  Tag,
} from "antd";
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

// 后端日志解析类型
interface ParsedBackendLog {
  raw: string;
  timestamp?: string;
  level?: string;
  message: string;
}

// 解析后端日志行
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

// 获取后端日志级别颜色
function getBackendLevelColor(level?: string): string {
  switch (level) {
    case "ERROR":
      return "error";
    case "WARN":
    case "WARNING":
      return "warning";
    case "INFO":
      return "success";
    case "DEBUG":
    case "TRACE":
      return "processing";
    default:
      return "default";
  }
}

export default function LogViewerWithBackend({
  showSource = true,
  enableRealtime = true,
  autoScrollDefault = true,
}: LogViewerWithBackendProps) {
  // Tab 状态
  const [activeTab, setActiveTab] = useState<"operation" | "backend">(
    "operation",
  );

  // 操作日志状态
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

  // 后端日志状态
  const [backendLogs, setBackendLogs] = useState<ParsedBackendLog[]>([]);
  const [backendLoading, setBackendLoading] = useState(false);
  const [backendCount, setBackendCount] = useState(200);
  const [backendSearch, setBackendSearch] = useState("");
  const [backendError, setBackendError] = useState<string | null>(null);

  // ========== 操作日志相关 ==========

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
      setLogs((prev) => {
        const updated = [newLog, ...prev];
        return updated.slice(0, 1000);
      });

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

  // ========== 后端日志相关 ==========

  const loadBackendLogs = useCallback(async () => {
    setBackendLoading(true);
    setBackendError(null);
    try {
      const lines = await invoke<string[]>("read_logs", {
        count: backendCount,
      });
      const parsed = lines.map(parseBackendLogLine);
      setBackendLogs(parsed);
    } catch (err) {
      console.error("加载后端日志失败:", err);
      setBackendError(err instanceof Error ? err.message : "加载失败");
    } finally {
      setBackendLoading(false);
    }
  }, [backendCount]);

  useEffect(() => {
    if (activeTab === "backend") {
      loadBackendLogs();
    }
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
    <div
      style={{
        height: "calc(100vh - 56px - 32px)",
        display: "flex",
        flexDirection: "column",
      }}
    >
      <Card
        style={{ flex: 1, overflow: "hidden" }}
        bodyStyle={{
          height: "100%",
          padding: 16,
          overflow: "hidden",
          display: "flex",
          flexDirection: "column",
        }}
      >
        <Tabs
          activeKey={activeTab}
          onChange={(key) => setActiveTab(key as "operation" | "backend")}
          style={{
            height: "100%",
            flex: 1,
            display: "flex",
            flexDirection: "column",
          }}
          items={[
            {
              key: "operation",
              label: (
                <span>
                  <FileTextOutlined />
                  操作日志
                </span>
              ),
              children: (
                <div
                  style={{
                    display: "flex",
                    flexDirection: "column",
                    flex: 1,
                    overflow: "hidden",
                  }}
                >
                  <LogToolbar
                    filter={filter}
                    onFilterChange={handleFilterChange}
                    onRefresh={loadLogs}
                    autoScroll={autoScroll}
                    onAutoScrollChange={(value) => setAutoScroll(value)}
                  />
                  <div style={{ marginBottom: 16, flexShrink: 0 }}>
                    <LogStats
                      stats={stats}
                      currentFilter={filter.level}
                      onFilterClick={handleLevelClick}
                    />
                  </div>
                  <div
                    style={{
                      flex: 1,
                      overflow: "auto",
                      background: "#fafafa",
                      borderRadius: 4,
                      border: "1px solid #f0f0f0",
                    }}
                  >
                    {loading && logs.length === 0 ? (
                      <div style={{ textAlign: "center", padding: 40 }}>
                        <Spin tip="加载中..." />
                      </div>
                    ) : logs.length === 0 ? (
                      <Empty
                        description="暂无日志"
                        image={Empty.PRESENTED_IMAGE_SIMPLE}
                      />
                    ) : (
                      <div
                        className="log-list"
                        style={{ flex: 1, overflow: "auto" }}
                      >
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
                <span>
                  <RobotOutlined />
                  后端日志
                </span>
              ),
              children: (
                <div
                  style={{
                    flex: 1,
                    display: "flex",
                    flexDirection: "column",
                    overflow: "hidden",
                  }}
                >
                  <div style={{ marginBottom: 16, flexShrink: 0 }}>
                    <Space
                      style={{ width: "100%", justifyContent: "space-between" }}
                    >
                      <Space>
                        <Input
                          placeholder="搜索日志..."
                          prefix={<SearchOutlined />}
                          value={backendSearch}
                          onChange={(e) => setBackendSearch(e.target.value)}
                          style={{ width: 200 }}
                          allowClear
                        />
                        <Tag color="blue">{filteredBackendLogs.length} 条</Tag>
                      </Space>
                      <Space>
                        <Tooltip title="刷新">
                          <Button
                            icon={<ReloadOutlined spin={backendLoading} />}
                            onClick={loadBackendLogs}
                          >
                            刷新
                          </Button>
                        </Tooltip>
                        <Tooltip title="在文件中查看">
                          <Button
                            icon={<FolderOutlined />}
                            onClick={handleOpenLogDir}
                          >
                            打开目录
                          </Button>
                        </Tooltip>
                      </Space>
                    </Space>
                  </div>

                  {backendError && (
                    <div
                      style={{
                        marginBottom: 16,
                        padding: "8px 12px",
                        background: "#fff2f0",
                        border: "1px solid #ffccc7",
                        borderRadius: 4,
                        color: "#cf1322",
                        flexShrink: 0,
                      }}
                    >
                      {backendError}
                    </div>
                  )}

                  <div
                    style={{
                      flex: 1,
                      overflow: "auto",
                      padding: "8px 12px",
                      background: "#1e1e1e",
                      borderRadius: 4,
                      fontFamily: 'Monaco, Consolas, "Courier New", monospace',
                      fontSize: 12,
                      lineHeight: 1.6,
                    }}
                  >
                    {backendLoading && backendLogs.length === 0 ? (
                      <div
                        style={{
                          textAlign: "center",
                          padding: 40,
                          color: "#fff",
                        }}
                      >
                        <Spin tip="加载日志中..." />
                      </div>
                    ) : filteredBackendLogs.length === 0 ? (
                      <Empty
                        description={
                          backendSearch ? "没有匹配的日志" : "暂无日志文件"
                        }
                        image={Empty.PRESENTED_IMAGE_SIMPLE}
                      />
                    ) : (
                      <div>
                        {filteredBackendLogs.map((log, index) => (
                          <div
                            key={index}
                            style={{
                              padding: "2px 0",
                              borderBottom: "1px solid #333",
                              color: "#d4d4d4",
                            }}
                          >
                            {log.timestamp && (
                              <span
                                style={{ color: "#569cd6", marginRight: 8 }}
                              >
                                [{log.timestamp}]
                              </span>
                            )}
                            {log.level && (
                              <Tag
                                color={getBackendLevelColor(log.level)}
                                style={{
                                  marginRight: 8,
                                  fontSize: 10,
                                  lineHeight: "16px",
                                  height: 16,
                                }}
                              >
                                {log.level}
                              </Tag>
                            )}
                            <span style={{ color: "#d4d4d4" }}>{log.raw}</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>

                  <div
                    style={{
                      marginTop: 8,
                      padding: "8px 12px",
                      background: "#f5f5f5",
                      borderRadius: 4,
                      fontSize: 12,
                      color: "#666",
                      flexShrink: 0,
                    }}
                  >
                    <Space>
                      <span>显示最近</span>
                      <Input
                        type="number"
                        min={50}
                        max={1000}
                        value={backendCount}
                        onChange={(e) =>
                          setBackendCount(Number(e.target.value) || 100)
                        }
                        style={{ width: 80 }}
                        size="small"
                      />
                      <span>行，最新的日志在最前面</span>
                    </Space>
                  </div>
                </div>
              ),
            },
          ]}
        />
      </Card>
    </div>
  );
}
