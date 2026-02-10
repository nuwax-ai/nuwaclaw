//! P2P 连接管理模块
//!
//! 管理 admin-server 与 agent-client 之间的 P2P/Relay 连接。
//!
//! # 架构
//!
//! ```text
//! ┌─────────────────────────────────────────────────────────┐
//! │ PeerConnectionManager<T: Transport>                      │
//! │   └── 依赖 Transport trait ← 可注入 mock                 │
//! │   └── 生产环境: RustDeskTransport                        │
//! │   └── 测试环境: MockTransport                            │
//! └─────────────────────────────────────────────────────────┘
//! ```
//!
//! # 设计原则
//!
//! - **依赖倒置（DIP）**：高层模块依赖抽象，不依赖具体实现
//! - **接口隔离（ISP）**：定义小而专注的 Transport trait
//! - **单一职责（SRP）**：传输层、连接管理、消息派发分离

mod manager;
mod rustdesk_transport;
mod transport;

pub use manager::PeerConnectionManager;
pub use rustdesk_transport::RustDeskTransport;
pub use transport::Transport;

#[cfg(test)]
pub use transport::mock::MockTransport;
