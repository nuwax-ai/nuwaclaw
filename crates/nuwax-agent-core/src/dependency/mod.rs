//! 依赖管理模块
//!
//! 管理 Agent 运行所需的依赖（Node.js、npm 工具等）

pub mod cli_tools;
pub mod detector;
pub mod docker;
pub mod git;
pub mod manager;
pub mod node;
pub mod npm_tools;
pub mod python;
pub mod uv;

pub use cli_tools::{
    create_curl_detector, create_ffmpeg_detector, create_jq_detector, create_pandoc_detector,
    create_rust_detector, create_tar_detector, create_wget_detector, CliToolDetector,
};
pub use detector::{
    DependencyDetector, DetectionResult, DetectorError, InstallerError, ToolInfo, ToolInstaller,
};
pub use docker::{DockerDetector, DockerInfo};
pub use git::{GitDetector, GitInfo};
pub use manager::{DependencyItem, DependencyManager, DependencyStatus, DependencySummary};
pub use node::{NodeDetector, NodeInfo, NodeInstaller};
pub use npm_tools::NpmToolInstaller;
pub use python::{PythonDetector, PythonInfo};
pub use uv::{UvDetector, UvInfo, UvInstaller};
