//! 设置 ViewModel
//!
//! 负责管理应用设置的加载、保存和业务逻辑

use std::sync::Arc;

use tokio::sync::RwLock;

use gpui_component::IconName;

/// UI 设置页面
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum UISettingsPage {
    /// 服务器配置
    Server,
    /// 安全设置
    Security,
    /// 常规设置
    General,
    /// 外观设置
    Appearance,
    /// 日志设置
    Logging,
}

impl UISettingsPage {
    /// 获取所有设置页面
    pub fn all() -> Vec<Self> {
        vec![
            Self::Server,
            Self::Security,
            Self::General,
            Self::Appearance,
            Self::Logging,
        ]
    }

    /// 获取页面标签
    pub fn label(&self) -> &'static str {
        match self {
            Self::Server => "服务器",
            Self::Security => "安全",
            Self::General => "常规",
            Self::Appearance => "外观",
            Self::Logging => "日志",
        }
    }

    /// 获取页面图标
    pub fn icon(&self) -> IconName {
        match self {
            Self::Server => IconName::Globe,
            Self::Security => IconName::Eye,
            Self::General => IconName::Settings,
            Self::Appearance => IconName::Palette,
            Self::Logging => IconName::File,
        }
    }
}

/// 服务器配置状态
#[derive(Debug, Clone, Default)]
pub struct ServerConfigState {
    /// HBBS 服务器地址
    pub hbbs_addr: String,
    /// HBBR 中继服务器地址
    pub hbbr_addr: String,
    /// 配置是否已修改
    pub modified: bool,
    /// 是否正在测试连接
    pub is_testing: bool,
    /// 测试结果 (成功, 消息)
    pub test_result: Option<(bool, String)>,
}

/// 常规设置状态
#[derive(Debug, Clone, Default)]
pub struct GeneralSettingsState {
    /// 是否开机自启动
    pub auto_launch: bool,
    /// 语言
    pub language: String,
}

/// 外观设置状态
#[derive(Debug, Clone, Default)]
pub struct AppearanceSettingsState {
    /// 主题
    pub theme: String,
}

/// 测试连接结果
#[derive(Debug, Clone)]
pub struct ConnectionTestResult {
    /// 是否成功
    pub success: bool,
    /// 消息
    pub message: String,
}

/// 设置操作
#[derive(Debug, Clone)]
pub enum SettingsAction {
    /// 更新 HBBS 地址
    UpdateHbbsAddr(String),
    /// 更新 HBBR 地址
    UpdateHbbrAddr(String),
    /// 保存服务器配置
    SaveServerConfig,
    /// 测试连接
    TestConnection,
    /// 切换设置页面
    SwitchPage(UISettingsPage),
    /// 切换开机自启动
    ToggleAutoLaunch,
    /// 更新主题
    UpdateTheme(String),
}

/// 服务器配置 ViewModel
///
/// 负责管理服务器配置的加载、保存和测试
#[derive(Clone)]
pub struct ServerConfigViewModel {
    /// UI 状态
    state: Arc<RwLock<ServerConfigState>>,
}

impl ServerConfigViewModel {
    /// 创建新的 ViewModel
    pub fn new() -> Self {
        Self {
            state: Arc::new(RwLock::new(ServerConfigState {
                hbbs_addr: "localhost:21116".to_string(),
                hbbr_addr: "localhost:21117".to_string(),
                modified: false,
                is_testing: false,
                test_result: None,
            })),
        }
    }

    /// 获取当前状态
    pub async fn get_state(&self) -> ServerConfigState {
        self.state.read().await.clone()
    }

    /// 获取 HBBS 地址
    pub async fn hbbs_addr(&self) -> String {
        self.state.read().await.hbbs_addr.clone()
    }

    /// 获取 HBBR 地址
    pub async fn hbbr_addr(&self) -> String {
        self.state.read().await.hbbr_addr.clone()
    }

    /// 检查是否已修改
    pub async fn is_modified(&self) -> bool {
        self.state.read().await.modified
    }

    /// 检查是否正在测试
    pub async fn is_testing(&self) -> bool {
        self.state.read().await.is_testing
    }

    /// 获取测试结果
    pub async fn test_result(&self) -> Option<(bool, String)> {
        self.state.read().await.test_result.clone()
    }

    /// 更新 HBBS 地址
    pub async fn update_hbbs_addr(&self, addr: String) {
        let mut state = self.state.write().await;
        state.hbbs_addr = addr;
        state.modified = true;
        state.test_result = None;
    }

    /// 更新 HBBR 地址
    pub async fn update_hbbr_addr(&self, addr: String) {
        let mut state = self.state.write().await;
        state.hbbr_addr = addr;
        state.modified = true;
        state.test_result = None;
    }

