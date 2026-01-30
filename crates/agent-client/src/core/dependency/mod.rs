//! 依赖管理模块
//!
//! 管理 Agent 运行所需的依赖（Node.js、npm 工具等）

pub mod node;
pub mod npm_tools;
pub mod manager;

pub use node::{NodeDetector, NodeInstaller, NodeInfo};
pub use npm_tools::NpmToolInstaller;
pub use manager::DependencyManager;
