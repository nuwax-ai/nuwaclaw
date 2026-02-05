//! Agent Runner 模块
//!
//! 提供与 rcoder agent_runner 的集成实现
//!
//! ## 架构
//!
//! 此模块实现了 `AgentRunnerApi` trait，使用 rcoder 的 agent_runner 库
//! 作为后端处理 Agent 请求。
//!
//! ## 使用方式
//!
//! ```rust,ignore
//! use nuwax_agent_core::agent_runner::{RcoderAgentRunner, RcoderAgentRunnerConfig};
//!
//! let config = RcoderAgentRunnerConfig {
//!     projects_dir: PathBuf::from("./projects"),
//!     api_key: Some("sk-antic03-...".to_string()),
//!     api_base_url: "https://api.anthropic.com".to_string(),
//!     default_model: "claude-sonnet-4-20250514".to_string(),
//! };
//!
//! let runner = RcoderAgentRunner::new(config);
//! runner.start().await;
//! ```

pub mod rcoder_impl;

pub use rcoder_impl::{RcoderAgentRunner, RcoderAgentRunnerConfig};

#[cfg(test)]
mod tests;
