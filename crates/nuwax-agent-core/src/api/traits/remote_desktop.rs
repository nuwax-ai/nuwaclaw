//! RemoteDesktopApi Trait
//!
//! 定义远程桌面 ViewModel 的接口

use serde::Serialize;

/// RemoteDesktopApi Trait
///
/// 定义远程桌面 ViewModel 的所有可用操作。
#[async_trait::async_trait]
pub trait RemoteDesktopApi {
    /// 状态类型（必须可序列化）
    type State: Serialize + Clone + Send + 'static;

    /// 获取当前状态
    async fn state(&self) -> Self::State;

    /// 同步获取状态快照（用于 Tauri 命令）
    fn state_snapshot(&self) -> Self::State;

    /// 开始连接
    ///
    /// # Arguments
    /// * `remote_id` - 远程桌面 ID
    async fn connect(&self, remote_id: String);

    /// 断开连接
    async fn disconnect(&self);
}
