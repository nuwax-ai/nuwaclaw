//! 连接管理模块
//!
//! 管理与 data-server 的连接状态以及 P2P/Relay 连接

pub mod adapter;
pub mod business_handler;
pub mod heartbeat;
pub mod peer;
pub mod reconnect;
pub mod state;

pub use adapter::{AdapterEvent, ConnectionAdapter, RustDeskAdapter};
pub use business_handler::{BusinessHandlerEvent, BusinessMessageHandler};
pub use heartbeat::HeartbeatManager;
pub use peer::{
    InputEvent, MouseButton, PeerConnection, PeerConnectionConfig, PeerConnectionEvent,
};
pub use reconnect::ReconnectManager;
pub use state::{
    ConnectionConfig, ConnectionEvent, ConnectionManager, ConnectionMode, ConnectionState,
};