    /// 保存配置
    pub async fn save_config(&self) {
        let mut state = self.state.write().await;
        state.modified = false;
        state.test_result = Some((true, "配置已保存".to_string()));
        // TODO: 持久化配置到文件
    }

    /// 测试连接
    pub async fn test_connection(&self) {
        {
            let mut state = self.state.write().await;
            state.is_testing = true;
            state.test_result = None;
        }

        // 模拟连接测试
        tokio::time::sleep(tokio::time::Duration::from_millis(500)).await;

        let mut state = self.state.write().await;
        state.is_testing = false;
        // TODO: 实际测试连接逻辑
        state.test_result = Some((true, "连接测试成功".to_string()));
    }

    /// 处理服务器配置操作
    pub async fn handle_server_action(&self, action: SettingsAction) {
        match action {
            SettingsAction::UpdateHbbsAddr(addr) => self.update_hbbs_addr(addr).await,
            SettingsAction::UpdateHbbrAddr(addr) => self.update_hbbr_addr(addr).await,
            SettingsAction::SaveServerConfig => self.save_config().await,
            SettingsAction::TestConnection => self.test_connection().await,
            _ => {} // 其他操作不处理
        }
    }
}

impl Default for ServerConfigViewModel {
    fn default() -> Self {
        Self::new()
    }
}

/// 常规设置 ViewModel
#[derive(Clone)]
pub struct GeneralSettingsViewModel {
    /// UI 状态
    state: Arc<RwLock<GeneralSettingsState>>,
}

impl GeneralSettingsViewModel {
    /// 创建新的 ViewModel
    pub fn new() -> Self {
        Self {
            state: Arc::new(RwLock::new(GeneralSettingsState {
                auto_launch: false,
                language: "zh".to_string(),
            })),
        }
    }

    /// 获取当前状态
    pub async fn get_state(&self) -> GeneralSettingsState {
        self.state.read().await.clone()
    }

    /// 检查是否开机自启动
    pub async fn auto_launch(&self) -> bool {
        self.state.read().await.auto_launch
    }

    /// 获取语言
    pub async fn language(&self) -> String {
        self.state.read().await.language.clone()
    }

    /// 切换开机自启动
    pub async fn toggle_auto_launch(&self) {
        let mut state = self.state.write().await;
        state.auto_launch = !state.auto_launch;
        // TODO: 持久化设置
    }

    /// 处理常规设置操作
    pub async fn handle_general_action(&self, action: SettingsAction) {
        match action {
            SettingsAction::ToggleAutoLaunch => self.toggle_auto_launch().await,
            _ => {}
        }
    }
}

impl Default for GeneralSettingsViewModel {
    fn default() -> Self {
        Self::new()
    }
}

/// 外观设置 ViewModel
#[derive(Clone)]
pub struct AppearanceSettingsViewModel {
    /// UI 状态
    state: Arc<RwLock<AppearanceSettingsState>>,
}

impl AppearanceSettingsViewModel {
    /// 创建新的 ViewModel
    pub fn new() -> Self {
        Self {
            state: Arc::new(RwLock::new(AppearanceSettingsState {
                theme: "system".to_string(),
            })),
        }
    }

    /// 获取当前状态
    pub async fn get_state(&self) -> AppearanceSettingsState {
        self.state.read().await.clone()
    }

    /// 获取主题
    pub async fn theme(&self) -> String {
        self.state.read().await.theme.clone()
    }

    /// 更新主题
    pub async fn update_theme(&self, theme: String) {
        let mut state = self.state.write().await;
        state.theme = theme;
        // TODO: 持久化设置
    }

    /// 处理外观设置操作
    pub async fn handle_appearance_action(&self, action: SettingsAction) {
        match action {
            SettingsAction::UpdateTheme(theme) => self.update_theme(theme).await,
            _ => {}
        }
    }
}

impl Default for AppearanceSettingsViewModel {
    fn default() -> Self {
        Self::new()
    }
}

/// 主设置 ViewModel（聚合子 ViewModel）
#[derive(Clone)]
pub struct SettingsViewModel {
    /// 当前页面
    current_page: Arc<RwLock<UISettingsPage>>,
    /// 服务器配置 ViewModel
    server_config: Arc<ServerConfigViewModel>,
    /// 常规设置 ViewModel
    general_settings: Arc<GeneralSettingsViewModel>,
    /// 外观设置 ViewModel
    appearance_settings: Arc<AppearanceSettingsViewModel>,
}

