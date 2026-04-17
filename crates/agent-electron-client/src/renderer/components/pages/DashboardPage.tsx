/**
 * DashboardPage — unified dashboard with collapsible panels.
 *
 * All old tab content is reorganized into collapsible sections:
 *   1. 客户端状态  — login + service status (from ClientPage)
 *   2. 会话管理    — sessions list
 *   3. 任务管理    — task list
 *   4. 应用开发    — appdev (code mode only)
 *   5. 设置        — settings
 *   6. 依赖管理    — dependencies
 *   7. 权限管理    — permissions (macOS only)
 *   8. 日志        — log viewer
 *   9. 关于        — about
 */

import React, { useState, useEffect } from "react";
import { Collapse, type CollapseProps } from "antd";
import {
  UserOutlined,
  TeamOutlined,
  OrderedListOutlined,
  AppstoreOutlined,
  SettingOutlined,
  FolderOutlined,
  SafetyOutlined,
  FileTextOutlined,
  InfoCircleOutlined,
} from "@ant-design/icons";
import { t } from "../../services/core/i18n";
import SessionsPage from "./SessionsPage";
import { TasksPage } from "./TasksPage";
import AppDevPage from "./AppDevPage";
import SettingsPage from "./SettingsPage";
import DependenciesPage from "./DependenciesPage";
import PermissionsPage from "./PermissionsPage";
import LogViewer from "./LogViewer";
import AboutPage from "./AboutPage";
import ClientPage from "./ClientPage";

export type DashboardPanelKey =
  | "client"
  | "sessions"
  | "tasks"
  | "appdev"
  | "settings"
  | "dependencies"
  | "permissions"
  | "logs"
  | "about";

interface DashboardPageProps {
  /** Which panel to expand by default / on navigation */
  activePanel?: DashboardPanelKey;
  /**
   * "management" — only show management panels (settings/dependencies/permissions/logs/about).
   * "full" (default) — show all panels.
   */
  mode?: "full" | "management";
  /** Notify parent when entering/leaving webview mode */
  onWebviewChange?: (
    actions: import("./SessionsPage").WebviewHeaderActions | null,
  ) => void;
  // ---- ClientPage props ----
  services?: import("../../App").ServiceItem[];
  servicesLoading?: boolean;
  startingServices?: Set<string>;
  setStartingServices?: React.Dispatch<React.SetStateAction<Set<string>>>;
  onRefreshServices?: () => Promise<void>;
  authRefreshTrigger?: number;
  onAuthChange?: () => void;
  onLoginStarted?: () => void;
  systemResources?: import("../../App").SystemResources;
  // ---- SessionsPage props ----
  sessionsAutoOpen?: boolean;
  onSessionsAutoOpenConsumed?: () => void;
}

