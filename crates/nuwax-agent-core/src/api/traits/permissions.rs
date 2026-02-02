//! PermissionsApi Trait
//!
//! 定义权限管理 ViewModel 的接口

use serde::Serialize;

/// PermissionsApi Trait
///
/// 定义权限管理 ViewModel 的所有可用操作。
#[async_trait::async_trait]
pub trait PermissionsApi {
    /// 状态类型（必须可序列化）
    type State: Serialize + Clone + Send + 'static;

    /// 获取当前状态
    async fn state(&self) -> Self::State;

    /// 同步获取状态快照（用于 Tauri 命令）
    fn state_snapshot(&self) -> Self::State;

    /// 刷新权限状态
    async fn refresh(&self);

    /// 请求权限
    ///
    /// # Arguments
    /// * `permission` - 权限名称
    ///
    /// # Returns
    /// 是否请求成功
    async fn request(&self, permission: &str) -> bool;

    /// 撤销权限
    ///
    /// # Arguments
    /// * `permission` - 权限名称
    ///
    /// # Returns
    /// 是否撤销成功
    async fn revoke(&self, permission: &str) -> bool;

    /// 打开系统设置
    ///
    /// # Arguments
    /// * `permission` - 权限名称
    async fn open_settings(&self, permission: &str);
}
