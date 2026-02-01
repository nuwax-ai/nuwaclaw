//! 文件传输模块
//!
//! 支持通过 BusinessChannel 发送/接收文件

use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};
use thiserror::Error;
use tokio::sync::broadcast;
use tracing::{debug, info};


/// 文件传输错误
#[derive(Error, Debug)]
pub enum FileTransferError {
    #[error("文件不存在: {0}")]
    FileNotFound(String),
    #[error("文件过大: {size} > {max_size}")]
    FileTooLarge { size: u64, max_size: u64 },
    #[error("传输取消")]
    Cancelled,
    #[error("传输超时")]
    Timeout,
    #[error("IO 错误: {0}")]
    IoError(#[from] std::io::Error),
    #[error("序列化错误: {0}")]
    SerializationError(String),
}

/// 传输方向
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum TransferDirection {
    Send,
    Receive,
}

/// 传输状态
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum TransferStatus {
    /// 等待确认
    Pending,
    /// 传输中
    InProgress,
    /// 已完成
    Completed,
    /// 失败
    Failed,
    /// 已取消
    Cancelled,
}

/// 文件传输请求
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FileTransferRequest {
    /// 传输 ID
    pub transfer_id: String,
    /// 文件名
    pub file_name: String,
    /// 文件大小（字节）
    pub file_size: u64,
    /// MIME 类型
    pub mime_type: Option<String>,
    /// 来源 ID
    pub source_id: String,
    /// SHA256 校验值
    pub checksum: Option<String>,
}

/// 文件传输进度
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FileTransferProgress {
    /// 传输 ID
    pub transfer_id: String,
    /// 已传输字节数
    pub bytes_transferred: u64,
    /// 总字节数
    pub total_bytes: u64,
    /// 传输速度（字节/秒）
    pub speed_bps: u64,
}

impl FileTransferProgress {
    /// 获取进度百分比
    pub fn percentage(&self) -> f64 {
        if self.total_bytes == 0 {
            return 0.0;
        }
        (self.bytes_transferred as f64 / self.total_bytes as f64) * 100.0
    }
}

/// 文件传输信息
#[derive(Debug, Clone)]
pub struct FileTransferInfo {
    /// 传输 ID
    pub transfer_id: String,
    /// 文件名
    pub file_name: String,
    /// 文件大小
    pub file_size: u64,
    /// 方向
    pub direction: TransferDirection,
    /// 状态
    pub status: TransferStatus,
    /// 进度
    pub progress: Option<FileTransferProgress>,
    /// 保存路径（接收时）
    pub save_path: Option<PathBuf>,
}

/// 文件传输事件
#[derive(Debug, Clone)]
pub enum FileTransferEvent {
    /// 收到传输请求
    RequestReceived(FileTransferRequest),
    /// 传输开始
    Started(String),
    /// 进度更新
    Progress(FileTransferProgress),
    /// 传输完成
    Completed(String),
    /// 传输失败
    Failed(String, String),
    /// 传输取消
    Cancelled(String),
}

/// 文件传输管理器
pub struct FileTransferManager {
    /// 活跃传输
    transfers: Vec<FileTransferInfo>,
    /// 事件通道
    event_tx: broadcast::Sender<FileTransferEvent>,
    /// 最大文件大小（默认 100MB）
    max_file_size: u64,
    /// 下载目录
    download_dir: PathBuf,
}

impl Default for FileTransferManager {
    fn default() -> Self {
        Self::new()
    }
}

impl FileTransferManager {
    /// 创建新的文件传输管理器
    pub fn new() -> Self {
        let (event_tx, _) = broadcast::channel(64);
        let download_dir = dirs::download_dir()
            .unwrap_or_else(|| PathBuf::from("."))
            .join("nuwax-agent");

        Self {
            transfers: Vec::new(),
            event_tx,
            max_file_size: 100 * 1024 * 1024, // 100MB
            download_dir,
        }
    }

    /// 设置最大文件大小
    pub fn with_max_size(mut self, max_bytes: u64) -> Self {
        self.max_file_size = max_bytes;
        self
    }

    /// 设置下载目录
    pub fn with_download_dir(mut self, dir: PathBuf) -> Self {
        self.download_dir = dir;
        self
    }

    /// 订阅事件
    pub fn subscribe(&self) -> broadcast::Receiver<FileTransferEvent> {
        self.event_tx.subscribe()
    }

    /// 发起文件传输
    pub async fn send_file(
        &mut self,
        file_path: &Path,
        target_id: &str,
    ) -> Result<String, FileTransferError> {
        // 验证文件存在
        if !file_path.exists() {
            return Err(FileTransferError::FileNotFound(
                file_path.display().to_string(),
            ));
        }

        let metadata = std::fs::metadata(file_path)?;
        let file_size = metadata.len();

        // 检查文件大小
        if file_size > self.max_file_size {
            return Err(FileTransferError::FileTooLarge {
                size: file_size,
                max_size: self.max_file_size,
            });
        }

        let transfer_id = uuid::Uuid::new_v4().to_string();
        let file_name = file_path
            .file_name()
            .unwrap_or_default()
            .to_string_lossy()
            .to_string();

        let info = FileTransferInfo {
            transfer_id: transfer_id.clone(),
            file_name: file_name.clone(),
            file_size,
            direction: TransferDirection::Send,
            status: TransferStatus::Pending,
            progress: None,
            save_path: Some(file_path.to_path_buf()),
        };

        self.transfers.push(info);
        info!("File transfer initiated: {} -> {}", file_name, target_id);

        let _ = self.event_tx.send(FileTransferEvent::Started(transfer_id.clone()));

        Ok(transfer_id)
    }

