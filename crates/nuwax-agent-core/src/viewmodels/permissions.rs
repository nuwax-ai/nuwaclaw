//! 权限管理 ViewModel
//!
//! 负责将 core::permissions 的业务数据转换为 UI 友好的格式

use std::sync::Arc;
use tokio::sync::RwLock;

use super::super::permissions::PermissionManager;
use super::super::permissions::PermissionStatus as CorePermissionStatus;

/// 权限状态枚举（UI 层使用）
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum UIPermissionStatus {
    /// 未知
    Unknown,
    /// 已授权
    Granted,
    /// 被拒绝
    Denied,
    /// 待确认
    Pending,
}

impl UIPermissionStatus {
    /// 获取状态标签
    pub fn label(&self) -> &'static str {
        match self {
            UIPermissionStatus::Unknown => "未知",
            UIPermissionStatus::Granted => "已授权",
            UIPermissionStatus::Denied => "已拒绝",
            UIPermissionStatus::Pending => "待确认",
        }
    }
}

/// UI 权限项
#[derive(Debug, Clone)]
pub struct UIPermissionItem {
    /// 权限名称
    pub name: String,
    /// 显示名称
    pub display_name: String,
    /// 描述
    pub description: String,
    /// 状态
    pub status: UIPermissionStatus,
    /// 是否可修改
    pub modifiable: bool,
}

/// 权限摘要
#[derive(Debug, Clone, Default)]
pub struct PermissionsSummary {
    /// 总权限数
    pub total: usize,
    /// 已授权数
    pub granted: usize,
    /// 被拒绝数
    pub denied: usize,
    /// 待确认数
    pub pending: usize,
}

/// 权限操作
#[derive(Debug, Clone)]
pub enum PermissionsAction {
    /// 刷新权限状态
    Refresh,
    /// 请求权限
    Request(String),
    /// 撤销权限
    Revoke(String),
}

/// 权限管理 ViewModel
#[derive(Clone)]
pub struct PermissionsViewModel {
    /// UI 状态
    state: Arc<RwLock<PermissionsViewModelState>>,
    /// 业务层引用
    core_manager: Arc<PermissionManager>,
}

impl Default for PermissionsViewModel {
    fn default() -> Self {
        Self::new()
    }
}

impl PermissionsViewModel {
    /// 创建新的 ViewModel
    pub fn new() -> Self {
        Self {
            state: Arc::new(RwLock::new(PermissionsViewModelState::default())),
            core_manager: Arc::new(PermissionManager::new()),
        }
    }

    /// 创建带有自定义 PermissionManager 的 ViewModel
    pub fn with_manager(manager: Arc<PermissionManager>) -> Self {
        Self {
            state: Arc::new(RwLock::new(PermissionsViewModelState::default())),
            core_manager: manager,
        }
    }

    /// 获取当前状态
    pub async fn get_state(&self) -> PermissionsViewModelState {
        self.state.read().await.clone()
    }

    /// 刷新权限状态
    pub async fn refresh(&self) {
        let core_perms = self.core_manager.get_all().await;

        let mut state = self.state.write().await;
        state.items.clear();
        state.items.extend(core_perms.into_iter().map(|p| {
            let status = self.core_to_ui_status(&p.status);
            // 根据状态决定是否可修改 - 已授权的可以撤销
            let modifiable = matches!(p.status, CorePermissionStatus::Granted);
            UIPermissionItem {
                name: p.name.clone(),
                display_name: p.display_name.clone(),
                description: p.description.clone(),
                status,
                modifiable,
            }
        }));

        // 更新摘要
        state.summary = Self::calculate_summary(&state.items);
    }

    /// 请求权限
    pub async fn request(&self, permission: &str) -> bool {
        let result = self.core_manager.request(permission).await;
        if result {
            self.refresh().await;
        }
        result
    }

    /// 撤销权限
    pub async fn revoke(&self, permission: &str) -> bool {
        let result = self.core_manager.revoke(permission).await;
        if result {
            self.refresh().await;
        }
        result
    }

    /// 处理权限操作
    pub async fn handle_action(&self, action: PermissionsAction) {
        match action {
            PermissionsAction::Refresh => self.refresh().await,
            PermissionsAction::Request(name) => {
                self.request(&name).await;
            }
            PermissionsAction::Revoke(name) => {
                self.revoke(&name).await;
            }
        }
    }

    /// 转换核心状态到 UI 状态
    fn core_to_ui_status(&self, status: &CorePermissionStatus) -> UIPermissionStatus {
        match status {
            CorePermissionStatus::Granted => UIPermissionStatus::Granted,
            CorePermissionStatus::Denied => UIPermissionStatus::Denied,
            CorePermissionStatus::Unknown => UIPermissionStatus::Unknown,
            CorePermissionStatus::Pending => UIPermissionStatus::Pending,
        }
    }

    /// 计算权限摘要（静态方法）
    fn calculate_summary(items: &[UIPermissionItem]) -> PermissionsSummary {
        let mut summary = PermissionsSummary::default();
        for item in items {
            summary.total += 1;
            match item.status {
                UIPermissionStatus::Granted => summary.granted += 1,
                UIPermissionStatus::Denied => summary.denied += 1,
                UIPermissionStatus::Pending => summary.pending += 1,
                UIPermissionStatus::Unknown => {}
            }
        }
        summary
    }
}

/// 权限管理 ViewModel 状态
#[derive(Debug, Clone, Default)]
pub struct PermissionsViewModelState {
    /// 权限项列表
    pub items: Vec<UIPermissionItem>,
    /// 权限摘要
    pub summary: PermissionsSummary,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn test_permissions_viewmodel_creation() {
        let vm = PermissionsViewModel::new();
        let state = vm.get_state().await;

        assert!(state.items.is_empty());
    }

    #[tokio::test]
    async fn test_permissions_refresh() {
        let vm = PermissionsViewModel::new();

        vm.refresh().await;
        let state = vm.get_state().await;

        // 权限列表应该不为空
        assert!(!state.items.is_empty());
    }
}
