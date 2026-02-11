// Tauri 命令层
pub mod autolaunch;
pub mod dependencies;
pub mod diagnostics;
pub mod permissions;
pub mod services;
pub mod setup_wizard;
pub mod system;

// 重新导出所有命令
pub use autolaunch::*;
pub use dependencies::*;
pub use diagnostics::*;
pub use permissions::*;
pub use services::*;
pub use setup_wizard::*;
pub use system::*;
