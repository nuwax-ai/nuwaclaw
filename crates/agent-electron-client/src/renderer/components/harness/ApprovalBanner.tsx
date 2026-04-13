/**
 * ApprovalBanner — 审批请求横幅
 *
 * 固定在 TasksPage 顶部，显示待处理的审批请求。
 * 数据来源：
 * 1. mount 时拉取 listPendingApprovals()（防止 push 丢失）
 * 2. 监听 harness:approvalRequested 实时追加
 */

import React, { useState, useEffect, useCallback, useRef } from "react";
import { Alert, Button, Tag, Modal, Space, message } from "antd";
import {
  ExclamationCircleOutlined,
  CheckOutlined,
  CloseOutlined,
} from "@ant-design/icons";
import { t } from "../../services/core/i18n";
import type { ApprovalRequest, ApprovalPriority } from "@shared/types/harness";

// ==================== 优先级样式 ====================

const PRIORITY_COLOR: Record<ApprovalPriority, string> = {
  low: "default",
  medium: "orange",
  high: "red",
  critical: "magenta",
};

const PRIORITY_I18N: Record<ApprovalPriority, string> = {
  low: "Claw.Approval.priorityLow",
  medium: "Claw.Approval.priorityMedium",
  high: "Claw.Approval.priorityHigh",
  critical: "Claw.Approval.priorityCritical",
};

// ==================== 倒计时 Hook ====================

function useCountdown(expiresAt: number | null | undefined): number | null {
  const [remaining, setRemaining] = useState<number | null>(null);

  useEffect(() => {
    if (!expiresAt) {
      setRemaining(null);
      return;
    }

    const tick = () => {
      const diff = Math.max(0, Math.floor((expiresAt - Date.now()) / 1000));
      setRemaining(diff);
    };

    tick();
    const timer = setInterval(tick, 1000);
    return () => clearInterval(timer);
  }, [expiresAt]);

  return remaining;
}

// ==================== 单条审批横幅 ====================

function ApprovalItem({
  request,
  onRespond,
  onDetail,
}: {
  request: ApprovalRequest;
  onRespond: (id: string, decision: "approve" | "reject") => void;
  onDetail: (request: ApprovalRequest) => void;
}) {
  const remaining = useCountdown(request.expiresAt);
  const [responding, setResponding] = useState(false);

  const handleRespond = async (decision: "approve" | "reject") => {
    setResponding(true);
    try {
      await onRespond(request.id, decision);
    } finally {
      setResponding(false);
    }
  };

  return (
    <Alert
      type={
        request.priority === "high" || request.priority === "critical"
          ? "error"
          : "warning"
      }
      showIcon
      icon={<ExclamationCircleOutlined />}
      message={
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            flexWrap: "wrap",
          }}
        >
          <Tag color={PRIORITY_COLOR[request.priority]} style={{ margin: 0 }}>
            {t(PRIORITY_I18N[request.priority])}
          </Tag>
          <span style={{ fontWeight: 500, fontSize: 13 }}>{request.title}</span>
          {remaining !== null && remaining > 0 && (
            <span style={{ fontSize: 11, color: "var(--color-text-tertiary)" }}>
              {t("Claw.Approval.expiresIn", String(remaining))}
            </span>
          )}
          <Space size={4} style={{ marginLeft: "auto" }}>
            <Button size="small" onClick={() => onDetail(request)}>
              {t("Claw.Approval.detail")}
            </Button>
            <Button
              size="small"
              type="primary"
              icon={<CheckOutlined />}
              loading={responding}
              onClick={() => void handleRespond("approve")}
            >
              {t("Claw.Approval.approve")}
            </Button>
            <Button
              size="small"
              danger
              icon={<CloseOutlined />}
              loading={responding}
              onClick={() => void handleRespond("reject")}
            >
              {t("Claw.Approval.reject")}
            </Button>
          </Space>
        </div>
      }
      style={{ marginBottom: 0 }}
      banner
    />
  );
}

// ==================== 主组件 ====================

