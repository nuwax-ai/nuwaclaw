//! 权限管理 ViewModel
//!
//! 负责将 core::permissions 的业务数据转换为 UI 友好的格式

use std::sync::Arc;

use tokio::sync::{Mutex, RwLock};

use crate::core::permissions::{
    PermissionInfo, PermissionManager, PermissionStatus, PermissionType,
};

/// UI 层的权限状态（与 core::PermissionStatus 解耦）
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum UIPermissionStatus {
    /// 已授权
    Granted,
    /// 未授权
    Denied,
    /// 待确定
    NotDetermined,
    /// 不可用
    Unavailable,
}

impl UIPermissionStatus {
    /// 从核心状态转换
    pub fn from_core(status: PermissionStatus) -> Self {
        match status {
            PermissionStatus::Granted => Self::Granted,
            PermissionStatus::Denied => Self::Denied,
            PermissionStatus::NotDetermined => Self::NotDetermined,
            PermissionStatus::Unavailable => Self::Unavailable,
        }
    }

    /// 获取状态标签
    pub fn label(&self) -> &'static str {
        match self {
            Self::Granted => "已授权",
            Self::Denied => "未授权",
            Self::NotDetermined => "待确定",
            Self::Unavailable => "不可用",
        }
    }

    /// 是否已授权
    pub fn is_granted(&self) -> bool {
        matches!(self, Self::Granted)
    }
}

/// UI 层的权限项（与 core::PermissionInfo 解耦）
#[derive(Debug, Clone)]
pub struct UIPermissionItem {
    /// 权限类型
    pub permission_type: PermissionType,
    /// 显示名称
    pub display_name: String,
    /// 状态
    pub status: UIPermissionStatus,
    /// 说明
    pub description: String,
    /// 授权指引
    pub grant_instructions: Option<String>,
    /// 是否必需
    pub is_required: bool,
    /// 是否可以打开设置授权
    pub can_grant: bool,
}

impl UIPermissionItem {
    /// 从核心权限信息转换
    pub fn from_core(info: &PermissionInfo) -> Self {
        let core_status = info.status;
        let status = UIPermissionStatus::from_core(core_status);
        Self {
            permission_type: info.permission_type,
            display_name: info.permission_type.description().to_string(),
            status,
            description: info.description.clone(),
            grant_instructions: info.grant_instructions.clone(),
            is_required: info.permission_type.is_required(),
            // Unavailable 状态无法授权
            can_grant: status != UIPermissionStatus::Granted
                && status != UIPermissionStatus::Unavailable,
        }
    }
}

/// 权限操作
#[derive(Debug, Clone)]
pub enum PermissionsAction {
    /// 刷新权限状态
    Refresh,
    /// 打开系统设置授权
    OpenSettings(PermissionType),
}

/// 权限摘要信息
#[derive(Debug, Clone, Default)]
pub struct PermissionsSummary {
    /// 总数
    pub total: usize,
    /// 已授权数量
    pub granted: usize,
    /// 是否有未授权的必需权限
    pub has_missing_required: bool,
}

impl PermissionsSummary {
    /// 从权限列表生成摘要
    pub fn from_items(items: &[UIPermissionItem]) -> Self {
        let total = items.len();
        let granted = items.iter().filter(|p| p.status.is_granted()).count();
        let has_missing_required = items
            .iter()
            .any(|p| p.is_required && !p.status.is_granted());

        Self {
            total,
            granted,
            has_missing_required,
        }
    }
}

/// 权限管理 ViewModel 状态
#[derive(Debug, Clone)]
#[derive(Default)]
pub struct PermissionsViewModelState {
    /// 权限项列表
    pub items: Vec<UIPermissionItem>,
    /// 是否正在刷新
    pub is_refreshing: bool,
    /// 摘要信息
    pub summary: PermissionsSummary,
}


/// 权限管理 ViewModel
///
/// 负责：
/// - 将业务数据转换为 UI 友好的格式
/// - 处理用户操作（刷新、打开设置）
/// - 管理 UI 状态
pub struct PermissionsViewModel {
    /// UI 状态
    state: Arc<RwLock<PermissionsViewModelState>>,
    /// 业务层权限管理器引用（使用 Mutex 支持内部可变）
    core_manager: Arc<Mutex<PermissionManager>>,
}

impl PermissionsViewModel {
    /// 创建新的 ViewModel
    pub fn new(core_manager: Arc<Mutex<PermissionManager>>) -> Self {
        Self {
            state: Arc::new(RwLock::new(PermissionsViewModelState::default())),
            core_manager,
        }
    }

