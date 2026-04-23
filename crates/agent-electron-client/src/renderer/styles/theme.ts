import type { ThemeConfig, MappingAlgorithm } from "antd";
import { theme } from "antd";

/**
 * NuwaClaw 主题配置
 * shadcn/ui 风格，支持亮色/暗色主题
 */

// 通用 token（不随主题变化的布局、字体、圆角等）
const sharedToken = {
  fontFamily:
    '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, "Noto Sans", sans-serif',
  fontSize: 13,
  fontSizeHeading1: 24,
  fontSizeHeading2: 20,
  fontSizeHeading3: 16,
  fontSizeHeading4: 15,
  fontSizeHeading5: 14,
  lineWidth: 1,
  controlHeight: 32,
  controlHeightLG: 36,
  controlHeightSM: 28,
  boxShadow:
    "0 1px 2px 0 rgba(0, 0, 0, 0.03), 0 1px 6px -1px rgba(0, 0, 0, 0.02)",
  boxShadowSecondary: "0 1px 2px 0 rgba(0, 0, 0, 0.03)",
  paddingContentHorizontal: 16,
  paddingContentVertical: 12,
  motionDurationFast: "0.15s",
  motionDurationMid: "0.2s",
};

// 通用组件配置（不随主题变化）
const sharedComponents = {
  Button: {
    borderRadius: 8,
    fontWeight: 500,
    primaryShadow: "none",
    defaultShadow: "none",
    dangerShadow: "none",
  },
  Card: {
    borderRadiusLG: 10,
    paddingLG: 16,
    headerFontSize: 13,
    headerFontSizeSM: 12,
  },
  Input: {
    borderRadius: 8,
  },
  Select: {
    borderRadius: 8,
  },
  Tag: {
    borderRadiusSM: 6,
  },
  Alert: {
    borderRadiusLG: 8,
  },
  Modal: {
    borderRadiusLG: 10,
  },
  Menu: {
    darkItemBg: "transparent",
    darkSubMenuItemBg: "transparent",
    itemBorderRadius: 8,
    itemMarginInline: 6,
    itemPaddingInline: 12,
  },
  Badge: {
    dotSize: 6,
  },
};

/**
 * main.tsx 使用的根 ConfigProvider 配置
 * 仅包含通用布局/字体 token，不含颜色。
 * 颜色由 App.tsx 中的动态 ConfigProvider 接管。
 */
export const rootTheme: ThemeConfig = {
  token: {
    ...sharedToken,
    borderRadius: 6,
    borderRadiusLG: 8,
    borderRadiusSM: 4,
  },
  components: {
    ...sharedComponents,
    Tag: { borderRadiusSM: 4 },
  },
};

// 亮色主题
export const lightTheme: ThemeConfig = {
  algorithm: theme.defaultAlgorithm as MappingAlgorithm,
  token: {
    ...sharedToken,
    borderRadius: 8,
    borderRadiusLG: 10,
    borderRadiusSM: 6,

    colorPrimary: "#18181b",
    colorPrimaryHover: "#27272a",
    colorPrimaryActive: "#3f3f46",
    colorSuccess: "#16a34a",
    colorSuccessHover: "#15803d",
    colorSuccessActive: "#166534",
    colorError: "#EF4444",
    colorErrorHover: "#DC2626",
    colorErrorActive: "#B91C1C",
    colorWarning: "#F59E0B",
    colorWarningHover: "#D97706",
    colorWarningActive: "#B45309",
    colorInfo: "#3B82F6",

    colorBorder: "#E5E7EB",
    colorBorderSecondary: "#F3F4F6",
    colorBgContainer: "#ffffff",
    colorBgLayout: "#F8F9FA",
    colorBgElevated: "#ffffff",

    colorText: "#18181b",
    colorTextSecondary: "#6B7280",
    colorTextTertiary: "#9CA3AF",
    colorTextQuaternary: "#D1D5DB",
  },
  components: {
    ...sharedComponents,
    Button: {
      ...sharedComponents.Button,
      defaultBorderColor: "#e4e4e7",
      defaultColor: "#18181b",
      defaultBg: "#ffffff",
      defaultHoverBg: "#f4f4f5",
      defaultHoverColor: "#18181b",
      defaultHoverBorderColor: "#d4d4d8",
    },
    Input: {
      ...sharedComponents.Input,
      activeBorderColor: "#a1a1aa",
      hoverBorderColor: "#a1a1aa",
      activeShadow: "0 0 0 2px rgba(24, 24, 27, 0.06)",
    },
    Select: {
      ...sharedComponents.Select,
      optionSelectedBg: "#f4f4f5",
    },
    Menu: {
      ...sharedComponents.Menu,
      itemSelectedBg: "#f4f4f5",
      itemSelectedColor: "#18181b",
    },
    Tabs: {
      inkBarColor: "#18181b",
      itemSelectedColor: "#18181b",
      itemHoverColor: "#18181b",
    },
    Switch: {
      colorPrimary: "#18181b",
      colorPrimaryHover: "#27272a",
    },
    Steps: {
      navArrowColor: "#18181b",
    },
    Table: {
      headerBg: "#fafafa",
      headerColor: "#71717a",
      borderColor: "#f4f4f5",
    },
    Descriptions: {
      labelBg: "#fafafa",
    },
    Progress: {
      defaultColor: "#18181b",
    },
  },
};

