/**
 * AppDevPage - 应用开发页面
 *
 * 两个视图：
 * A. 项目列表 - 展示所有 AppDev 项目，支持打开
 * B. 内嵌 webview - 在主窗口内展示 AppDev 页面
 */

import React, { useState, useEffect, useCallback, useRef } from "react";
import { Button, Tag, message, Spin, List, Empty } from "antd";
import {
  PlusOutlined,
  ReloadOutlined,
  CodeOutlined,
  PlayCircleOutlined,
} from "@ant-design/icons";
import { persistTicketCookie } from "../../services/utils/sessionUrl";
import { logger } from "../../services/utils/logService";
import { APP_DISPLAY_NAME, DEFAULT_SERVER_HOST } from "@shared/constants";
import { t } from "../../services/core/i18n";
import { apiRequest } from "../../services/core/api";
import { getCurrentAuth } from "../../services/core/auth";
import styles from "../../styles/components/SessionsPage.module.css";

export interface WebviewHeaderActions {
  onBack: () => void;
  onReload: () => void;
}

interface AppDevPageProps {
  /** Notify parent when entering/leaving webview mode (for hiding sidebar/logo). */
  onWebviewChange?: (actions: WebviewHeaderActions | null) => void;
}

// ============ Types ============

interface AppDevProject {
  projectId: number;
  projectName: string;
  spaceId: number;
  spaceName?: string;
  projectType?: number;
  createdAt?: string;
  updatedAt?: string;
}

// ============ API ============

async function fetchAppDevProjects(): Promise<AppDevProject[]> {
  try {
    // Get current auth to find domain
    const auth = await getCurrentAuth();
    const domain = auth.userInfo?.currentDomain || DEFAULT_SERVER_HOST;

    // Fetch project list from the domain
    const response = await apiRequest<{ list: AppDevProject[] }>(
      "/api/custom-page/list-projects",
      {
        method: "GET",
        params: { page: 1, pageSize: 50 },
        baseUrl: domain,
      },
    );

    if (response?.list && Array.isArray(response.list)) {
      return response.list;
    }
    return [];
  } catch (error) {
    logger.error("[AppDevPage] fetchAppDevProjects failed", "AppDevPage", {
      error: error instanceof Error ? error.message : String(error),
    });
    return [];
  }
}

