// 应用初始化和生命周期管理
mod builder;
mod events;
mod setup;

pub use builder::create_app;
pub use events::run;
pub use setup::setup_hook;