    /// 处理接收到的传输请求
    pub fn handle_request(&mut self, request: FileTransferRequest) -> String {
        let transfer_id = request.transfer_id.clone();

        let info = FileTransferInfo {
            transfer_id: transfer_id.clone(),
            file_name: request.file_name.clone(),
            file_size: request.file_size,
            direction: TransferDirection::Receive,
            status: TransferStatus::Pending,
            progress: None,
            save_path: Some(self.download_dir.join(&request.file_name)),
        };

        self.transfers.push(info);
        let _ = self.event_tx.send(FileTransferEvent::RequestReceived(request));

        debug!("File transfer request received: {}", transfer_id);
        transfer_id
    }

    /// 接受传输
    pub fn accept_transfer(&mut self, transfer_id: &str) -> Result<(), FileTransferError> {
        if let Some(info) = self.transfers.iter_mut().find(|t| t.transfer_id == transfer_id) {
            info.status = TransferStatus::InProgress;
            let _ = self.event_tx.send(FileTransferEvent::Started(transfer_id.to_string()));
            Ok(())
        } else {
            Err(FileTransferError::FileNotFound(transfer_id.to_string()))
        }
    }

    /// 取消传输
    pub fn cancel_transfer(&mut self, transfer_id: &str) {
        if let Some(info) = self.transfers.iter_mut().find(|t| t.transfer_id == transfer_id) {
            info.status = TransferStatus::Cancelled;
            let _ = self.event_tx.send(FileTransferEvent::Cancelled(transfer_id.to_string()));
        }
    }

    /// 获取传输信息
    pub fn get_transfer(&self, transfer_id: &str) -> Option<&FileTransferInfo> {
        self.transfers.iter().find(|t| t.transfer_id == transfer_id)
    }

    /// 获取所有活跃传输
    pub fn active_transfers(&self) -> Vec<&FileTransferInfo> {
        self.transfers
            .iter()
            .filter(|t| matches!(t.status, TransferStatus::Pending | TransferStatus::InProgress))
            .collect()
    }

    /// 清理已完成的传输
    pub fn cleanup_completed(&mut self) {
        self.transfers.retain(|t| !matches!(
            t.status,
            TransferStatus::Completed | TransferStatus::Failed | TransferStatus::Cancelled
        ));
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_transfer_progress_percentage() {
        let progress = FileTransferProgress {
            transfer_id: "test".to_string(),
            bytes_transferred: 50,
            total_bytes: 100,
            speed_bps: 1000,
        };
        assert!((progress.percentage() - 50.0).abs() < f64::EPSILON);
    }

    #[test]
    fn test_transfer_progress_zero_total() {
        let progress = FileTransferProgress {
            transfer_id: "test".to_string(),
            bytes_transferred: 0,
            total_bytes: 0,
            speed_bps: 0,
        };
        assert!((progress.percentage() - 0.0).abs() < f64::EPSILON);
    }

    #[test]
    fn test_manager_creation() {
        let manager = FileTransferManager::new();
        assert!(manager.active_transfers().is_empty());
    }

    #[test]
    fn test_handle_request() {
        let mut manager = FileTransferManager::new();
        let request = FileTransferRequest {
            transfer_id: "t-1".to_string(),
            file_name: "test.txt".to_string(),
            file_size: 1024,
            mime_type: Some("text/plain".to_string()),
            source_id: "admin-1".to_string(),
            checksum: None,
        };

        let id = manager.handle_request(request);
        assert_eq!(id, "t-1");
        assert_eq!(manager.active_transfers().len(), 1);
    }

    #[test]
    fn test_cancel_transfer() {
        let mut manager = FileTransferManager::new();
        let request = FileTransferRequest {
            transfer_id: "t-2".to_string(),
            file_name: "test.txt".to_string(),
            file_size: 1024,
            mime_type: None,
            source_id: "admin".to_string(),
            checksum: None,
        };

        manager.handle_request(request);
        manager.cancel_transfer("t-2");

        let info = manager.get_transfer("t-2").unwrap();
        assert_eq!(info.status, TransferStatus::Cancelled);
    }

    #[test]
    fn test_cleanup_completed() {
        let mut manager = FileTransferManager::new();

        for i in 0..3 {
            let request = FileTransferRequest {
                transfer_id: format!("t-{}", i),
                file_name: format!("file-{}.txt", i),
                file_size: 100,
                mime_type: None,
                source_id: "admin".to_string(),
                checksum: None,
            };
            manager.handle_request(request);
        }

        manager.cancel_transfer("t-0");
        manager.cleanup_completed();
        assert_eq!(manager.active_transfers().len(), 2);
    }
}
