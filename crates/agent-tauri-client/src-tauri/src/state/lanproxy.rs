// Lanproxy 状态管理模块
use tauri_plugin_shell::process::{CommandChild, CommandEvent};
use tokio::sync::{mpsc::Receiver, Mutex};

/// Lanproxy 进程状态管理（使用 Tauri sidecar API）
///
/// 直接管理 Tauri CommandChild，不依赖 Core 层的 process_wrap
#[derive(Default)]
pub struct LanproxyState {
    /// Tauri sidecar CommandChild（进程句柄）
    pub child: Mutex<Option<CommandChild>>,
    /// 事件接收器（stdout/stderr/terminated 等）
    pub receiver: Mutex<Option<Receiver<CommandEvent>>>,
}
