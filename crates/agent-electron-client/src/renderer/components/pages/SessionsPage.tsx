/**
 * SessionsPage - 会话管理页面（配置模式）
 *
 * 展示活跃会话列表，支持打开（跳转浏览器模式）/ 停止。
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
import { t } from "../../services/core/i18n";
import type { BrowserTarget } from "./BrowserHomePage";
import type { DetailedSession } from "@shared/types/sessions";
import styles from "../../styles/components/SessionsPage.module.css";

interface SessionsPageProps {
  /** 在浏览器模式中打开指定目标 */
  onOpenInBrowser?: (target: BrowserTarget) => void;
}

function SessionsPage({ onOpenInBrowser }: SessionsPageProps) {
  const [sessions, setSessions] = useState<DetailedSession[]>([]);
  const [loading, setLoading] = useState(true);
  const [stoppingSessions, setStoppingSessions] = useState<Set<string>>(
    new Set(),
  );

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

  useEffect(() => {
    fetchSessions();
    const timer = setInterval(fetchSessions, 3000);
    return () => clearInterval(timer);
  }, [fetchSessions]);

  const handleNewSession = useCallback(() => {
    onOpenInBrowser?.({ type: "newSession" });
  }, [onOpenInBrowser]);

  const handleOpenSession = useCallback(
    (sessionId: string) => {
      if (!sessionId) {
        message.warning(t("Claw.Sessions.loginFirst"));
        return;
      }
      onOpenInBrowser?.({ type: "session", sessionId });
    },
    [onOpenInBrowser],
  );

  const handleStopSession = useCallback(
    async (sessionId: string) => {
      setStoppingSessions((prev) => new Set(prev).add(sessionId));
      try {
        const result = await window.electronAPI?.agent.stopSession(sessionId);
        if (result?.success) {
          message.success(t("Claw.Sessions.sessionStopped"));
          await fetchSessions();
        } else {
          message.error(t("Claw.Sessions.stopSessionFailed"));
        }
      } catch (error) {
        console.error("[SessionsPage] stopSession failed:", error);
        message.error(t("Claw.Sessions.stopSessionFailed"));
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

  const getStatusTag = (status: DetailedSession["status"]) => {
    switch (status) {
      case "active":
        return <Tag color="processing">{t("Claw.Sessions.statusActive")}</Tag>;
      case "pending":
        return <Tag color="warning">{t("Claw.Sessions.statusPending")}</Tag>;
      case "terminating":
        return <Tag color="error">{t("Claw.Sessions.statusTerminating")}</Tag>;
      case "idle":
      default:
        return <Tag>{t("Claw.Sessions.statusIdle")}</Tag>;
    }
  };

  const getEngineTag = (session: DetailedSession) => {
    if (session.engineDisplayName) {
      return <Tag color="cyan">{session.engineDisplayName}</Tag>;
    }
    if (session.engineType === "claude-code") {
      return <Tag color="blue">{t("Claw.Sessions.engine01")}</Tag>;
    }
    if (session.engineType === "codex-cli") {
      return <Tag color="orange">{t("Claw.Sessions.engine03")}</Tag>;
    }
    return <Tag color="purple">{t("Claw.Sessions.engine02")}</Tag>;
  };

  const formatTime = (ts: number) => {
    const d = new Date(ts);
    const pad = (n: number) => String(n).padStart(2, "0");
    return `${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  };

  return (
    <div className={styles.page}>
      <div className={styles.listView}>
        <div className={styles.toolbar}>
          <div className={styles.toolbarLeft}>
            <TeamOutlined
              style={{ fontSize: 14, color: "var(--color-text-secondary)" }}
            />
            <span className={styles.toolbarTitle}>
              {t("Claw.Sessions.title")}
            </span>
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
              {t("Claw.Sessions.refresh")}
            </Button>
            <Button
              size="small"
              type="primary"
              icon={<PlusOutlined />}
              onClick={handleNewSession}
            >
              {t("Claw.Sessions.newSession")}
            </Button>
          </div>
        </div>

        {loading ? (
          <div className={styles.emptyState}>
            <Spin size="default" />
          </div>
        ) : sessions.length === 0 ? (
          <div className={styles.emptyState}>
            <TeamOutlined className={styles.emptyIcon} />
            <span>{t("Claw.Sessions.noActiveSessions")}</span>
            <Button
              type="primary"
              icon={<PlusOutlined />}
              onClick={handleNewSession}
            >
              {t("Claw.Sessions.newSession")}
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
                      {getEngineTag(session)}
                      {getStatusTag(session.status)}
                      <span>{formatTime(session.createdAt)}</span>
                      {session.lastActivity && (
                        <span>
                          {t("Claw.Sessions.lastActivity")}:{" "}
                          {formatTime(session.lastActivity)}
                        </span>
                      )}
                    </div>
                  </div>
                  <div className={styles.sessionActions}>
                    <Button
                      size="small"
                      icon={<PlayCircleOutlined />}
                      onClick={() => handleOpenSession(session.projectId || "")}
                    >
                      {t("Claw.Sessions.open")}
                    </Button>
                    <Button
                      size="small"
                      danger
                      icon={<StopOutlined />}
                      loading={isStopping}
                      onClick={() => handleStopSession(session.id)}
                    >
                      {t("Claw.Sessions.stop")}
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
