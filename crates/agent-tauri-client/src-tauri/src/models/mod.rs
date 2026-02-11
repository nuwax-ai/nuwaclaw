// 数据模型层 (DTO - Data Transfer Objects)
pub mod dependencies;
pub mod diagnostics;
pub mod permissions;
pub mod services;
pub mod setup;

// 重新导出所有 DTO
pub use dependencies::*;
pub use permissions::*;
pub use services::*;
// setup 模块的 DTOs 在 setup_wizard 命令中使用时才需要
// pub use setup::*;
pub use diagnostics::*;
