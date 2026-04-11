/**
 * PermissionRequestCard — 内联权限确认卡片
 *
 * 收到 permission.updated 事件时，作为浮动卡片覆盖在主内容区底部，
 * 要求用户逐步确认工具调用权限。
 *
 * 决议后折叠为历史条目，卡片自动消失。
 */

import React, { useState, useEffect, useCallback } from "react";
import { Button, Tag, Tooltip } from "antd";
import {
  SafetyCertificateOutlined,
  CheckOutlined,
  CloseOutlined,
  LockOutlined,
  CodeOutlined,
  FileOutlined,
} from "@ant-design/icons";
import { t } from "../services/core/i18n";

// ======================== Types ========================

export interface PendingPermission {
  sessionId: string;
  permissionId: string;
  toolCall: {
    toolCallId: string;
    title?: string | null;
    kind?: string | null;
    rawInput?: unknown;
  };
  options: Array<{
    optionId: string;
    kind: "allow_once" | "allow_always" | "reject_once" | "reject_always";
    name: string;
  }>;
  arrivedAt: number;
}

interface PermissionRequestCardProps {
  pending: PendingPermission[];
  onRespond: (
    sessionId: string,
    permissionId: string,
    response: "once" | "always" | "reject",
  ) => void;
}

// ======================== Helpers ========================

const TIMEOUT_SECS = 60;

function getKindIcon(kind?: string | null): React.ReactNode {
  if (!kind) return <SafetyCertificateOutlined />;
  const k = kind.toLowerCase();
  if (k.includes("bash") || k.includes("cmd") || k.includes("command"))
    return <CodeOutlined />;
  if (k.includes("file") || k.includes("read") || k.includes("write"))
    return <FileOutlined />;
  return <LockOutlined />;
}

function formatInput(rawInput: unknown): string {
  if (rawInput === null || rawInput === undefined) return "";
  if (typeof rawInput === "string") return rawInput.slice(0, 200);
  try {
    const s = JSON.stringify(rawInput, null, 0);
    return s.slice(0, 200) + (s.length > 200 ? "…" : "");
  } catch {
    return String(rawInput).slice(0, 200);
  }
}

// ======================== Single card for one request ========================

interface SingleCardProps {
  item: PendingPermission;
  onRespond: (response: "once" | "always" | "reject") => void;
  isFirst: boolean;
}

function SingleCard({ item, onRespond, isFirst }: SingleCardProps) {
  const elapsed = Math.floor((Date.now() - item.arrivedAt) / 1000);
  const [remaining, setRemaining] = useState(
    Math.max(0, TIMEOUT_SECS - elapsed),
  );

  useEffect(() => {
    if (remaining <= 0) return;
    const timer = setInterval(() => {
      setRemaining((prev) => {
        if (prev <= 1) {
          clearInterval(timer);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
    return () => clearInterval(timer);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const title = item.toolCall.title || item.toolCall.kind || "tool";
  const inputStr = formatInput(item.toolCall.rawInput);

  const hasAlwaysOption = item.options.some((o) => o.kind === "allow_always");

  return (
    <div
      style={{
        background: "var(--color-bg-elevated, #fff)",
        border: "1px solid var(--color-border, #d9d9d9)",
        borderRadius: 8,
        padding: "10px 14px",
        marginBottom: isFirst ? 0 : undefined,
        boxShadow: isFirst
          ? "0 -2px 12px rgba(0,0,0,0.12)"
          : "0 1px 4px rgba(0,0,0,0.08)",
      }}
    >
      {/* Header row */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          marginBottom: 6,
        }}
      >
        <span style={{ color: "var(--color-warning, #fa8c16)", fontSize: 14 }}>
          {getKindIcon(item.toolCall.kind)}
        </span>
        <span
          style={{
            fontWeight: 600,
            fontSize: 13,
            flex: 1,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {title}
        </span>
        <Tag
          style={{
            margin: 0,
            fontSize: 11,
            color:
              remaining <= 10
                ? "var(--color-error, #f5222d)"
                : "var(--color-text-secondary, #888)",
            borderColor:
              remaining <= 10
                ? "var(--color-error, #f5222d)"
                : "var(--color-border, #d9d9d9)",
          }}
        >
          {remaining}
          {t("Claw.Permissions.second")}
        </Tag>
      </div>

      {/* Input preview */}
      {inputStr && (
        <Tooltip
          title={
            inputStr.length >= 200
              ? formatInput(item.toolCall.rawInput)
              : undefined
          }
        >
          <div
            style={{
              fontFamily: "monospace",
              fontSize: 11,
              color: "var(--color-text-secondary, #888)",
              background: "var(--color-bg-layout, #f5f5f5)",
              borderRadius: 4,
              padding: "2px 6px",
              marginBottom: 8,
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
              maxWidth: "100%",
            }}
          >
            {inputStr}
          </div>
        </Tooltip>
      )}

      {/* Action buttons */}
      <div style={{ display: "flex", gap: 6, justifyContent: "flex-end" }}>
        <Button
          size="small"
          danger
          icon={<CloseOutlined />}
          onClick={() => onRespond("reject")}
        >
          {t("Claw.Permissions.deny")}
        </Button>
        <Button
          size="small"
          icon={<CheckOutlined />}
          onClick={() => onRespond("once")}
        >
          {t("Claw.Permissions.allowOnce")}
        </Button>
        {hasAlwaysOption && (
          <Button
            size="small"
            type="primary"
            icon={<CheckOutlined />}
            onClick={() => onRespond("always")}
          >
            {t("Claw.Permissions.allowAlways")}
          </Button>
        )}
      </div>
    </div>
  );
}

// ======================== Main component ========================

function PermissionRequestCard({
  pending,
  onRespond,
}: PermissionRequestCardProps) {
  const [collapsed, setCollapsed] = useState(false);

  // Reset collapsed state when new requests arrive
  useEffect(() => {
    if (pending.length > 0) setCollapsed(false);
  }, [pending.length]);

  const handleRespond = useCallback(
    (item: PendingPermission, response: "once" | "always" | "reject") => {
      onRespond(item.sessionId, item.permissionId, response);
    },
    [onRespond],
  );

  if (pending.length === 0) return null;

  const [first, ...rest] = pending;

  return (
    <div
      style={{
        position: "absolute",
        bottom: 0,
        left: 0,
        right: 0,
        zIndex: 1000,
        padding: "0 12px 12px",
        pointerEvents: "none",
      }}
    >
      <div style={{ pointerEvents: "all" }}>
        {/* Collapsed rest items counter */}
        {rest.length > 0 && !collapsed && (
          <div
            style={{
              fontSize: 11,
              color: "var(--color-text-secondary, #888)",
              textAlign: "right",
              marginBottom: 4,
              cursor: "pointer",
            }}
            onClick={() => setCollapsed(!collapsed)}
          >
            {t("Claw.Permissions.pendingMore", rest.length)}
          </div>
        )}

        {/* Show stacked rest items when expanded */}
        {!collapsed &&
          rest.map((item) => (
            <div key={item.permissionId} style={{ marginBottom: 4 }}>
              <SingleCard
                item={item}
                onRespond={(r) => handleRespond(item, r)}
                isFirst={false}
              />
            </div>
          ))}

        {/* Primary (most recent) card */}
        <SingleCard
          item={first}
          onRespond={(r) => handleRespond(first, r)}
          isFirst
        />
      </div>
    </div>
  );
}

export default PermissionRequestCard;
