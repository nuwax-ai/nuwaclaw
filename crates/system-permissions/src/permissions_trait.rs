//! 权限管理 Trait 定义
//!
//! 定义跨平台权限管理的核心 Trait

use async_trait::async_trait;
use tokio::sync::broadcast;

use crate::{PermissionError, PermissionState, RequestOptions, RequestResult, SystemPermission};

/// 权限状态变化回调
///
/// 当权限状态发生变化时调用此回调
pub trait PermissionChangeCallback: Send + Sync {
    /// 权限状态变化通知
    fn on_change(&self, permission: SystemPermission, state: PermissionState);
}

/// 跨平台权限管理器 Trait
///
/// 定义权限管理的核心操作：检查权限状态、请求权限、打开设置等
#[async_trait]
pub trait PermissionManager: Send + Sync {
    /// 获取支持的权限列表
    fn supported_permissions(&self) -> Vec<SystemPermission>;

    /// 检查单个权限状态
    async fn check(&self, permission: SystemPermission) -> PermissionState;

    /// 批量检查权限状态
    async fn check_all(&self, permissions: &[SystemPermission]) -> Vec<PermissionState>;

    /// 请求单个权限
    async fn request(&self, permission: SystemPermission, options: RequestOptions)
        -> RequestResult;

    /// 批量请求权限
    async fn request_all(
        &self,
        permissions: &[SystemPermission],
        options: RequestOptions,
    ) -> Vec<RequestResult>;

    /// 打开系统设置页面
    async fn open_settings(&self, permission: SystemPermission) -> Result<(), PermissionError>;
}

/// 权限监控器 Trait
///
/// 用于监控权限状态变化的组件
#[async_trait]
pub trait PermissionMonitor: Send + Sync {
    /// 启动监控
    async fn start(&self) -> Result<(), PermissionError>;

    /// 停止监控
    async fn stop(&self);

    /// 订阅权限变化事件
    fn subscribe(&self) -> broadcast::Receiver<(SystemPermission, PermissionState)>;

    /// 获取当前所有权限状态
    async fn get_all_states(&self) -> Vec<PermissionState>;
}

/// 权限请求构建器
///
/// 提供流畅的接口构建权限请求选项
#[derive(Debug)]
pub struct RequestBuilder {
    interactive: bool,
    timeout_ms: u64,
    reason: Option<String>,
    verbose_errors: bool,
}

impl Default for RequestBuilder {
    fn default() -> Self {
        Self {
            interactive: true,
            timeout_ms: 30_000,
            reason: None,
            verbose_errors: true,
        }
    }
}

impl RequestBuilder {
    /// 创建新的请求构建器
    pub fn new() -> Self {
        Self::default()
    }

    /// 设置为交互式请求
    pub fn interactive(mut self) -> Self {
        self.interactive = true;
        self
    }

    /// 设置为非交互式请求
    pub fn non_interactive(mut self) -> Self {
        self.interactive = false;
        self
    }

    /// 设置超时时间
    pub fn timeout(mut self, ms: u64) -> Self {
        self.timeout_ms = ms;
        self
    }

    /// 设置理由消息
    pub fn reason(mut self, reason: impl Into<String>) -> Self {
        self.reason = Some(reason.into());
        self
    }

    /// 构建 RequestOptions
    pub fn build(self) -> RequestOptions {
        RequestOptions {
            interactive: self.interactive,
            timeout_ms: self.timeout_ms,
            reason: self.reason,
            verbose_errors: self.verbose_errors,
        }
    }
}

impl RequestBuilder {
    /// 使用当前配置请求权限
    pub async fn request(
        self,
        manager: &dyn PermissionManager,
        permission: SystemPermission,
    ) -> RequestResult {
        let options = self.build();
        manager.request(permission, options).await
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_request_builder_default() {
        let builder = RequestBuilder::new();
        let options = builder.build();
        assert!(options.interactive);
        assert_eq!(options.timeout_ms, 30_000);
        assert!(options.reason.is_none());
    }

    #[test]
    fn test_request_builder_custom() {
        let builder = RequestBuilder::new()
            .non_interactive()
            .timeout(60_000)
            .reason("Test reason");

        let options = builder.build();
        assert!(!options.interactive);
        assert_eq!(options.timeout_ms, 60_000);
        assert_eq!(options.reason, Some("Test reason".to_string()));
    }
}