export function ApprovalBanner() {
  const [approvals, setApprovals] = useState<ApprovalRequest[]>([]);
  const [detailRequest, setDetailRequest] = useState<ApprovalRequest | null>(
    null,
  );
  const mountedRef = useRef(true);

  // 初始化：拉取待处理审批
  useEffect(() => {
    mountedRef.current = true;
    window.electronAPI?.harness
      .listPendingApprovals()
      .then((res) => {
        if (mountedRef.current && res?.success && Array.isArray(res.data)) {
          setApprovals(res.data);
        }
      })
      .catch(() => {});
    return () => {
      mountedRef.current = false;
    };
  }, []);

  // 监听实时推送
  useEffect(() => {
    const handler = (payload: {
      request: ApprovalRequest;
      taskTitle: string;
    }) => {
      if (!payload?.request?.id) return;
      setApprovals((prev) => {
        // 去重
        if (prev.some((a) => a.id === payload.request.id)) return prev;
        return [payload.request, ...prev];
      });
    };
    window.electronAPI?.on("harness:approvalRequested", handler);
    return () => {
      window.electronAPI?.off("harness:approvalRequested", handler);
    };
  }, []);

  // 响应审批
  const handleRespond = useCallback(
    async (approvalId: string, decision: "approve" | "reject") => {
      try {
        const res = await window.electronAPI?.harness.respondApproval(
          approvalId,
          decision,
        );
        if (res?.success) {
          message.success(
            decision === "approve"
              ? t("Claw.Approval.approved")
              : t("Claw.Approval.rejected"),
          );
          // 移除已处理的审批
          setApprovals((prev) => prev.filter((a) => a.id !== approvalId));
        }
      } catch {
        // ignore
      }
    },
    [],
  );

  if (approvals.length === 0) return null;

  return (
    <>
      <div style={{ display: "flex", flexDirection: "column" }}>
        {approvals.map((request) => (
          <ApprovalItem
            key={request.id}
            request={request}
            onRespond={handleRespond}
            onDetail={setDetailRequest}
          />
        ))}
      </div>

      {/* 详情 Modal */}
      <Modal
        open={!!detailRequest}
        onCancel={() => setDetailRequest(null)}
        footer={null}
        title={detailRequest?.title ?? t("Claw.Approval.detail")}
        width={480}
      >
        {detailRequest && (
          <div style={{ fontSize: 13 }}>
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "80px 1fr",
                gap: "8px 12px",
              }}
            >
              <span style={{ color: "var(--color-text-secondary)" }}>Type</span>
              <span>{detailRequest.type}</span>
              <span style={{ color: "var(--color-text-secondary)" }}>
                Priority
              </span>
              <Tag
                color={PRIORITY_COLOR[detailRequest.priority]}
                style={{ margin: 0, width: "fit-content" }}
              >
                {t(PRIORITY_I18N[detailRequest.priority])}
              </Tag>
              {detailRequest.description && (
                <>
                  <span style={{ color: "var(--color-text-secondary)" }}>
                    Description
                  </span>
                  <span>{detailRequest.description}</span>
                </>
              )}
              {detailRequest.context && (
                <>
                  <span style={{ color: "var(--color-text-secondary)" }}>
                    Context
                  </span>
                  <pre
                    style={{
                      margin: 0,
                      fontSize: 11,
                      background: "var(--color-fill-secondary)",
                      padding: 8,
                      borderRadius: 4,
                      maxHeight: 200,
                      overflow: "auto",
                      whiteSpace: "pre-wrap",
                      wordBreak: "break-all",
                    }}
                  >
                    {JSON.stringify(detailRequest.context, null, 2)}
                  </pre>
                </>
              )}
            </div>
            <div
              style={{
                marginTop: 16,
                display: "flex",
                justifyContent: "flex-end",
                gap: 8,
              }}
            >
              <Button
                type="primary"
                icon={<CheckOutlined />}
                onClick={() => {
                  void handleRespond(detailRequest.id, "approve");
                  setDetailRequest(null);
                }}
              >
                {t("Claw.Approval.approve")}
              </Button>
              <Button
                danger
                icon={<CloseOutlined />}
                onClick={() => {
                  void handleRespond(detailRequest.id, "reject");
                  setDetailRequest(null);
                }}
              >
                {t("Claw.Approval.reject")}
              </Button>
            </div>
          </div>
        )}
      </Modal>
    </>
  );
}