function AppDevPage({ onWebviewChange }: AppDevPageProps) {
  // ---------- View state ----------
  const [view, setView] = useState<"list" | "webview">("list");
  const [webviewUrl, setWebviewUrl] = useState("");
  const [webviewUA, setWebviewUA] = useState<string | undefined>();
  const webviewRef = useRef<HTMLElement | null>(null);

  // ---------- Project list state ----------
  const [projects, setProjects] = useState<AppDevProject[]>([]);
  const [loading, setLoading] = useState(true);

  // Build custom user agent with app version
  useEffect(() => {
    window.electronAPI?.app
      .getVersion()
      .then((version) => {
        const ua = navigator.userAgent + ` ${APP_DISPLAY_NAME}/${version}`;
        setWebviewUA(ua);
      })
      .catch(() => {});
  }, []);

  // Debug: log webview navigation events
  useEffect(() => {
    const el = webviewRef.current as any;
    if (!el || view !== "webview") return;

    const onDidNavigate = (e: any) => {
      const url: string = e.url || "(unknown)";
      const isLogin = url.includes("/login");
      const level = isLogin ? "warn" : "info";
      logger[level](
        `[AppDevPage][WebviewNav] did-navigate${isLogin ? " ⚠️ LOGIN DETECTED" : ""}`,
        "AppDevPage",
        { url, httpCode: e.httpResponseCode, isLogin },
      );

      // webview 登录成功后（从 /login 跳到非 login 页面），持久化 ticket cookie
      if (!isLogin && url.startsWith("http")) {
        try {
          const origin = new URL(url).origin;
          persistTicketCookie(origin).catch(() => {});
        } catch {
          // URL 解析失败，忽略
        }
      }
    };
    const onWillRedirect = (e: any) => {
      logger.info("[AppDevPage][WebviewNav] will-redirect", "AppDevPage", {
        from: e.oldURL,
        to: e.newURL,
      });
    };

    el.addEventListener("did-navigate", onDidNavigate);
    el.addEventListener("did-navigate-in-page", onDidNavigate);
    el.addEventListener("will-redirect", onWillRedirect);
    return () => {
      el.removeEventListener("did-navigate", onDidNavigate);
      el.removeEventListener("did-navigate-in-page", onDidNavigate);
      el.removeEventListener("will-redirect", onWillRedirect);
    };
  }, [view, webviewUrl]);

  // Notify parent when entering/leaving webview
  useEffect(() => {
    if (view === "webview") {
      onWebviewChange?.({
        onBack: () => {
          setView("list");
          setWebviewUrl("");
          loadProjects();
        },
        onReload: () => {
          (webviewRef.current as any)?.reload?.();
        },
      });
    } else {
      onWebviewChange?.(null);
    }
    return () => {
      onWebviewChange?.(null);
    };
  }, [view]);

  // ============ Data fetching ============

  const loadProjects = useCallback(async () => {
    setLoading(true);
    try {
      const list = await fetchAppDevProjects();
      setProjects(list);
    } catch (error) {
      console.error("[AppDevPage] loadProjects failed:", error);
      message.error(t("Claw.AppDev.loadFailed"));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (view !== "list") return;
    loadProjects();
  }, [loadProjects, view]);

  // ============ Actions ============

  const handleOpenProject = useCallback(async (project: AppDevProject) => {
    try {
      const auth = await getCurrentAuth();
      if (!auth.isLoggedIn) {
        message.warning(t("Claw.Sessions.loginFirst"));
        return;
      }

      const domain = auth.userInfo?.currentDomain || DEFAULT_SERVER_HOST;
      const normalizedDomain = domain.replace(/\/+$/, "");
      const url = `${normalizedDomain}/space/${project.spaceId}/app-dev/${project.projectId}?hideMenu=true`;

      // Sync cookie before opening webview
      const token = (await window.electronAPI?.settings.get("auth.token")) as
        | string
        | null;
      if (token) {
        try {
          await persistTicketCookie(normalizedDomain);
        } catch {
          // Ignore cookie sync failure
        }
      }

      setWebviewUrl(url);
      setView("webview");
    } catch (error) {
      console.error("[AppDevPage] handleOpenProject failed:", error);
      message.error(t("Claw.AppDev.openFailed"));
    }
  }, []);

  // ============ Render ============

  // View B: Webview
  if (view === "webview" && webviewUrl) {
    return (
      <div className={styles.webviewFullscreen}>
        <webview
          ref={webviewRef as any}
          src={webviewUrl}
          useragent={webviewUA}
          style={{ flex: 1, width: "100%", border: "none" }}
          allowpopups={"true" as any}
        />
      </div>
    );
  }

  // View A: Project list
  return (
    <div className={styles.page}>
      <div className={styles.listView}>
        {/* Toolbar */}
        <div className={styles.toolbar}>
          <div className={styles.toolbarLeft}>
            <CodeOutlined
              style={{ fontSize: 14, color: "var(--color-text-secondary)" }}
            />
            <span className={styles.toolbarTitle}>
              {t("Claw.AppDev.title")}
            </span>
            {projects.length > 0 && (
              <Tag style={{ margin: 0, fontSize: 11 }}>{projects.length}</Tag>
            )}
          </div>
          <div className={styles.toolbarActions}>
            <Button
              size="small"
              icon={<ReloadOutlined />}
              onClick={loadProjects}
            >
              {t("Claw.Common.refresh")}
            </Button>
          </div>
        </div>

        {/* Project list or empty state */}
        {loading ? (
          <div className={styles.emptyState}>
            <Spin size="default" />
          </div>
        ) : projects.length === 0 ? (
          <div className={styles.emptyState}>
            <Empty
              image={Empty.PRESENTED_IMAGE_SIMPLE}
              description={t("Claw.AppDev.noProjects")}
            />
          </div>
        ) : (
          <div className={styles.sessionList}>
            {projects.map((project) => (
              <div key={project.projectId} className={styles.sessionRow}>
                <div className={styles.sessionInfo}>
                  <span className={styles.sessionTitle}>
                    {project.projectName}
                  </span>
                  <div className={styles.sessionMeta}>
                    {project.spaceName && (
                      <Tag style={{ fontSize: 11 }}>{project.spaceName}</Tag>
                    )}
                    {project.createdAt && (
                      <span>{formatTime(project.createdAt)}</span>
                    )}
                  </div>
                </div>
                <div className={styles.sessionActions}>
                  <Button
                    size="small"
                    type="primary"
                    icon={<PlayCircleOutlined />}
                    onClick={() => handleOpenProject(project)}
                  >
                    {t("Claw.AppDev.open")}
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function formatTime(isoString: string): string {
  try {
    const date = new Date(isoString);
    return date.toLocaleDateString();
  } catch {
    return isoString;
  }
}

export default AppDevPage;
