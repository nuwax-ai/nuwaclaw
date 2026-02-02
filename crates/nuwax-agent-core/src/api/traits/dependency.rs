//! DependencyApi Trait
//!
//! 定义依赖管理 ViewModel 的接口

use serde::Serialize;

/// DependencyApi Trait
///
/// 定义依赖管理 ViewModel 的所有可用操作。
#[async_trait::async_trait]
pub trait DependencyApi {
    /// 状态类型（必须可序列化）
    type State: Serialize + Clone + Send + 'static;

    /// 获取当前状态
    async fn state(&self) -> Self::State;

    /// 同步获取状态快照（用于 Tauri 命令）
    fn state_snapshot(&self) -> Self::State;

    /// 刷新所有依赖状态
    async fn refresh(&self);

    /// 安装指定依赖
    ///
    /// # Arguments
    /// * `name` - 依赖名称
    async fn install(&self, name: &str);

    /// 安装所有缺失依赖
    async fn install_all(&self);
}