    /// 创建默认的 ViewModel（使用默认的 PermissionManager）
    #[allow(dead_code)]
    pub fn with_default_manager() -> Self {
        Self::new(Arc::new(Mutex::new(PermissionManager::new())))
    }

    /// 获取当前状态的快照
    pub async fn get_state(&self) -> PermissionsViewModelState {
        self.state.read().await.clone()
    }

    /// 获取权限项列表
    pub async fn items(&self) -> Vec<UIPermissionItem> {
        self.state.read().await.items.clone()
    }

    /// 获取摘要信息
    pub async fn summary(&self) -> PermissionsSummary {
        self.state.read().await.summary.clone()
    }

    /// 是否正在刷新
    pub async fn is_refreshing(&self) -> bool {
        self.state.read().await.is_refreshing
    }

    /// 处理用户操作
    pub async fn handle_action(&self, action: PermissionsAction) {
        match action {
            PermissionsAction::Refresh => self.refresh().await,
            PermissionsAction::OpenSettings(permission_type) => {
                self.open_settings(permission_type).await
            }
        }
    }

    /// 刷新权限状态
    pub async fn refresh(&self) {
        // 设置刷新状态
        {
            let mut state = self.state.write().await;
            state.is_refreshing = true;
        }

        // 调用核心层检查所有权限（需要获取锁来修改内部状态）
        {
            let mut manager = self.core_manager.lock().await;
            manager.check_all();
        }

        // 获取核心层结果并转换
        let core_permissions = {
            let manager = self.core_manager.lock().await;
            manager.permissions().to_vec()
        };
        let ui_items: Vec<UIPermissionItem> =
            core_permissions.iter().map(UIPermissionItem::from_core).collect();

        // 更新 UI 状态
        let summary = PermissionsSummary::from_items(&ui_items);
        let mut state = self.state.write().await;
        state.items = ui_items;
        state.summary = summary;
        state.is_refreshing = false;
    }

    /// 打开系统设置进行授权
    async fn open_settings(&self, permission_type: PermissionType) {
        let manager = self.core_manager.lock().await;
        if let Err(e) = manager.open_settings(permission_type) {
            tracing::error!("Failed to open settings for {:?}: {}", permission_type, e);
        }
    }

