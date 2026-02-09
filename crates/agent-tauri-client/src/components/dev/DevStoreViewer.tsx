/**
 * 开发工具 - Store 数据查看器
 *
 * 展示 Tauri Store 中保存的完整数据，方便开发调试
 *
 * 注意：此组件仅在开发环境下加载
 */

import React, { useState, useEffect, useCallback } from "react";
import {
  Card,
  Space,
  Button,
  Table,
  Tag,
  Typography,
  Input,
  Empty,
  message,
} from "antd";
import {
  DatabaseOutlined,
  ReloadOutlined,
  SearchOutlined,
  CopyOutlined,
} from "@ant-design/icons";
import { getStore, keys } from "../../services/store";

const { Text } = Typography;

interface StoreEntry {
  key: string;
  value: unknown;
  type: string;
}

/**
 * 获取值的类型标签
 */
function getValueType(value: unknown): string {
  if (value === null) return "null";
  if (value === undefined) return "undefined";
  if (Array.isArray(value)) return "array";
  return typeof value;
}

/**
 * 获取类型对应的 Tag 颜色
 */
function getTypeColor(type: string): string {
  switch (type) {
    case "string":
      return "green";
    case "number":
      return "blue";
    case "boolean":
      return "orange";
    case "object":
      return "purple";
    case "array":
      return "cyan";
    case "null":
      return "default";
    default:
      return "default";
  }
}

/**
 * 格式化值为可显示的字符串
 */
function formatValue(value: unknown): string {
  if (value === null) return "null";
  if (value === undefined) return "undefined";
  if (typeof value === "string") return value;
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "number") return String(value);
  return JSON.stringify(value, null, 2);
}

/**
 * Store 数据查看器组件
 */
export default function DevStoreViewer() {
  const [entries, setEntries] = useState<StoreEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [searchText, setSearchText] = useState("");

  /**
   * 加载 Store 中的所有数据
   */
  const loadStoreData = useCallback(async () => {
    setLoading(true);
    try {
      const store = getStore();
      const allKeys = await keys();
      // 按 key 排序
      allKeys.sort();

      const allEntries: StoreEntry[] = await Promise.all(
        allKeys.map(async (key) => {
          const value = await store.get<unknown>(key);
          return {
            key,
            value,
            type: getValueType(value),
          };
        }),
      );

      setEntries(allEntries);
    } catch (error) {
      console.error("[DevStoreViewer] 加载 Store 数据失败:", error);
      message.error("加载 Store 数据失败");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadStoreData();
  }, [loadStoreData]);

  /**
   * 复制所有数据到剪贴板
   */
  const handleCopyAll = async () => {
    const data: Record<string, unknown> = {};
    for (const entry of entries) {
      data[entry.key] = entry.value;
    }
    try {
      await navigator.clipboard.writeText(JSON.stringify(data, null, 2));
      message.success("已复制到剪贴板");
    } catch {
      message.error("复制失败");
    }
  };

  /**
   * 过滤后的数据
   */
  const filteredEntries = searchText
    ? entries.filter(
        (e) =>
          e.key.toLowerCase().includes(searchText.toLowerCase()) ||
          formatValue(e.value).toLowerCase().includes(searchText.toLowerCase()),
      )
    : entries;

  const columns = [
    {
      title: "键",
      dataIndex: "key",
      key: "key",
      width: "35%",
      render: (key: string) => (
        <Text code style={{ fontSize: 12, wordBreak: "break-all" as const }}>
          {key}
        </Text>
      ),
    },
    {
      title: "类型",
      dataIndex: "type",
      key: "type",
      width: "10%",
      render: (type: string) => <Tag color={getTypeColor(type)}>{type}</Tag>,
    },
    {
      title: "值",
      dataIndex: "value",
      key: "value",
      width: "55%",
      render: (value: unknown, record: StoreEntry) => {
        const formatted = formatValue(value);
        // 密码字段脱敏
        if (record.key.includes("password")) {
          return (
            <Text type="secondary" style={{ fontSize: 12 }}>
              ******
            </Text>
          );
        }
        // 长文本折叠
        if (formatted.length > 120) {
          return (
            <Text
              style={{ fontSize: 12, wordBreak: "break-all" as const }}
              ellipsis={{ tooltip: formatted }}
            >
              {formatted}
            </Text>
          );
        }
        return (
          <Text style={{ fontSize: 12, wordBreak: "break-all" as const }}>
            {formatted}
          </Text>
        );
      },
    },
  ];

  return (
    <Card
      size="small"
      title={
        <Space>
          <DatabaseOutlined />
          <span>Store 数据</span>
          <Tag color="blue">{entries.length} 条</Tag>
        </Space>
      }
      extra={
        <Space>
          <Button
            size="small"
            icon={<CopyOutlined />}
            onClick={handleCopyAll}
            disabled={entries.length === 0}
          >
            复制全部
          </Button>
          <Button
            size="small"
            icon={<ReloadOutlined />}
            onClick={loadStoreData}
            loading={loading}
          >
            刷新
          </Button>
        </Space>
      }
    >
      <Space direction="vertical" style={{ width: "100%" }} size={8}>
        <Input
          size="small"
          placeholder="搜索键名或值..."
          prefix={<SearchOutlined />}
          value={searchText}
          onChange={(e) => setSearchText(e.target.value)}
          allowClear
        />

        {filteredEntries.length > 0 ? (
          <Table
            size="small"
            dataSource={filteredEntries}
            columns={columns}
            rowKey="key"
            pagination={false}
            scroll={{ y: 400 }}
          />
        ) : (
          <Empty
            description={searchText ? "未找到匹配数据" : "Store 为空"}
            image={Empty.PRESENTED_IMAGE_SIMPLE}
          />
        )}
      </Space>
    </Card>
  );
}
