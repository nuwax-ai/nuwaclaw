/**
 * SessionsPage - 会话管理页面
 *
 * 两个视图：
 * A. 会话列表 - 展示所有活跃会话，支持打开/停止
 * B. 内嵌 webview - 在主窗口内展示会话页面
 */

import React, { useState, useEffect, useCallback } from "react";
import { Button, Tag, message, Spin } from "antd";
import {
  PlusOutlined,
  ReloadOutlined,
  TeamOutlined,
  PlayCircleOutlined,
  StopOutlined,
} from "@ant-design/icons";
import EmbeddedWebview from "../EmbeddedWebview";
import { syncCookieAndGetRedirectUrl } from "../../services/utils/sessionUrl";
import type { DetailedSession } from "@shared/types/sessions";
import styles from "../../styles/components/SessionsPage.module.css";

function SessionsPage() {
  // ---------- View state ----------
  const [view, setView] = useState<"list" | "webview">("list");
  const [webviewUrl, setWebviewUrl] = useState("");

  // ---------- Sessions ----------
  const [sessions, setSessions] = useState<DetailedSession[]>([]);
  const [loading, setLoading] = useState(true);
  const [stoppingSessions, setStoppingSessions] = useState<Set<string>>(
    new Set(),
  );

  // ======================== Data fetching ========================

  const fetchSessions = useCallback(async () => {
    try {
      const result = await window.electronAPI?.agent.listSessionsDetailed();
      if (result?.success && Array.isArray(result.data)) {
        setSessions(result.data);
      }
    } catch (error) {
      console.error("[SessionsPage] fetchSessions failed:", error);
    } finally {
      setLoading(false);
    }
  }, []);

  // Poll sessions every 3s when in list view
  useEffect(() => {
    if (view !== "list") return;

    fetchSessions();
    const timer = setInterval(fetchSessions, 3000);
    return () => clearInterval(timer);
  }, [fetchSessions, view]);

  // ======================== Actions ========================

  const handleOpenWebview = useCallback(async () => {
    try {
      const url = await syncCookieAndGetRedirectUrl();
      if (!url) {
        message.warning("登录信息不完整，请先登录");
        return;
      }
      setWebviewUrl(url);
      setView("webview");
    } catch (error) {
      console.error("[SessionsPage] syncCookieAndGetUrl failed:", error);
      message.error("获取会话地址失败");
    }
  }, []);

  const handleStopSession = useCallback(
    async (sessionId: string) => {
      setStoppingSessions((prev) => new Set(prev).add(sessionId));
      try {
        const result = await window.electronAPI?.agent.stopSession(sessionId);
        if (result?.success) {
          message.success("会话已停止");
          await fetchSessions();
        } else {
          message.error("停止会话失败");
        }
      } catch (error) {
        console.error("[SessionsPage] stopSession failed:", error);
        message.error("停止会话失败");
      } finally {
        setStoppingSessions((prev) => {
          const next = new Set(prev);
          next.delete(sessionId);
          return next;
        });
      }
    },
    [fetchSessions],
  );

  const handleBackToList = useCallback(() => {
    setView("list");
    setWebviewUrl("");
    fetchSessions();
  }, [fetchSessions]);

  // ======================== Render helpers ========================

  const getStatusTag = (status: DetailedSession["status"]) => {
    switch (status) {
      case "active":
        return <Tag color="processing">活跃</Tag>;
      case "pending":
        return <Tag color="warning">等待中</Tag>;
      case "terminating":
        return <Tag color="error">终止中</Tag>;
      case "idle":
      default:
        return <Tag>空闲</Tag>;
    }
  };

  const getEngineTag = (engineType: DetailedSession["engineType"]) => {
    return engineType === "claude-code" ? (
      <Tag color="blue">Claude Code</Tag>
    ) : (
      <Tag color="purple">NuwaxCode</Tag>
    );
  };

  const formatTime = (ts: number) => {
    const d = new Date(ts);
    const pad = (n: number) => String(n).padStart(2, "0");
    return `${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  };

  // ======================== Render ========================

  // View B: Embedded webview
  if (view === "webview" && webviewUrl) {
    return (
      <div className={styles.page}>
        <div className={styles.webviewView}>
          <EmbeddedWebview url={webviewUrl} onClose={handleBackToList} />
        </div>
      </div>
    );
  }

  // View A: Session list
  return (
    <div className={styles.page}>
      <div className={styles.listView}>
        {/* Toolbar */}
        <div className={styles.toolbar}>
          <div className={styles.toolbarLeft}>
            <TeamOutlined
              style={{ fontSize: 14, color: "var(--color-text-secondary)" }}
            />
            <span className={styles.toolbarTitle}>会话</span>
            {sessions.length > 0 && (
              <Tag style={{ margin: 0, fontSize: 11 }}>{sessions.length}</Tag>
            )}
          </div>
          <div className={styles.toolbarActions}>
            <Button
              size="small"
              icon={<ReloadOutlined />}
              onClick={fetchSessions}
            >
              刷新
            </Button>
            <Button
              size="small"
              type="primary"
              icon={<PlusOutlined />}
              onClick={handleOpenWebview}
            >
              新建会话
            </Button>
          </div>
        </div>

        {/* Session list or empty state */}
        {loading ? (
          <div className={styles.emptyState}>
            <Spin size="default" />
          </div>
        ) : sessions.length === 0 ? (
          <div className={styles.emptyState}>
            <TeamOutlined className={styles.emptyIcon} />
            <span>暂无活跃会话</span>
            <Button
              type="primary"
              icon={<PlusOutlined />}
              onClick={handleOpenWebview}
            >
              新建会话
            </Button>
          </div>
        ) : (
          <div className={styles.sessionList}>
            {sessions.map((session) => {
              const isStopping = stoppingSessions.has(session.id);
              return (
                <div key={session.id} className={styles.sessionRow}>
                  <div className={styles.sessionInfo}>
                    <span className={styles.sessionTitle}>
                      {session.title || session.id.substring(0, 12)}
                    </span>
                    <div className={styles.sessionMeta}>
                      {getEngineTag(session.engineType)}
                      {getStatusTag(session.status)}
                      <span>{formatTime(session.createdAt)}</span>
                      {session.lastActivity && (
                        <span>
                          最后活动: {formatTime(session.lastActivity)}
                        </span>
                      )}
                    </div>
                  </div>
                  <div className={styles.sessionActions}>
                    <Button
                      size="small"
                      icon={<PlayCircleOutlined />}
                      onClick={handleOpenWebview}
                    >
                      打开
                    </Button>
                    <Button
                      size="small"
                      danger
                      icon={<StopOutlined />}
                      loading={isStopping}
                      onClick={() => handleStopSession(session.id)}
                    >
                      停止
                    </Button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

export default SessionsPage;
