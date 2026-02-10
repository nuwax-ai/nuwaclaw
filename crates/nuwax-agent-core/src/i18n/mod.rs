//! 国际化模块
//!
//! 支持中文和英文两种语言

use std::collections::HashMap;
use std::sync::{Arc, RwLock};

use serde::{Deserialize, Serialize};
use thiserror::Error;

/// 国际化错误
#[derive(Error, Debug)]
pub enum I18nError {
    #[error("不支持的语言: {0}")]
    UnsupportedLanguage(String),
    #[error("缺少翻译键: {0}")]
    MissingKey(String),
    #[error("加载失败: {0}")]
    LoadFailed(String),
}

/// 支持的语言
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize, Default)]
pub enum Language {
    /// 简体中文
    #[serde(rename = "zh")]
    #[default]
    Chinese,
    /// 英文
    #[serde(rename = "en")]
    English,
}

impl Language {
    /// 语言显示名称
    pub fn display_name(&self) -> &'static str {
        match self {
            Self::Chinese => "简体中文",
            Self::English => "English",
        }
    }

    /// 语言代码
    pub fn code(&self) -> &'static str {
        match self {
            Self::Chinese => "zh",
            Self::English => "en",
        }
    }

    /// 从代码解析
    pub fn from_code(code: &str) -> Option<Self> {
        match code {
            "zh" | "zh-CN" | "zh-Hans" => Some(Self::Chinese),
            "en" | "en-US" | "en-GB" => Some(Self::English),
            _ => None,
        }
    }

    /// 所有支持的语言
    pub fn all() -> &'static [Language] {
        &[Language::Chinese, Language::English]
    }
}

/// 翻译条目
type Translations = HashMap<String, String>;

/// 国际化管理器
pub struct I18nManager {
    /// 当前语言
    current: Arc<RwLock<Language>>,
    /// 翻译数据 (language -> key -> value)
    translations: HashMap<Language, Translations>,
}

impl Default for I18nManager {
    fn default() -> Self {
        Self::new()
    }
}

impl I18nManager {
    /// 创建新的国际化管理器
    pub fn new() -> Self {
        let mut manager = Self {
            current: Arc::new(RwLock::new(Language::default())),
            translations: HashMap::new(),
        };
        manager.load_builtin();
        manager
    }

    /// 设置当前语言
    pub fn set_language(&self, language: Language) {
        if let Ok(mut current) = self.current.write() {
            *current = language;
        }
    }

    /// 获取当前语言
    pub fn current_language(&self) -> Language {
        self.current.read().map(|l| *l).unwrap_or(Language::Chinese)
    }

    /// 获取翻译文本
    pub fn t(&self, key: &str) -> String {
        let lang = self.current_language();
        self.translations
            .get(&lang)
            .and_then(|t| t.get(key))
            .cloned()
            .unwrap_or_else(|| key.to_string())
    }

    /// 获取带参数的翻译文本
    pub fn t_with(&self, key: &str, args: &[(&str, &str)]) -> String {
        let mut text = self.t(key);
        for (name, value) in args {
            text = text.replace(&format!("{{{}}}", name), value);
        }
        text
    }

    /// 加载内置翻译
    fn load_builtin(&mut self) {
        // 中文翻译
        let zh = self.create_zh_translations();
        self.translations.insert(Language::Chinese, zh);

        // 英文翻译
        let en = self.create_en_translations();
        self.translations.insert(Language::English, en);
    }

    fn create_zh_translations(&self) -> Translations {
        let mut t = HashMap::new();

        // 通用
        t.insert("app.name".into(), "Nuwax Agent".into());
        t.insert("app.description".into(), "跨平台 AI Agent 客户端".into());

        // 状态栏
        t.insert("status.disconnected".into(), "未连接".into());
        t.insert("status.connecting".into(), "连接中...".into());
        t.insert("status.connected".into(), "已连接".into());
        t.insert("status.error".into(), "错误".into());
        t.insert("status.idle".into(), "空闲".into());
        t.insert("status.active".into(), "活跃".into());
        t.insert("status.executing".into(), "执行中".into());
        t.insert("status.dep_ok".into(), "依赖正常".into());
        t.insert("status.dep_missing".into(), "依赖缺失".into());

        // Tab 标签
        t.insert("tab.client_info".into(), "客户端信息".into());
        t.insert("tab.settings".into(), "设置".into());
        t.insert("tab.dependencies".into(), "依赖管理".into());
        t.insert("tab.permissions".into(), "权限设置".into());
        t.insert("tab.about".into(), "关于".into());
        t.insert("tab.chat".into(), "聊天".into());

        // 侧边栏分组
        t.insert("sidebar.navigation".into(), "导航".into());
        t.insert("sidebar.tools".into(), "工具".into());
        t.insert("sidebar.about".into(), "关于".into());

        // 设置页
        t.insert("settings.server".into(), "服务器配置".into());
        t.insert("settings.security".into(), "安全设置".into());
        t.insert("settings.general".into(), "常规设置".into());
        t.insert("settings.appearance".into(), "外观".into());
        t.insert("settings.logging".into(), "日志".into());
        t.insert("settings.language".into(), "语言".into());
        t.insert("settings.theme".into(), "主题".into());
        t.insert("settings.auto_launch".into(), "开机自启动".into());
        t.insert("settings.minimize_tray".into(), "最小化到托盘".into());

        // 操作
        t.insert("action.save".into(), "保存".into());
        t.insert("action.cancel".into(), "取消".into());
        t.insert("action.copy".into(), "复制".into());
        t.insert("action.refresh".into(), "刷新".into());
        t.insert("action.install".into(), "安装".into());
        t.insert("action.export".into(), "导出".into());
        t.insert("action.check_update".into(), "检查更新".into());

        // 密码
        t.insert("password.change".into(), "修改密码".into());
        t.insert("password.current".into(), "当前密码".into());
        t.insert("password.new".into(), "新密码".into());
        t.insert("password.confirm".into(), "确认密码".into());
        t.insert("password.strength.very_weak".into(), "非常弱".into());
        t.insert("password.strength.weak".into(), "弱".into());
        t.insert("password.strength.medium".into(), "中等".into());
        t.insert("password.strength.strong".into(), "强".into());
        t.insert("password.strength.very_strong".into(), "非常强".into());

        t
    }

