//! ClientInfoApi Trait
//!
//! 定义客户端信息 ViewModel 的接口

use serde::Serialize;

/// ClientInfoApi Trait
///
/// 定义客户端信息 ViewModel 的所有可用操作。
#[async_trait::async_trait]
pub trait ClientInfoApi {
    /// 状态类型（必须可序列化）
    type State: Serialize + Clone + Send + 'static;

    /// 获取当前状态
    async fn state(&self) -> Self::State;

    /// 同步获取状态快照（用于 Tauri 命令）
    fn state_snapshot(&self) -> Self::State;

    /// 设置客户端 ID
    ///
    /// # Arguments
    /// * `id` - 客户端 ID
    async fn set_client_id(&self, id: Option<String>);

    /// 设置连接状态
    ///
    /// # Arguments
    /// * `connected` - 是否已连接
    async fn set_connected(&self, connected: bool);

    /// 更新连接地址
    ///
    /// # Arguments
    /// * `addr` - 连接地址
    async fn update_connection_addr(&self, addr: Option<String>);
}
