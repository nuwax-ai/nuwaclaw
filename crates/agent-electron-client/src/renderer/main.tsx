import React, { useState, useEffect } from "react";
import ReactDOM from "react-dom/client";
import { ConfigProvider, Spin } from "antd";
import enUS from "antd/locale/en_US";
import zhCN from "antd/locale/zh_CN";
import zhTW from "antd/locale/zh_TW";
import zhHK from "antd/locale/zh_HK";
import "./monaco/setupMonaco";
import App from "./App";
import i18n, { initSupportedLangs } from "./services/i18n"; // 初始化 i18next（自动检测浏览器语言）
import { initI18n, getCurrentLang } from "./services/core/i18n"; // 初始化自定义 i18n 服务
import { rootTheme } from "./styles/theme";
import "./index.css";

// i18n 就绪标志（模块级别，由 initI18n 设置）
let i18nReady = false;
const i18nReadyListeners: Array<(ready: boolean) => void> = [];

function onI18nReady(callback: (ready: boolean) => void) {
  i18nReadyListeners.push(callback);
}

function notifyI18nReady(ready: boolean) {
  i18nReady = ready;
  i18nReadyListeners.forEach((cb) => cb(ready));
}

// 初始化 i18n（API 驱动 + 本地缓存）- 尽快开始
Promise.all([initSupportedLangs(), initI18n()])
  .then(async () => {
    const lang = getCurrentLang();
    try {
      await i18n.changeLanguage(lang);
    } catch {
      // ignore i18next sync failure, keep app booting
    }
    notifyI18nReady(true);
  })
  .catch((error) => {
    console.error(error);
    notifyI18nReady(true);
  });

// antd locale 映射
const antdLocales: Record<string, typeof zhCN> = {
  en: enUS,
  "en-us": enUS,
  "en-gb": enUS,
  zh: zhCN,
  "zh-cn": zhCN,
  "zh-hans": zhCN,
  "zh-tw": zhTW,
  "zh-hk": zhHK,
};

function resolveAntdLocale(lang: string) {
  const normalized = String(lang || "").toLowerCase();
  if (normalized.startsWith("zh-tw")) return zhTW;
  if (normalized.startsWith("zh-hk")) return zhHK;
  if (normalized.startsWith("zh")) return zhCN;
  if (normalized.startsWith("en")) return enUS;

  const exactMatch = antdLocales[normalized];
  return exactMatch || zhCN;
}

function toHtmlLang(lang: string): string {
  const normalized = String(lang || "").toLowerCase();
  if (normalized.startsWith("zh-tw")) return "zh-TW";
  if (normalized.startsWith("zh-hk")) return "zh-HK";
  if (normalized.startsWith("zh")) return "zh-CN";
  return "en-US";
}

function resolveBootLoadingText(): string {
  // 启动早期优先使用本地已知语言（缓存/current i18n/browser），未命中统一回退英文。
  const candidates = [
    getCurrentLang(),
    i18n.language,
    typeof navigator !== "undefined" ? navigator.language : "",
  ];
  const lang = String(candidates.find((v) => v) || "en-US").toLowerCase();

  if (lang.startsWith("zh-tw") || lang.startsWith("zh-hk")) return "載入中...";
  if (lang.startsWith("zh")) return "加载中...";
  return "Loading...";
}

function Main() {
  const [antdLocale, setAntdLocale] = useState(zhCN);
  const [ready, setReady] = useState(i18nReady);

  // 动态更新 antd locale（所有渲染都会执行）
  useEffect(() => {
    const updateLocale = () => {
      const lang = i18n.language || "zh-CN";
      document.documentElement.lang = toHtmlLang(lang);
      setAntdLocale(resolveAntdLocale(lang));
    };

    updateLocale();

    // 监听语言变化
    i18n.on("languageChanged", updateLocale);
    return () => {
      i18n.off("languageChanged", updateLocale);
    };
  }, []);

  // 订阅 i18n 就绪状态
  useEffect(() => {
    if (i18nReady) {
      setReady(true);
      return;
    }
    onI18nReady(setReady);
  }, []);

  // i18n 未就绪时显示加载状态（所有 hooks 已经在上面执行完毕）
  if (!ready) {
    return (
      <ConfigProvider locale={zhCN}>
        <div className="app-loading">
          <Spin size="large" />
          <div className="app-loading-text">{resolveBootLoadingText()}</div>
        </div>
      </ConfigProvider>
    );
  }

  return (
    <ConfigProvider locale={antdLocale} theme={rootTheme}>
      <App />
    </ConfigProvider>
  );
}

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <Main />
  </React.StrictMode>,
);