    fn create_en_translations(&self) -> Translations {
        let mut t = HashMap::new();

        // General
        t.insert("app.name".into(), "Nuwax Agent".into());
        t.insert(
            "app.description".into(),
            "Cross-platform AI Agent Client".into(),
        );

        // Status bar
        t.insert("status.disconnected".into(), "Disconnected".into());
        t.insert("status.connecting".into(), "Connecting...".into());
        t.insert("status.connected".into(), "Connected".into());
        t.insert("status.error".into(), "Error".into());
        t.insert("status.idle".into(), "Idle".into());
        t.insert("status.active".into(), "Active".into());
        t.insert("status.executing".into(), "Executing".into());
        t.insert("status.dep_ok".into(), "Dependencies OK".into());
        t.insert("status.dep_missing".into(), "Dependencies Missing".into());

        // Tab labels
        t.insert("tab.client_info".into(), "Client Info".into());
        t.insert("tab.settings".into(), "Settings".into());
        t.insert("tab.dependencies".into(), "Dependencies".into());
        t.insert("tab.permissions".into(), "Permissions".into());
        t.insert("tab.about".into(), "About".into());
        t.insert("tab.chat".into(), "Chat".into());

        // Sidebar groups
        t.insert("sidebar.navigation".into(), "Navigation".into());
        t.insert("sidebar.tools".into(), "Tools".into());
        t.insert("sidebar.about".into(), "About".into());

        // Settings page
        t.insert("settings.server".into(), "Server Config".into());
        t.insert("settings.security".into(), "Security".into());
        t.insert("settings.general".into(), "General".into());
        t.insert("settings.appearance".into(), "Appearance".into());
        t.insert("settings.logging".into(), "Logging".into());
        t.insert("settings.language".into(), "Language".into());
        t.insert("settings.theme".into(), "Theme".into());
        t.insert("settings.auto_launch".into(), "Auto Launch".into());
        t.insert("settings.minimize_tray".into(), "Minimize to Tray".into());

        // Actions
        t.insert("action.save".into(), "Save".into());
        t.insert("action.cancel".into(), "Cancel".into());
        t.insert("action.copy".into(), "Copy".into());
        t.insert("action.refresh".into(), "Refresh".into());
        t.insert("action.install".into(), "Install".into());
        t.insert("action.export".into(), "Export".into());
        t.insert("action.check_update".into(), "Check Update".into());

        // Password
        t.insert("password.change".into(), "Change Password".into());
        t.insert("password.current".into(), "Current Password".into());
        t.insert("password.new".into(), "New Password".into());
        t.insert("password.confirm".into(), "Confirm Password".into());
        t.insert("password.strength.very_weak".into(), "Very Weak".into());
        t.insert("password.strength.weak".into(), "Weak".into());
        t.insert("password.strength.medium".into(), "Medium".into());
        t.insert("password.strength.strong".into(), "Strong".into());
        t.insert("password.strength.very_strong".into(), "Very Strong".into());

        t
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_language_default() {
        assert_eq!(Language::default(), Language::Chinese);
    }

    #[test]
    fn test_language_code() {
        assert_eq!(Language::Chinese.code(), "zh");
        assert_eq!(Language::English.code(), "en");
    }

    #[test]
    fn test_language_from_code() {
        assert_eq!(Language::from_code("zh"), Some(Language::Chinese));
        assert_eq!(Language::from_code("zh-CN"), Some(Language::Chinese));
        assert_eq!(Language::from_code("en"), Some(Language::English));
        assert_eq!(Language::from_code("en-US"), Some(Language::English));
        assert_eq!(Language::from_code("fr"), None);
    }

    #[test]
    fn test_i18n_manager_creation() {
        let manager = I18nManager::new();
        assert_eq!(manager.current_language(), Language::Chinese);
    }

    #[test]
    fn test_translation_zh() {
        let manager = I18nManager::new();
        assert_eq!(manager.t("app.name"), "Nuwax Agent");
        assert_eq!(manager.t("status.disconnected"), "未连接");
    }

    #[test]
    fn test_translation_en() {
        let manager = I18nManager::new();
        manager.set_language(Language::English);
        assert_eq!(manager.t("status.disconnected"), "Disconnected");
    }

    #[test]
    fn test_missing_key_returns_key() {
        let manager = I18nManager::new();
        assert_eq!(manager.t("nonexistent.key"), "nonexistent.key");
    }

    #[test]
    fn test_switch_language() {
        let manager = I18nManager::new();
        assert_eq!(manager.current_language(), Language::Chinese);

        manager.set_language(Language::English);
        assert_eq!(manager.current_language(), Language::English);
    }

    #[test]
    fn test_all_languages() {
        assert_eq!(Language::all().len(), 2);
    }
}
