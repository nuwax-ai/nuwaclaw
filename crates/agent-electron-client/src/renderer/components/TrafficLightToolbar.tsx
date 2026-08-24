/**
 * TrafficLightToolbar - 沉浸式顶部工具栏覆盖层。
 *
 * 浮于 NuwaxHostWebview 之上，分两层：
 * 1) 顶部全宽 10px 窄拖拽带（-webkit-app-region:drag）——唯一承接窗口拖拽的区域，
 *    mac 避开红绿灯；工具栏主体不再整层 drag，否则会拦截 webview 顶部元素的点击。
 * 2) 工具栏主体（pointer-events:none 事件穿透）：mac 左侧留出 80px 避让原生红绿灯
 *    （{16,16}）；其右紧跟工具 icon 组：收起/展开二级菜单 | 设置 | 后退 | 前进 | 刷新
 *    （Win/Linux 最左先放 nuwax 应用图标，再接工具 icon 组）。
 *    右侧渲染新版本更新入口（updateEntry，仅当检测到新版本时由 App.tsx 注入
 *    icon/下载进度；Agent 运行状态不再展示）；
 *    Win/Linux 自绘最小化/最大化/关闭按钮（Windows 标题栏样式贴死右上角，
 *    实底方角无悬浮装饰；mac 用原生红绿灯，不渲染）。
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
  // Win/Linux 窗口三键图标：统一用 antd SVG 图标（同 1em 视觉框、笔画一致），
  // 替代 Unicode 字形（–/□/✕ 同字号下视觉大小不齐，三键看起来不等大）
  LineOutlined,
  BorderOutlined,
  CopyOutlined,
  CloseOutlined,
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
  /** 服务状态指示器（非绿色时由 App.tsx 注入颜色点，点击打开设置弹窗；全绿不渲染）。 */
  statusEntry?: React.ReactNode;
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
  statusEntry,
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
          // Win/Linux 右上角被贴角的窗口控制三键（46×3=138px）占据，
          // 容器留出对应右内边距，防止更新入口等流内元素被其覆盖
          paddingRight: isMac ? 4 : 142,
          // 整条可拖拽窗口 + 双击切换最大化：沉浸避让已让空顶带（菜单 TOP36/
          // page-container TOP+8/详情页 TOOLBAR48），覆盖页面不再挡内容点击；
          // 可交互子块（icon 组/更新入口）以 no-drag 豁免。
          ...DRAG,
          onDoubleClick: () => {
            // window:maximize 主进程侧已实现最大化/还原切换
            void window.electronAPI?.window?.maximize?.().catch?.(() => {});
          },
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
          {/* Win/Linux：最左放 nuwax 应用图标（Windows 标题栏惯例；
              与 index.html favicon 同源 public/icon.png）；
              mac 左上被原生红绿灯占据，不放 */}
          {!isMac && (
            <img
              src="/icon.png"
              alt="Nuwax"
              draggable={false}
              style={{
                width: 18,
                height: 18,
                marginRight: 6,
                ...NO_DRAG,
              }}
            />
          )}
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
          {/* 服务状态指示器：非绿色时由 App.tsx 注入（点击打开设置弹窗），全绿不渲染 */}
          {statusEntry}
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

        {/* Win/Linux 自绘窗口控制按钮（mac 用原生红绿灯）：
            Windows 标题栏样式——absolute 贴死窗口右上角（不受容器 padding/居中影响），
            方角实底无悬浮装饰（index.css .toolbar-ctrl-group，
            背景走 --color-bg-container 变量：女娲推送时随米白，暗色回落壳自身色） */}
        {!isMac && (
          <div
            className="toolbar-ctrl-group"
            style={{
              position: "absolute",
              top: 0,
              right: 0,
              display: "flex",
              alignItems: "stretch",
              pointerEvents: "auto",
              ...NO_DRAG,
            }}
          >
            <CtrlButton title="最小化" onClick={onMin}>
              <LineOutlined style={{ fontSize: 16 }} />
            </CtrlButton>
            <CtrlButton title={maximized ? "还原" : "最大化"} onClick={onMax}>
              {maximized ? (
                <CopyOutlined style={{ fontSize: 16 }} />
              ) : (
                <BorderOutlined style={{ fontSize: 16 }} />
              )}
            </CtrlButton>
            <CtrlButton title="关闭" danger onClick={onClose}>
              <CloseOutlined style={{ fontSize: 16 }} />
            </CtrlButton>
          </div>
        )}
      </div>
    </>
  );
};

/** Win/Linux 窗口控制按钮（实底背景与 hover 底色见 index.css .toolbar-ctrl-*）。 */
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
    className={`toolbar-ctrl-btn${danger ? " toolbar-ctrl-btn--danger" : ""}`}
    style={{
      width: 46, // Windows 标题栏三键标准尺寸（46×32）
      height: 36,
      border: "none",
      // 注意不写 background / color / font-size：inline 优先级高于 CSS 类规则，
      // 会压掉 hover 底色、关闭键 hover 白字与 index.css 的图标字号（16px）
      cursor: "pointer",
      ...NO_DRAG,
    }}
  >
    {children}
  </button>
);

export default TrafficLightToolbar;
