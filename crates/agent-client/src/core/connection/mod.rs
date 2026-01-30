//! 连接管理模块
//!
//! 管理与 data-server 的连接状态

pub mod state;
pub mod heartbeat;
pub mod reconnect;

pub use state::{ConnectionState, ConnectionMode, ConnectionManager, ConnectionConfig, ConnectionEvent};
pub use heartbeat::HeartbeatManager;
pub use reconnect::ReconnectManager;
