/**
 * TrafficLightToolbar - 沉浸式顶部工具栏覆盖层。
 *
 * 浮于 NuwaxHostWebview 之上，分两层：
 * 1) 顶部全宽 10px 窄拖拽带（-webkit-app-region:drag）——唯一承接窗口拖拽的区域，
 *    mac 避开红绿灯；工具栏主体不再整层 drag，否则会拦截 webview 顶部元素的点击。
 * 2) 工具栏主体（pointer-events:none 事件穿透）：mac 左侧留出 80px 避让原生红绿灯
 *    （{16,16}）；其右紧跟工具 icon 组：收起/展开二级菜单 | 设置 | 后退 | 前进 | 刷新。
 *    右侧渲染新版本更新入口（updateEntry，仅当检测到新版本时由 App.tsx 注入
 *    icon/下载进度；Agent 运行状态不再展示）；
 *    Win/Linux 自绘最小化/最大化/关闭按钮（mac 用原生红绿灯，不渲染）。
 *
 * icon 组与更新入口为 no-drag + pointer-events:auto（可点击），中间大片留白事件穿透
 * 到 webview（不再遮挡其顶部可点击元素）。Win/Linux 窗口控制自包含
 * （maximized/onMin/onMax/onClose），不污染 App.tsx。
 *
 * tooltip 暂用中文面量（桌面端次要 UI）；后续如需多语言可统一抽 i18n key。
 */
import React, { useEffect, useState } from "react";
import { Button, Tooltip } from "antd";
import {
  MenuFoldOutlined,
  MenuUnfoldOutlined,
  LeftOutlined,
  RightOutlined,
  ReloadOutlined,
  SettingOutlined,
} from "@ant-design/icons";

/** macOS 用 navigator.platform 判定（渲染器无 process.platform）。 */
const isMac = /mac/i.test(navigator.platform);

/** -webkit-app-region 需在 renderer DOM 设置；Electron 专属键，React CSSProperties 未内置，用 any 规避告警。 */
const DRAG = { WebkitAppRegion: "drag" } as any;
const NO_DRAG = { WebkitAppRegion: "no-drag" } as any;

export interface TrafficLightToolbarProps {
  /** 二级菜单收起态（决定收起/展开 icon 与 tooltip）。 */
  menuCollapsed: boolean;
  /** 当前页是否存在可收起的二级菜单（nuwax 经桥推送；无则隐藏收起按钮）。 */
  menuAvailable: boolean;
  /** webview 后退能力（false 时禁用后退按钮）。 */
  canGoBack: boolean;
  /** webview 前进能力（false 时禁用前进按钮）。 */
  canGoForward: boolean;
  onToggleMenu: () => void;
  onBack: () => void;
  onForward: () => void;
  onReload: () => void;
  onOpenSettings: () => void;
  /** 新版本更新入口（仅当检测到新版本时注入：下载 icon / 下载中百分比 / 待安装；其余不渲染）。 */
  updateEntry?: React.ReactNode;
}