impl SettingsViewModel {
    /// 创建新的 ViewModel
    pub fn new() -> Self {
        Self {
            current_page: Arc::new(RwLock::new(UISettingsPage::Server)),
            server_config: Arc::new(ServerConfigViewModel::new()),
            general_settings: Arc::new(GeneralSettingsViewModel::new()),
            appearance_settings: Arc::new(AppearanceSettingsViewModel::new()),
        }
    }

    /// 获取当前页面
    pub async fn current_page(&self) -> UISettingsPage {
        *self.current_page.read().await
    }

    /// 切换页面
    pub async fn switch_page(&self, page: UISettingsPage) {
        let mut current = self.current_page.write().await;
        *current = page;
    }

    /// 获取服务器配置 ViewModel
    pub fn server_config(&self) -> Arc<ServerConfigViewModel> {
        self.server_config.clone()
    }

    /// 获取常规设置 ViewModel
    pub fn general_settings(&self) -> Arc<GeneralSettingsViewModel> {
        self.general_settings.clone()
    }

    /// 获取外观设置 ViewModel
    pub fn appearance_settings(&self) -> Arc<AppearanceSettingsViewModel> {
        self.appearance_settings.clone()
    }

    /// 处理设置操作
    pub async fn handle_action(&self, action: SettingsAction) {
        match action {
            SettingsAction::SwitchPage(page) => self.switch_page(page).await,
            SettingsAction::UpdateHbbsAddr(_) => {
                self.server_config.handle_server_action(action).await
            }
            SettingsAction::UpdateHbbrAddr(_) => {
                self.server_config.handle_server_action(action).await
            }
            SettingsAction::SaveServerConfig => {
                self.server_config.handle_server_action(action).await
            }
            SettingsAction::TestConnection => {
                self.server_config.handle_server_action(action).await
            }
            SettingsAction::ToggleAutoLaunch => {
                self.general_settings.handle_general_action(action).await
            }
            SettingsAction::UpdateTheme(_) => {
                self.appearance_settings.handle_appearance_action(action).await
            }
        }
    }
}

impl Default for SettingsViewModel {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn test_server_config_viewmodel_creation() {
        let vm = ServerConfigViewModel::new();
        let state = vm.get_state().await;

        assert_eq!(state.hbbs_addr, "localhost:21116");
        assert_eq!(state.hbbr_addr, "localhost:21117");
        assert!(!state.modified);
        assert!(!state.is_testing);
        assert!(state.test_result.is_none());
    }

    #[tokio::test]
    async fn test_update_hbbs_addr() {
        let vm = ServerConfigViewModel::new();

        assert!(!vm.is_modified().await);

        vm.update_hbbs_addr("192.168.1.100:21116".to_string()).await;

        assert_eq!(vm.hbbs_addr().await, "192.168.1.100:21116");
        assert!(vm.is_modified().await);
    }

    #[tokio::test]
    async fn test_save_config() {
        let vm = ServerConfigViewModel::new();

        vm.update_hbbs_addr("new-address".to_string()).await;
        assert!(vm.is_modified().await);

        vm.save_config().await;

        assert!(!vm.is_modified().await);
        assert_eq!(vm.test_result().await, Some((true, "配置已保存".to_string())));
    }

    #[tokio::test]
    async fn test_general_settings_viewmodel() {
        let vm = GeneralSettingsViewModel::new();
        let state = vm.get_state().await;

        assert!(!state.auto_launch);
        assert_eq!(state.language, "zh");
    }

    #[tokio::test]
    async fn test_toggle_auto_launch() {
        let vm = GeneralSettingsViewModel::new();

        assert!(!vm.auto_launch().await);

        vm.toggle_auto_launch().await;
        assert!(vm.auto_launch().await);

        vm.toggle_auto_launch().await;
        assert!(!vm.auto_launch().await);
    }

    #[tokio::test]
    async fn test_appearance_settings_viewmodel() {
        let vm = AppearanceSettingsViewModel::new();
        let state = vm.get_state().await;

        assert_eq!(state.theme, "system");
    }

    #[tokio::test]
    async fn test_update_theme() {
        let vm = AppearanceSettingsViewModel::new();

        assert_eq!(vm.theme().await, "system");

        vm.update_theme("dark".to_string()).await;
        assert_eq!(vm.theme().await, "dark");
    }

    #[tokio::test]
    async fn test_settings_viewmodel_creation() {
        let vm = SettingsViewModel::new();

        assert_eq!(vm.current_page().await, UISettingsPage::Server);
    }

    #[tokio::test]
    async fn test_switch_page() {
        let vm = SettingsViewModel::new();

        assert_eq!(vm.current_page().await, UISettingsPage::Server);

        vm.switch_page(UISettingsPage::Appearance).await;
        assert_eq!(vm.current_page().await, UISettingsPage::Appearance);
    }
}
