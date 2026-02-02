//! nuwax-agent - 跨平台 Agent 客户端 (GPUI 实现)
//!
//! 支持远程桌面、文件传输、Agent 任务执行等功能
//!
//! ## 架构
//!
//! ```text
//! ┌─────────────────────────────────────────────────────────────┐
//! │                    agent-gpui-client                         │
//! │  UI 层 - GPUI 组件实现，依赖 gpui 和 gpui-component          │
//! └────────────────────┬────────────────────────────────────────┘
//!                      │ 依赖 nuwax-agent-core
//!                      ↓
//! ┌─────────────────────────────────────────────────────────────┐
//! │                      nuwax-agent-core                        │
//! │  核心层 - 纯业务逻辑，无 UI 依赖                              │
//! └─────────────────────────────────────────────────────────────┘
//! ```

pub mod app;
pub mod components;
pub mod tray;
pub mod viewmodels;

// 从 nuwax-agent-core 导出核心类型
pub use nuwax_agent_core::AppConfig;

// 导出公共 API
pub use app::App;
