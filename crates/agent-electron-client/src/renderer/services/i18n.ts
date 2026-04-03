/**
 * i18n 配置
 * 使用 HTTP Backend 从后端 /api/i18n/query 获取翻译
 * 自动根据浏览器语言选择翻译
 *
 * 注意：此文件仅用于初始化 i18next
 * 实际翻译使用 @/services/core/i18n 中的 dict() 函数
 */

import i18n from "i18next";
import { initReactI18next } from "react-i18next";

i18n.init({
  lng: "en",
  fallbackLng: "en",
  supportedLngs: ["en", "zh", "zh-CN"],
  interpolation: {
    escapeValue: false,
  },
  react: {
    useSuspense: false,
  },
});

export default i18n;