// 暗色主题
export const darkTheme: ThemeConfig = {
  algorithm: theme.darkAlgorithm as MappingAlgorithm,
  token: {
    ...sharedToken,
    borderRadius: 8,
    borderRadiusLG: 10,
    borderRadiusSM: 6,

    colorPrimary: "#fafafa",
    colorPrimaryHover: "#e4e4e7",
    colorPrimaryActive: "#d4d4d8",
    colorSuccess: "#22c55e",
    colorSuccessHover: "#16a34a",
    colorSuccessActive: "#15803d",
    colorError: "#EF4444",
    colorErrorHover: "#DC2626",
    colorErrorActive: "#B91C1C",
    colorWarning: "#F59E0B",
    colorWarningHover: "#D97706",
    colorWarningActive: "#B45309",
    colorInfo: "#3B82F6",

    colorBorder: "#27272a",
    colorBorderSecondary: "#3f3f46",
    colorBgContainer: "#18181b",
    colorBgLayout: "#09090b",
    colorBgElevated: "#27272a",

    colorText: "#fafafa",
    colorTextSecondary: "#a1a1aa",
    colorTextTertiary: "#71717a",
    colorTextQuaternary: "#52525b",
  },
  components: {
    ...sharedComponents,
    Button: {
      ...sharedComponents.Button,
      primaryColor: "#18181b",
      defaultBg: "#27272a",
      defaultBorderColor: "#3f3f46",
      defaultColor: "#a1a1aa",
      defaultHoverBg: "#3f3f46",
      defaultHoverColor: "#fafafa",
      defaultHoverBorderColor: "#52525b",
    },
    Input: {
      ...sharedComponents.Input,
      colorBgContainer: "#27272a",
    },
    Select: {
      ...sharedComponents.Select,
      colorBgContainer: "#27272a",
    },
    Menu: {
      ...sharedComponents.Menu,
      itemSelectedBg: "#27272a",
      itemSelectedColor: "#fafafa",
      itemColor: "#a1a1aa",
      itemHoverColor: "#fafafa",
      itemHoverBg: "#3f3f46",
    },
    Modal: {
      ...sharedComponents.Modal,
      colorBgElevated: "#27272a",
    },
    Tabs: {
      inkBarColor: "#fafafa",
      itemSelectedColor: "#fafafa",
      itemHoverColor: "#fafafa",
      itemColor: "#a1a1aa",
    },
    Switch: {
      colorPrimary: "#fafafa",
      colorPrimaryHover: "#e4e4e7",
    },
    Steps: {
      navArrowColor: "#fafafa",
    },
    Table: {
      colorBgContainer: "#18181b",
      headerBg: "#27272a",
      rowHoverBg: "#27272a",
    },
  },
};

// 兼容旧代码
export const appTheme = lightTheme;