export default function DashboardPage({
  activePanel = "client",
  mode = "full",
  onWebviewChange,
  services,
  servicesLoading,
  startingServices,
  setStartingServices,
  onRefreshServices,
  authRefreshTrigger,
  onAuthChange,
  onLoginStarted,
  systemResources,
  sessionsAutoOpen,
  onSessionsAutoOpenConsumed,
}: DashboardPageProps) {
  const [activeKeys, setActiveKeys] = useState<DashboardPanelKey[]>([
    activePanel,
  ]);

  // Sync when activePanel changes externally
  useEffect(() => {
    setActiveKeys([activePanel]);
  }, [activePanel]);

  const handleChange = (keys: string | string[]) => {
    setActiveKeys(
      Array.isArray(keys)
        ? (keys as DashboardPanelKey[])
        : [keys as DashboardPanelKey],
    );
  };

  const sessionsAutoOpenRef = React.useRef(sessionsAutoOpen);
  sessionsAutoOpenRef.current = sessionsAutoOpen;

  const handleSessionsAutoOpenConsumed = React.useCallback(() => {
    onSessionsAutoOpenConsumed?.();
  }, [onSessionsAutoOpenConsumed]);

  const items: CollapseProps["items"] = [
    // ── 1. 客户端状态 ──────────────────────────────────────────
    {
      key: "client",
      label: (
        <span>
          <UserOutlined style={{ marginRight: 8 }} />
          {t("Claw.Client.accountStatus")}
        </span>
      ),
      children: (
        <ClientPage
          onNavigate={() => {}}
          services={services ?? []}
          servicesLoading={servicesLoading ?? false}
          startingServices={startingServices ?? new Set()}
          setStartingServices={setStartingServices ?? (() => {})}
          onRefreshServices={
            (onRefreshServices as () => Promise<void>) ??
            (() => Promise.resolve())
          }
          authRefreshTrigger={authRefreshTrigger ?? 0}
          onAuthChange={onAuthChange ?? (() => {})}
          onLoginStarted={onLoginStarted ?? (() => {})}
          systemResources={systemResources}
        />
      ),
    },

    // ── 2. 会话管理 ──────────────────────────────────────────
    {
      key: "sessions",
      label: (
        <span>
          <TeamOutlined style={{ marginRight: 8 }} />
          {t("Claw.Menu.session")}
        </span>
      ),
      children: (
        <SessionsPage
          autoOpen={sessionsAutoOpenRef.current}
          onAutoOpenConsumed={handleSessionsAutoOpenConsumed}
          onWebviewChange={onWebviewChange ?? (() => {})}
        />
      ),
    },

    // ── 3. 任务管理 ──────────────────────────────────────────
    {
      key: "tasks",
      label: (
        <span>
          <OrderedListOutlined style={{ marginRight: 8 }} />
          {t("Claw.Menu.tasks")}
        </span>
      ),
      children: <TasksPage />,
    },

    // ── 4. 应用开发 ──────────────────────────────────────────
    {
      key: "appdev",
      label: (
        <span>
          <AppstoreOutlined style={{ marginRight: 8 }} />
          {t("Claw.Menu.appdev")}
        </span>
      ),
      children: <AppDevPage onWebviewChange={onWebviewChange ?? (() => {})} />,
    },

    // ── 5. 设置 ─────────────────────────────────────────────
    {
      key: "settings",
      label: (
        <span>
          <SettingOutlined style={{ marginRight: 8 }} />
          {t("Claw.Menu.settings")}
        </span>
      ),
      children: <SettingsPage />,
    },

    // ── 6. 依赖管理 ──────────────────────────────────────────
    {
      key: "dependencies",
      label: (
        <span>
          <FolderOutlined style={{ marginRight: 8 }} />
          {t("Claw.Menu.dependencies")}
        </span>
      ),
      children: <DependenciesPage />,
    },

    // ── 7. 权限管理 ──────────────────────────────────────────
    {
      key: "permissions",
      label: (
        <span>
          <SafetyOutlined style={{ marginRight: 8 }} />
          {t("Claw.Menu.authorization")}
        </span>
      ),
      children: <PermissionsPage />,
    },

    // ── 8. 日志 ──────────────────────────────────────────────
    {
      key: "logs",
      label: (
        <span>
          <FileTextOutlined style={{ marginRight: 8 }} />
          {t("Claw.Menu.logs")}
        </span>
      ),
      children: <LogViewer />,
    },

    // ── 9. 关于 ─────────────────────────────────────────────
    {
      key: "about",
      label: (
        <span>
          <InfoCircleOutlined style={{ marginRight: 8 }} />
          {t("Claw.Menu.about")}
        </span>
      ),
      children: <AboutPage />,
    },
  ];

  const managementKeys: string[] = [
    "settings",
    "dependencies",
    "permissions",
    "logs",
    "about",
  ];
  const filteredItems =
    mode === "management"
      ? items.filter((item) => managementKeys.includes(item.key as string))
      : items;

  return (
    <div style={{ height: "100%", overflow: "auto", padding: "0" }}>
      <Collapse
        activeKey={activeKeys}
        onChange={handleChange}
        items={filteredItems}
        bordered={false}
        style={{ background: "transparent" }}
      />
    </div>
  );
}
