import React, { useState, useEffect } from "react";
import ReactDOM from "react-dom/client";
import { ConfigProvider, theme } from "antd";
import enUS from "antd/locale/en_US";
import zhCN from "antd/locale/zh_CN";
import App from "./App";
import i18n from "./services/i18n"; // 初始化 i18next（自动检测浏览器语言）
import { initI18n } from "./services/core/i18n"; // 初始化自定义 i18n 服务
import "./index.css";

// 初始化 i18n（API 驱动 + 本地缓存）
initI18n();

// antd locale 映射
const antdLocales: Record<string, typeof zhCN> = {
  en: enUS,
  "en-US": enUS,
  "en-gb": enUS,
  zh: zhCN,
  "zh-CN": zhCN,
  "zh-Hans": zhCN,
};

function Main() {
  const [antdLocale, setAntdLocale] = useState(zhCN);

  useEffect(() => {
    // 动态更新 antd locale
    const updateLocale = () => {
      const lang = i18n.language || "zh-CN";
      // 匹配最接近的语言
      const matchedLocale = Object.keys(antdLocales).find((key) =>
        lang.toLowerCase().startsWith(key.toLowerCase()),
      );
      setAntdLocale(antdLocales[matchedLocale || "zh-CN"] || zhCN);
    };

    updateLocale();

    // 监听语言变化
    i18n.on("languageChanged", updateLocale);
    return () => {
      i18n.off("languageChanged", updateLocale);
    };
  }, []);

  return (
    <ConfigProvider
      locale={antdLocale}
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
  );
}

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <Main />
  </React.StrictMode>,
);
