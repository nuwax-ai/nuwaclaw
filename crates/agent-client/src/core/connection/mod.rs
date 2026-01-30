//! 连接管理模块
//!
//! 管理与 data-server 的连接状态以及 P2P/Relay 连接

pub mod adapter;
pub mod state;
pub mod heartbeat;
pub mod reconnect;
pub mod peer;

pub use adapter::{RustDeskAdapter, AdapterEvent};
pub use state::{ConnectionState, ConnectionMode, ConnectionManager, ConnectionConfig, ConnectionEvent};
pub use heartbeat::HeartbeatManager;
pub use reconnect::ReconnectManager;
pub use peer::{PeerConnection, PeerConnectionConfig, PeerConnectionEvent, InputEvent, MouseButton};
