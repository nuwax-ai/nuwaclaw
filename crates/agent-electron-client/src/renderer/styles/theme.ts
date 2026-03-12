import type { ThemeConfig } from 'antd';

/**
 * NuwaClaw 主题配置
 * shadcn/ui 风格，支持亮色/暗色主题
 */

// 亮色主题
export const lightTheme: ThemeConfig = {
  token: {
    // 主色 (shadcn/ui zinc)
    colorPrimary: '#18181b',
    colorPrimaryHover: '#27272a',
    colorPrimaryActive: '#3f3f46',

    // 语义色
    colorSuccess: '#16a34a',
    colorSuccessHover: '#15803d',
    colorSuccessActive: '#166534',
    colorError: '#EF4444',
    colorErrorHover: '#DC2626',
    colorErrorActive: '#B91C1C',
    colorWarning: '#F59E0B',
    colorWarningHover: '#D97706',
    colorWarningActive: '#B45309',
    colorInfo: '#3B82F6',

    // 边框与背景
    colorBorder: '#E5E7EB',
    colorBorderSecondary: '#F3F4F6',
    colorBgContainer: '#ffffff',
    colorBgLayout: '#F8F9FA',
    colorBgElevated: '#ffffff',

    // 文字颜色
    colorText: '#18181b',
    colorTextSecondary: '#6B7280',
    colorTextTertiary: '#9CA3AF',
    colorTextQuaternary: '#D1D5DB',

    // 圆角
    borderRadius: 8,
    borderRadiusLG: 10,
    borderRadiusSM: 6,

    // 字体
    fontSize: 13,
    fontSizeHeading4: 15,
    fontSizeHeading5: 14,

    // 动画
    motionDurationFast: '0.15s',
    motionDurationMid: '0.2s',
  },
  components: {
    Button: {
      borderRadius: 8,
      fontWeight: 500,
      primaryShadow: 'none',
      defaultShadow: 'none',
      dangerShadow: 'none',
    },
    Card: {
      borderRadiusLG: 10,
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
      borderRadius: 8,
    },
    Modal: {
      borderRadiusLG: 10,
    },
    Menu: {
      itemBorderRadius: 8,
      itemSelectedBg: '#f4f4f5',
      itemSelectedColor: '#18181b',
    },
    Tabs: {
      inkBarColor: '#18181b',
      itemSelectedColor: '#18181b',
      itemHoverColor: '#18181b',
    },
    Switch: {
      colorPrimary: '#18181b',
      colorPrimaryHover: '#27272a',
    },
    Steps: {
      navArrowColor: '#18181b',
    },
  },
};

// 暗色主题
export const darkTheme: ThemeConfig = {
  token: {
    // 主色 (shadcn/ui zinc - dark mode 保持白色主色)
    colorPrimary: '#fafafa',
    colorPrimaryHover: '#e4e4e7',
    colorPrimaryActive: '#d4d4d8',

    // 语义色
    colorSuccess: '#22c55e',
    colorSuccessHover: '#16a34a',
    colorSuccessActive: '#15803d',
    colorError: '#EF4444',
    colorErrorHover: '#DC2626',
    colorErrorActive: '#B91C1C',
    colorWarning: '#F59E0B',
    colorWarningHover: '#D97706',
    colorWarningActive: '#B45309',
    colorInfo: '#3B82F6',

    // 边框与背景 (dark mode)
    colorBorder: '#27272a',
    colorBorderSecondary: '#3f3f46',
    colorBgContainer: '#18181b',
    colorBgLayout: '#09090b',
    colorBgElevated: '#27272a',

    // 文字颜色 (dark mode)
    colorText: '#fafafa',
    colorTextSecondary: '#a1a1aa',
    colorTextTertiary: '#71717a',
    colorTextQuaternary: '#52525b',

    // 圆角
    borderRadius: 8,
    borderRadiusLG: 10,
    borderRadiusSM: 6,

    // 字体
    fontSize: 13,
    fontSizeHeading4: 15,
    fontSizeHeading5: 14,

    // 动画
    motionDurationFast: '0.15s',
    motionDurationMid: '0.2s',
  },
  components: {
    Button: {
      borderRadius: 8,
      fontWeight: 500,
      primaryShadow: 'none',
      defaultShadow: 'none',
      dangerShadow: 'none',
      primaryColor: '#18181b',
    },
    Card: {
      borderRadiusLG: 10,
    },
    Input: {
      borderRadius: 8,
      colorBgContainer: '#27272a',
    },
    Select: {
      borderRadius: 8,
      colorBgContainer: '#27272a',
    },
    Tag: {
      borderRadiusSM: 6,
    },
    Alert: {
      borderRadius: 8,
    },
    Modal: {
      borderRadiusLG: 10,
      colorBgElevated: '#27272a',
    },
    Menu: {
      itemBorderRadius: 8,
      itemSelectedBg: '#27272a',
      itemSelectedColor: '#fafafa',
      itemColor: '#a1a1aa',
      itemHoverColor: '#fafafa',
      itemHoverBg: '#3f3f46',
    },
    Tabs: {
      inkBarColor: '#fafafa',
      itemSelectedColor: '#fafafa',
      itemHoverColor: '#fafafa',
      itemColor: '#a1a1aa',
    },
    Switch: {
      colorPrimary: '#fafafa',
      colorPrimaryHover: '#e4e4e7',
    },
    Steps: {
      navArrowColor: '#fafafa',
    },
    Table: {
      colorBgContainer: '#18181b',
      headerBg: '#27272a',
      rowHoverBg: '#27272a',
    },
  },
};

// 兼容旧代码
export const appTheme = lightTheme;
