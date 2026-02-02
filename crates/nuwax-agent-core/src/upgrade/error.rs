//! 升级错误定义

use thiserror::Error;

/// 升级错误
#[derive(Error, Debug)]
pub enum UpgradeError {
    #[error("检查更新失败: {0}")]
    CheckFailed(String),
    #[error("下载失败: {0}")]
    DownloadFailed(String),
    #[error("安装失败: {0}")]
    InstallFailed(String),
    #[error("校验失败: {0}")]
    VerifyFailed(String),
    #[error("网络错误: {0}")]
    NetworkError(String),
    #[error("IO 错误: {0}")]
    IoError(#[from] std::io::Error),
}
