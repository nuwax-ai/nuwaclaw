//! Phase 6 单元测试 - 收尾完善
//!
//! 测试国际化、聊天状态

#[cfg(test)]
mod i18n_tests {
    use nuwax_agent::i18n::{I18nManager, Language};

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
    fn test_language_display_name() {
        assert_eq!(Language::Chinese.display_name(), "简体中文");
        assert_eq!(Language::English.display_name(), "English");
    }

    #[test]
    fn test_language_from_code() {
        assert_eq!(Language::from_code("zh"), Some(Language::Chinese));
        assert_eq!(Language::from_code("zh-CN"), Some(Language::Chinese));
        assert_eq!(Language::from_code("zh-Hans"), Some(Language::Chinese));
        assert_eq!(Language::from_code("en"), Some(Language::English));
        assert_eq!(Language::from_code("en-US"), Some(Language::English));
        assert_eq!(Language::from_code("en-GB"), Some(Language::English));
        assert_eq!(Language::from_code("fr"), None);
        assert_eq!(Language::from_code("ja"), None);
    }

    #[test]
    fn test_all_languages() {
        let langs = Language::all();
        assert_eq!(langs.len(), 2);
        assert!(langs.contains(&Language::Chinese));
        assert!(langs.contains(&Language::English));
    }

    #[test]
    fn test_i18n_manager_default_language() {
        let manager = I18nManager::new();
        assert_eq!(manager.current_language(), Language::Chinese);
    }

    #[test]
    fn test_i18n_translation_zh() {
        let manager = I18nManager::new();
        assert_eq!(manager.t("app.name"), "Nuwax Agent");
        assert_eq!(manager.t("status.disconnected"), "未连接");
        assert_eq!(manager.t("status.connected"), "已连接");
        assert_eq!(manager.t("tab.settings"), "设置");
        assert_eq!(manager.t("action.save"), "保存");
    }

    #[test]
    fn test_i18n_translation_en() {
        let manager = I18nManager::new();
        manager.set_language(Language::English);

        assert_eq!(manager.t("app.name"), "Nuwax Agent");
        assert_eq!(manager.t("status.disconnected"), "Disconnected");
        assert_eq!(manager.t("status.connected"), "Connected");
        assert_eq!(manager.t("tab.settings"), "Settings");
        assert_eq!(manager.t("action.save"), "Save");
    }

    #[test]
    fn test_i18n_switch_language() {
        let manager = I18nManager::new();

        // Default: Chinese
        assert_eq!(manager.t("status.idle"), "空闲");

        // Switch to English
        manager.set_language(Language::English);
        assert_eq!(manager.t("status.idle"), "Idle");

        // Switch back to Chinese
        manager.set_language(Language::Chinese);
        assert_eq!(manager.t("status.idle"), "空闲");
    }

    #[test]
    fn test_i18n_missing_key() {
        let manager = I18nManager::new();
        assert_eq!(manager.t("nonexistent.key"), "nonexistent.key");
    }

    #[test]
    fn test_i18n_password_translations() {
        let manager = I18nManager::new();
        assert_eq!(manager.t("password.change"), "修改密码");
        assert_eq!(manager.t("password.strength.strong"), "强");

        manager.set_language(Language::English);
        assert_eq!(manager.t("password.change"), "Change Password");
        assert_eq!(manager.t("password.strength.strong"), "Strong");
    }
}