    /// 初始化并检查所有权限
    pub async fn initialize(&self) {
        self.refresh().await;
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_ui_permission_status_conversion() {
        assert_eq!(
            UIPermissionStatus::from_core(PermissionStatus::Granted),
            UIPermissionStatus::Granted
        );
        assert_eq!(
            UIPermissionStatus::from_core(PermissionStatus::Denied),
            UIPermissionStatus::Denied
        );
        assert_eq!(
            UIPermissionStatus::from_core(PermissionStatus::NotDetermined),
            UIPermissionStatus::NotDetermined
        );
        assert_eq!(
            UIPermissionStatus::from_core(PermissionStatus::Unavailable),
            UIPermissionStatus::Unavailable
        );
    }

    #[test]
    fn test_ui_permission_status_label() {
        assert_eq!(UIPermissionStatus::Granted.label(), "已授权");
        assert_eq!(UIPermissionStatus::Denied.label(), "未授权");
        assert_eq!(UIPermissionStatus::NotDetermined.label(), "待确定");
        assert_eq!(UIPermissionStatus::Unavailable.label(), "不可用");
    }

    #[test]
    fn test_ui_permission_status_is_granted() {
        assert!(UIPermissionStatus::Granted.is_granted());
        assert!(!UIPermissionStatus::Denied.is_granted());
        assert!(!UIPermissionStatus::NotDetermined.is_granted());
        assert!(!UIPermissionStatus::Unavailable.is_granted());
    }

    #[test]
    fn test_ui_permission_item_from_core() {
        let core_info = PermissionInfo {
            permission_type: PermissionType::Accessibility,
            status: PermissionStatus::Granted,
            description: "辅助功能权限".to_string(),
            grant_instructions: Some("系统设置 > 隐私与安全性 > 辅助功能".to_string()),
        };

        let ui_item = UIPermissionItem::from_core(&core_info);

        assert_eq!(ui_item.permission_type, PermissionType::Accessibility);
        assert_eq!(ui_item.display_name, "辅助功能");
        assert_eq!(ui_item.status, UIPermissionStatus::Granted);
        assert_eq!(ui_item.description, "辅助功能权限");
        assert_eq!(
            ui_item.grant_instructions,
            Some("系统设置 > 隐私与安全性 > 辅助功能".to_string())
        );
        assert!(ui_item.is_required);
        assert!(!ui_item.can_grant); // 已授权状态不可再授权
    }

    #[test]
    fn test_ui_permission_item_can_grant() {
        // Granted 状态不能授权
        let granted_info = PermissionInfo {
            permission_type: PermissionType::Accessibility,
            status: PermissionStatus::Granted,
            description: "测试".to_string(),
            grant_instructions: None,
        };
        assert!(!UIPermissionItem::from_core(&granted_info).can_grant);

        // Unavailable 状态不能授权
        let unavailable_info = PermissionInfo {
            permission_type: PermissionType::Accessibility,
            status: PermissionStatus::Unavailable,
            description: "测试".to_string(),
            grant_instructions: None,
        };
        assert!(!UIPermissionItem::from_core(&unavailable_info).can_grant);

        // Denied 状态可以授权
        let denied_info = PermissionInfo {
            permission_type: PermissionType::Accessibility,
            status: PermissionStatus::Denied,
            description: "测试".to_string(),
            grant_instructions: None,
        };
        assert!(UIPermissionItem::from_core(&denied_info).can_grant);

        // NotDetermined 状态可以授权
        let not_determined_info = PermissionInfo {
            permission_type: PermissionType::Accessibility,
            status: PermissionStatus::NotDetermined,
            description: "测试".to_string(),
            grant_instructions: None,
        };
        assert!(UIPermissionItem::from_core(&not_determined_info).can_grant);
    }

    #[test]
    fn test_permissions_summary_from_items() {
        let items = vec![
            UIPermissionItem {
                permission_type: PermissionType::Accessibility,
                display_name: "辅助功能".to_string(),
                status: UIPermissionStatus::Granted,
                description: "测试".to_string(),
                grant_instructions: None,
                is_required: true,
                can_grant: false,
            },
            UIPermissionItem {
                permission_type: PermissionType::ScreenRecording,
                display_name: "屏幕录制".to_string(),
                status: UIPermissionStatus::Denied,
                description: "测试".to_string(),
                grant_instructions: None,
                is_required: false,
                can_grant: true,
            },
            UIPermissionItem {
                permission_type: PermissionType::FileAccess,
                display_name: "文件访问".to_string(),
                status: UIPermissionStatus::Granted,
                description: "测试".to_string(),
                grant_instructions: None,
                is_required: true,
                can_grant: false,
            },
        ];

        let summary = PermissionsSummary::from_items(&items);

        assert_eq!(summary.total, 3);
        assert_eq!(summary.granted, 2);
        assert!(!summary.has_missing_required); // 所有必需权限都已授权
    }

    #[test]
    fn test_permissions_summary_has_missing_required() {
        let items = vec![
            UIPermissionItem {
                permission_type: PermissionType::Accessibility,
                display_name: "辅助功能".to_string(),
                status: UIPermissionStatus::Denied, // 未授权
                description: "测试".to_string(),
                grant_instructions: None,
                is_required: true,
                can_grant: true,
            },
            UIPermissionItem {
                permission_type: PermissionType::FileAccess,
                display_name: "文件访问".to_string(),
                status: UIPermissionStatus::Granted,
                description: "测试".to_string(),
                grant_instructions: None,
                is_required: true,
                can_grant: false,
            },
        ];

        let summary = PermissionsSummary::from_items(&items);

        assert_eq!(summary.total, 2);
        assert_eq!(summary.granted, 1);
        assert!(summary.has_missing_required); // 有必需权限未授权
    }

    #[tokio::test]
    async fn test_viewmodel_creation() {
        let vm = PermissionsViewModel::with_default_manager();
        let state = vm.get_state().await;

        assert!(state.items.is_empty());
        assert!(!state.is_refreshing);
    }

    #[tokio::test]
    async fn test_viewmodel_refresh() {
        let vm = PermissionsViewModel::with_default_manager();

        // 初始状态为空
        assert!(vm.items().await.is_empty());

        // 刷新后应有权限项
        vm.refresh().await;
        let items = vm.items().await;
        assert_eq!(items.len(), 5); // 5 种权限类型

        // 验证权限项数据
        let summary = vm.summary().await;
        assert_eq!(summary.total, 5);
        assert!(summary.granted <= 5);
    }
}
