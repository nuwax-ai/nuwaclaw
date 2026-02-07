import React from "react";
import ReactDOM from "react-dom/client";
import { ConfigProvider, theme } from "antd";
import App from "./App";
import "./App.css";

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <ConfigProvider
      theme={{
        algorithm: theme.defaultAlgorithm,
        token: {
          // shadcn/ui 风格: 中性色主色调
          colorPrimary: "#18181b", // zinc-900
          colorInfo: "#18181b",
          colorSuccess: "#16a34a", // green-600
          colorWarning: "#ca8a04", // yellow-600
          colorError: "#dc2626", // red-600
          colorTextBase: "#09090b", // zinc-950
          colorBgBase: "#ffffff",
          colorBorder: "#e4e4e7", // zinc-200
          colorBgContainer: "#ffffff",
          colorBgElevated: "#ffffff",
          colorBgLayout: "#fafafa", // zinc-50
          colorFillSecondary: "#f4f4f5", // zinc-100
          colorFillTertiary: "#f4f4f5",
          colorTextSecondary: "#71717a", // zinc-500
          colorTextTertiary: "#a1a1aa", // zinc-400
          colorTextQuaternary: "#d4d4d8", // zinc-300

          borderRadius: 6,
          borderRadiusLG: 8,
          borderRadiusSM: 4,
          fontFamily:
            '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, "Noto Sans", sans-serif',
          fontSize: 13,
          fontSizeHeading1: 24,
          fontSizeHeading2: 20,
          fontSizeHeading3: 16,
          fontSizeHeading4: 14,
          fontSizeHeading5: 13,
          lineWidth: 1,
          controlHeight: 32,
          controlHeightLG: 36,
          controlHeightSM: 28,
          boxShadow:
            "0 1px 2px 0 rgba(0, 0, 0, 0.03), 0 1px 6px -1px rgba(0, 0, 0, 0.02)",
          boxShadowSecondary: "0 1px 2px 0 rgba(0, 0, 0, 0.03)",
          paddingContentHorizontal: 16,
          paddingContentVertical: 12,
        },
        components: {
          Button: {
            fontWeight: 500,
            primaryShadow: "none",
            defaultBorderColor: "#e4e4e7",
            defaultColor: "#18181b",
            defaultBg: "#ffffff",
            defaultHoverBg: "#f4f4f5",
            defaultHoverColor: "#18181b",
            defaultHoverBorderColor: "#d4d4d8",
          },
          Card: {
            paddingLG: 16,
            headerFontSize: 13,
            headerFontSizeSM: 12,
          },
          Input: {
            activeBorderColor: "#a1a1aa",
            hoverBorderColor: "#a1a1aa",
            activeShadow: "0 0 0 2px rgba(24, 24, 27, 0.06)",
          },
          InputNumber: {
            activeBorderColor: "#a1a1aa",
            hoverBorderColor: "#a1a1aa",
            activeShadow: "0 0 0 2px rgba(24, 24, 27, 0.06)",
          },
          Select: {
            optionSelectedBg: "#f4f4f5",
          },
          Menu: {
            darkItemBg: "transparent",
            darkSubMenuItemBg: "transparent",
            itemBorderRadius: 6,
            itemMarginInline: 6,
            itemPaddingInline: 12,
          },
          Table: {
            headerBg: "#fafafa",
            headerColor: "#71717a",
            borderColor: "#f4f4f5",
          },
          Tag: {
            borderRadiusSM: 4,
          },
          Alert: {
            borderRadiusLG: 8,
          },
          Switch: {
            colorPrimary: "#18181b",
            colorPrimaryHover: "#27272a",
          },
          Badge: {
            dotSize: 6,
          },
          Descriptions: {
            labelBg: "#fafafa",
          },
          Steps: {
            colorPrimary: "#18181b",
          },
          Progress: {
            defaultColor: "#18181b",
          },
          Tabs: {
            inkBarColor: "#18181b",
            itemActiveColor: "#18181b",
            itemSelectedColor: "#18181b",
            itemHoverColor: "#52525b",
          },
        },
      }}
    >
      <App />
    </ConfigProvider>
  </React.StrictMode>,
);
