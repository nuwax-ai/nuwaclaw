//! 依赖管理模块
//!
//! 管理 Agent 运行所需的依赖（Node.js、npm 工具等）

pub mod detector;
pub mod manager;
pub mod node;
pub mod npm_tools;

pub use detector::{DependencyDetector, DetectionResult, DetectorError, InstallerError, ToolInfo, ToolInstaller};
pub use manager::{DependencyManager, DependencyStatus, DependencyItem};
pub use node::{NodeDetector, NodeInfo, NodeInstaller};
pub use npm_tools::NpmToolInstaller;
