//! SettingsApi Trait
//!
//! 定义设置 ViewModel 的接口

use serde::Serialize;

// 主设置 Trait
#[async_trait::async_trait]
pub trait SettingsApi {
    type State: Serialize + Clone + Send + 'static;

    async fn state(&self) -> Self::State;
    fn state_snapshot(&self) -> Self::State;
    async fn switch_page(&self, page: Self::State);
}

/// 服务器配置 API Trait
#[async_trait::async_trait]
pub trait ServerConfigApi {
    type State: Serialize + Clone + Send + 'static;

    async fn state(&self) -> Self::State;
    fn state_snapshot(&self) -> Self::State;

    async fn update_hbbs_addr(&self, addr: String);
    async fn update_hbbr_addr(&self, addr: String);
    async fn save_config(&self);
    async fn test_connection(&self);
}

/// 常规设置 API Trait
#[async_trait::async_trait]
pub trait GeneralSettingsApi {
    type State: Serialize + Clone + Send + 'static;

    async fn state(&self) -> Self::State;
    fn state_snapshot(&self) -> Self::State;
    async fn toggle_auto_launch(&self);
}

/// 外观设置 API Trait
#[async_trait::async_trait]
pub trait AppearanceSettingsApi {
    type State: Serialize + Clone + Send + 'static;

    async fn state(&self) -> Self::State;
    fn state_snapshot(&self) -> Self::State;
    async fn update_theme(&self, theme: String);
}

/// JSON 配置 API Trait
#[async_trait::async_trait]
pub trait JsonConfigApi {
    type State: Serialize + Clone + Send + 'static;

    async fn state(&self) -> Self::State;
    fn state_snapshot(&self) -> Self::State;

    async fn update_json_content(&self, content: String);
    async fn apply_config(&self);
    async fn reload_config(&self);
}