const TrafficLightToolbar: React.FC<TrafficLightToolbarProps> = ({
  menuCollapsed,
  menuAvailable,
  canGoBack,
  canGoForward,
  onToggleMenu,
  onBack,
  onForward,
  onReload,
  onOpenSettings,
  updateEntry,
}) => {
  // Win/Linux 最大化状态（自绘按钮图标）；mac 用原生红绿灯不渲染按钮
  const [maximized, setMaximized] = useState(false);
  useEffect(() => {
    if (isMac) return;
    const sync = () =>
      window.electronAPI?.window
        .isMaximized?.()
        .then(setMaximized)
        .catch(() => {});
    sync();
    window.addEventListener("resize", sync);
    return () => window.removeEventListener("resize", sync);
  }, []);

  const onMin = () => window.electronAPI?.window.minimize();
  const onMax = () => window.electronAPI?.window.maximize();
  const onClose = () => window.electronAPI?.window.close();

  /** 统一的 icon 按钮（text 型、半透明、hover 显背景；no-drag 可点）。 */
  const iconBtn = (
    title: string,
    disabled: boolean,
    onClick: () => void,
    icon: React.ReactNode,
  ) => (
    <Tooltip title={title} mouseEnterDelay={0.7}>
      <Button
        type="text"
        size="small"
        disabled={disabled}
        onClick={onClick}
        style={{
          // 不可用时置灰（antd 禁用文字色），比仅禁点更直观
          color: disabled ? "rgba(0,0,0,0.25)" : "rgba(0,0,0,0.65)",
          fontSize: 16, // 放大图标（antd icon 继承按钮字号）
          ...NO_DRAG,
        }}
      >
        {icon}
      </Button>
    </Tooltip>
  );

  return (
    <>
      {/* 顶部窄拖拽带（全宽 10px，避开红绿灯）：窗口拖拽手柄由这条承担，
        工具栏主体不再整层 drag，避免遮挡 webview 顶部元素的点击 */}
      <div
        style={{
          position: "fixed",
          top: 0,
          left: isMac ? 80 : 0,
          right: 0,
          height: 10,
          zIndex: 1099,
          ...DRAG,
        }}
      />
      <div
        style={{
          position: "fixed",
          top: 0,
          left: 10,
          right: 0,
          height: 48,
          zIndex: 1100,
          display: "flex",
          alignItems: "center",
          paddingLeft: isMac ? 80 : 8,
          paddingRight: 4,
          // 容器事件穿透：中间大片区域不拦截鼠标，仅左右子块可交互
          pointerEvents: "none",
        }}
      >
        {/* 左侧工具 icon 组 */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 0,
            pointerEvents: "auto",
            ...NO_DRAG,
          }}
        >
          {/* 收起/展开二级菜单：仅当 nuwax 报告当前页存在二级菜单时渲染（无则隐藏） */}
          {menuAvailable &&
            iconBtn(
              menuCollapsed ? "展开二级菜单" : "收起二级菜单",
              false,
              onToggleMenu,
              menuCollapsed ? <MenuUnfoldOutlined /> : <MenuFoldOutlined />,
            )}
          {iconBtn("设置", false, onOpenSettings, <SettingOutlined />)}
          {iconBtn("后退", !canGoBack, onBack, <LeftOutlined />)}
          {iconBtn("前进", !canGoForward, onForward, <RightOutlined />)}
          {iconBtn("刷新", false, onReload, <ReloadOutlined />)}
        </div>

        {/* 中间留白：拖拽手柄 */}
        <div style={{ flex: 1 }} />

        {/* 右侧：新版本更新入口（仅当有新版本时由 App.tsx 注入，其余不渲染） */}
        {updateEntry && (
          <div
            style={{
              display: "flex",
              alignItems: "center",
              marginLeft: 8,
              pointerEvents: "auto",
              ...NO_DRAG,
            }}
          >
            {updateEntry}
          </div>
        )}

        {/* Win/Linux 自绘窗口控制按钮（mac 用原生红绿灯） */}
        {!isMac && (
          <div
            style={{
              display: "flex",
              alignItems: "center",
              marginLeft: 8,
              height: "100%",
              pointerEvents: "auto",
              ...NO_DRAG,
            }}
          >
            <CtrlButton title="最小化" onClick={onMin}>
              &#8211;
            </CtrlButton>
            <CtrlButton title={maximized ? "还原" : "最大化"} onClick={onMax}>
              {maximized ? "⧉" : "□"}
            </CtrlButton>
            <CtrlButton title="关闭" danger onClick={onClose}>
              &#10005;
            </CtrlButton>
          </div>
        )}
      </div>
    </>
  );
};

/** Win/Linux 窗口控制按钮（与原 NuwaxHostWebview 样式一致）。 */
const CtrlButton: React.FC<{
  title: string;
  onClick: () => void;
  danger?: boolean;
  children: React.ReactNode;
}> = ({ title, onClick, danger, children }) => (
  <button
    aria-label={title}
    title={title}
    onClick={onClick}
    style={{
      width: 40,
      height: 28,
      border: "none",
      background: "transparent",
      color: danger ? "#ff5f57" : "#555",
      fontSize: 13,
      lineHeight: "28px",
      cursor: "pointer",
      ...NO_DRAG,
    }}
  >
    {children}
  </button>
);

export default TrafficLightToolbar;
