//! 文件传输管理模块
//!
//! 管理客户端与服务器之间的文件传输

use std::path::PathBuf;
use thiserror::Error;
use tracing::debug;

/// 文件传输错误
#[derive(Error, Debug)]
pub enum FileTransferError {
    #[error("传输失败: {0}")]
    TransferFailed(String),
    #[error("文件不存在: {0}")]
    FileNotFound(PathBuf),
    #[error("权限不足")]
    PermissionDenied,
    #[error("传输已取消")]
    Cancelled,
}

/// 传输状态
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum TransferStatus {
    /// 等待中
    Pending,
    /// 传输中
    Transferring,
    /// 完成
    Completed,
    /// 失败
    Failed,
    /// 取消
    Cancelled,
}

/// 文件传输项
#[derive(Debug, Clone)]
pub struct FileTransferItem {
    /// 文件名
    pub name: String,
    /// 源路径
    pub source_path: PathBuf,
    /// 目标路径
    pub dest_path: PathBuf,
    /// 文件大小
    pub size: u64,
    /// 已传输大小
    pub transferred: u64,
    /// 状态
    pub status: TransferStatus,
    /// 错误信息
    pub error: Option<String>,
}

impl FileTransferItem {
    /// 创建新的传输项
    pub fn new(name: impl Into<String>, source: PathBuf, dest: PathBuf, size: u64) -> Self {
        Self {
            name: name.into(),
            source_path: source,
            dest_path: dest,
            size,
            transferred: 0,
            status: TransferStatus::Pending,
            error: None,
        }
    }

    /// 获取传输进度（0.0 - 1.0）
    pub fn progress(&self) -> f64 {
        if self.size == 0 {
            0.0
        } else {
            self.transferred as f64 / self.size as f64
        }
    }
}

/// 文件传输管理器
pub struct FileTransferManager {
    /// 传输队列
    transfers: Vec<FileTransferItem>,
    /// 当前传输索引
    current_index: usize,
}

impl Default for FileTransferManager {
    fn default() -> Self {
        Self::new()
    }
}

impl FileTransferManager {
    /// 创建新的传输管理器
    pub fn new() -> Self {
        Self {
            transfers: Vec::new(),
            current_index: 0,
        }
    }

    /// 添加传输任务
    pub fn add_transfer(&mut self, name: impl Into<String>, source: PathBuf, dest: PathBuf, size: u64) {
        self.transfers.push(FileTransferItem::new(name, source, dest, size));
    }

    /// 开始传输
    pub async fn start_transfer(&mut self, index: usize) -> Result<(), FileTransferError> {
        if index >= self.transfers.len() {
            return Err(FileTransferError::TransferFailed("Invalid transfer index".to_string()));
        }

        let transfer = &mut self.transfers[index];
        transfer.status = TransferStatus::Transferring;

        debug!("Starting transfer: {}", transfer.name);

        // 实际实现需要调用底层传输逻辑
        // 这里只是模拟
        Ok(())
    }

    /// 取消传输
    pub async fn cancel_transfer(&mut self, index: usize) -> Result<(), FileTransferError> {
        if index >= self.transfers.len() {
            return Err(FileTransferError::TransferFailed("Invalid transfer index".to_string()));
        }

        self.transfers[index].status = TransferStatus::Cancelled;
        Ok(())
    }

    /// 获取所有传输
    pub fn get_transfers(&self) -> &[FileTransferItem] {
        &self.transfers
    }

    /// 获取传输进度
    pub fn get_progress(&self) -> (usize, f64) {
        let total = self.transfers.len();
        let completed = self.transfers
            .iter()
            .filter(|t| t.status == TransferStatus::Completed)
            .count();

        let overall_progress = if total == 0 {
            0.0
        } else {
            self.transfers.iter().map(|t| t.progress()).sum::<f64>() / total as f64
        };

        (completed, overall_progress)
    }

    /// 清除完成的传输
    pub fn clear_completed(&mut self) {
        self.transfers.retain(|t| t.status != TransferStatus::Completed);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_file_transfer_creation() {
        let item = FileTransferItem::new(
            "test.txt",
            PathBuf::from("/source/test.txt"),
            PathBuf::from("/dest/test.txt"),
            1024,
        );

        assert_eq!(item.name, "test.txt");
        assert_eq!(item.size, 1024);
        assert_eq!(item.status, TransferStatus::Pending);
        assert_eq!(item.progress(), 0.0);
    }

    #[test]
    fn test_file_transfer_progress() {
        let mut item = FileTransferItem::new(
            "test.txt",
            PathBuf::from("/source/test.txt"),
            PathBuf::from("/dest/test.txt"),
            1000,
        );

        item.transferred = 500;
        assert_eq!(item.progress(), 0.5);
    }

    #[test]
    fn test_transfer_manager() {
        let mut manager = FileTransferManager::new();

        manager.add_transfer(
            "file1.txt",
            PathBuf::from("/source/file1.txt"),
            PathBuf::from("/dest/file1.txt"),
            1024,
        );

        assert_eq!(manager.transfers.len(), 1);
    }
}
