//! 远程桌面组件
//!
//! 接收屏幕帧渲染 + 键鼠事件转发

pub mod frame;
pub mod session;
pub mod state;
pub mod view;

// 重导出常用类型，保持向后兼容
pub use frame::{FrameData, VideoQuality};
pub use session::RemoteDesktopSession;
pub use state::{RemoteDesktopEvent, RemoteDesktopState};
pub use view::RemoteDesktopView;
