//! 文件传输管理模块
//!
//! 管理客户端与服务器之间的文件传输
//! 使用 rustdesk 的 P2P/Relay 通道传输文件

use std::path::PathBuf;
use std::sync::Arc;
use thiserror::Error;
use tokio::io::{AsyncReadExt, AsyncSeekExt, SeekFrom};
use tokio::sync::Mutex;

use librustdesk::client_api::{
    FileAction, FileEntry, FileTransferBlock, FileTransferCancel, FileTransferReceiveRequest,
    FileTransferSendConfirmRequest, FileTransferSendRequest,
};
use librustdesk::hbb_common::fs::get_recursive_files;
use librustdesk::hbb_common::message_proto::FileType;

/// 文件传输错误
#[derive(Error, Debug)]
pub enum FileTransferManagerError {
    #[error("传输失败: {0}")]
    TransferFailed(String),
    #[error("文件不存在: {0}")]
    FileNotFound(PathBuf),
    #[error("权限不足")]
    PermissionDenied,
    #[error("传输已取消")]
    Cancelled,
    #[error("连接断开")]
    ConnectionLost,
    #[error("IO 错误: {0}")]
    IoError(String),
    #[error("无效参数: {0}")]
    InvalidArgument(String),
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
    /// 暂停
    Paused,
}

/// 传输方向
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum TransferDirection {
    /// 发送文件到远程
    Send,
    /// 从远程接收文件
    Receive,
}

/// 文件传输项
#[derive(Debug, Clone)]
pub struct FileTransferItem {
    /// 传输 ID
    pub id: i32,
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
    /// 传输方向
    pub direction: TransferDirection,
    /// 远程 peer ID
    pub peer_id: String,
}

impl FileTransferItem {
    /// 创建新的传输项（发送）
    pub fn new_send(
        id: i32,
        name: impl Into<String>,
        source: PathBuf,
        dest: PathBuf,
        size: u64,
        peer_id: impl Into<String>,
    ) -> Self {
        Self {
            id,
            name: name.into(),
            source_path: source,
            dest_path: dest,
            size,
            transferred: 0,
            status: TransferStatus::Pending,
            error: None,
            direction: TransferDirection::Send,
            peer_id: peer_id.into(),
        }
    }

    /// 创建新的传输项（接收）
    pub fn new_receive(
        id: i32,
        name: impl Into<String>,
        source: PathBuf,
        dest: PathBuf,
        size: u64,
        peer_id: impl Into<String>,
    ) -> Self {
        Self {
            id,
            name: name.into(),
            source_path: source,
            dest_path: dest,
            size,
            transferred: 0,
            status: TransferStatus::Pending,
            error: None,
            direction: TransferDirection::Receive,
            peer_id: peer_id.into(),
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

/// 文件传输回调
#[async_trait::async_trait]
pub trait FileTransferCallback: Send + Sync {
    /// 传输进度更新
    async fn on_progress(&self, transfer_id: i32, transferred: u64, total: u64);
    /// 传输完成
    async fn on_complete(&self, transfer_id: i32);
    /// 传输失败
    async fn on_error(&self, transfer_id: i32, error: &str);
    /// 传输取消
    async fn on_cancelled(&self, transfer_id: i32);
}

/// 默认回调实现（空操作）
#[derive(Default)]
pub struct NoopFileTransferCallback;

#[async_trait::async_trait]
impl FileTransferCallback for NoopFileTransferCallback {
    async fn on_progress(&self, _transfer_id: i32, _transferred: u64, _total: u64) {}
    async fn on_complete(&self, _transfer_id: i32) {}
    async fn on_error(&self, _transfer_id: i32, _error: &str) {}
    async fn on_cancelled(&self, _transfer_id: i32) {}
}

/// 文件块读取器
#[derive(Debug)]
pub struct FileBlockReader {
    /// 基础路径
    base_path: PathBuf,
    /// 文件大小
    total_size: u64,
    /// 当前文件索引
    file_index: usize,
    /// 文件列表
    files: Vec<FileEntry>,
    /// 当前文件已读取大小
    current_offset: u64,
    /// 块大小
    block_size: usize,
    /// 当前文件句柄（用于优化大文件读取）
    current_file: Option<tokio::fs::File>,
}

impl FileBlockReader {
    /// 默认块大小 (64KB)
    pub const DEFAULT_BLOCK_SIZE: usize = 64 * 1024;

    /// 创建新的文件块读取器
    pub fn new(base_path: PathBuf, files: Vec<FileEntry>) -> Self {
        let total_size: u64 = files.iter().map(|f| f.size).sum();
        Self {
            base_path,
            total_size,
            file_index: 0,
            files,
            current_offset: 0,
            block_size: Self::DEFAULT_BLOCK_SIZE,
            current_file: None,
        }
    }

    /// 创建时设置块大小
    pub fn with_block_size(base_path: PathBuf, files: Vec<FileEntry>, block_size: usize) -> Self {
        let total_size: u64 = files.iter().map(|f| f.size).sum();
        Self {
            base_path,
            total_size,
            file_index: 0,
            files,
            current_offset: 0,
            block_size,
            current_file: None,
        }
    }

    /// 获取完整的文件路径（处理嵌套目录）
    fn get_file_path(&self, entry: &FileEntry) -> PathBuf {
        // entry.name 可能包含相对路径（如 "subdir/file.txt"）
        self.base_path.join(&entry.name)
    }

    /// 关闭当前文件句柄
    async fn close_current_file(&mut self) {
        if let Some(file) = self.current_file.take() {
            let _ = file.sync_all().await;
        }
    }

    /// 读取下一个文件块
    pub async fn read_next_block(
        &mut self,
    ) -> Result<Option<(FileEntry, Vec<u8>)>, std::io::Error> {
        // 使用循环代替递归，避免栈溢出
        loop {
            if self.file_index >= self.files.len() {
                // 关闭最后的文件句柄
                self.close_current_file().await;
                return Ok(None);
            }

            // 先克隆 entry，避免在调用 mutate 方法时 borrow checker 报错
            let entry = self.files[self.file_index].clone();
            let file_path = self.get_file_path(&entry);

            // 检查文件是否存在
            if !file_path.exists() {
                // 跳过不存在的文件
                self.file_index += 1;
                self.current_offset = 0;
                self.close_current_file().await;
                continue;
            }

            // 如果是新文件，打开它
            if self.current_offset == 0 {
                self.close_current_file().await;

                match tokio::fs::File::open(&file_path).await {
                    Ok(file) => {
                        self.current_file = Some(file);
                    }
                    Err(_e) => {
                        // 无法打开文件，跳过
                        self.file_index += 1;
                        self.current_offset = 0;
                        continue;
                    }
                }
            }

            // 读取文件块
            let file = match self.current_file.as_mut() {
                Some(f) => f,
                None => {
                    self.file_index += 1;
                    self.current_offset = 0;
                    continue;
                }
            };

            let mut buffer = vec![0u8; self.block_size];

            // 跳到当前位置
            if self.current_offset > 0 {
                file.seek(SeekFrom::Start(self.current_offset)).await?;
            }

            match file.read(&mut buffer).await {
                Ok(0) => {
                    // 文件读取完成，移动到下一个文件
                    self.file_index += 1;
                    self.current_offset = 0;
                    self.close_current_file().await;
                    continue;
                }
                Ok(bytes_read) => {
                    buffer.truncate(bytes_read);
                    self.current_offset += bytes_read as u64;

                    // 如果当前文件读取完成
                    if self.current_offset >= entry.size {
                        self.file_index += 1;
                        self.current_offset = 0;
                        self.close_current_file().await;
                    }

                    return Ok(Some((entry, buffer)));
                }
                Err(_e) => {
                    // 读取错误，跳过此文件
                    self.file_index += 1;
                    self.current_offset = 0;
                    self.close_current_file().await;
                    continue;
                }
            }
        }
    }

    /// 获取总大小
    pub fn total_size(&self) -> u64 {
        self.total_size
    }

    /// 获取已传输大小
    pub fn transferred(&self) -> u64 {
        self.files[..self.file_index.min(self.files.len())]
            .iter()
            .map(|f| f.size)
            .sum::<u64>()
            + self.current_offset
    }

    /// 获取当前块大小
    pub fn block_size(&self) -> usize {
        self.block_size
    }
}

/// 文件传输会话
pub struct FileTransferSession {
    /// 传输 ID
    pub id: i32,
    /// 传输方向
    pub direction: TransferDirection,
    /// 状态
    pub status: TransferStatus,
    /// 远程 peer ID
    pub peer_id: String,
    /// 回调（不参与 Debug）
    callback: Arc<dyn FileTransferCallback>,
    /// 文件块读取器（发送时使用）
    reader: Option<Mutex<FileBlockReader>>,
    /// 目标路径
    remote_path: String,
}

impl std::fmt::Debug for FileTransferSession {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("FileTransferSession")
            .field("id", &self.id)
            .field("direction", &self.direction)
            .field("status", &self.status)
            .field("peer_id", &self.peer_id)
            .field("reader", &self.reader)
            .field("remote_path", &self.remote_path)
            .finish()
    }
}

impl FileTransferSession {
    /// 创建新的发送会话
    pub async fn new_send(
        id: i32,
        files: Vec<PathBuf>,
        remote_path: &str,
        peer_id: &str,
        callback: Arc<dyn FileTransferCallback>,
    ) -> Result<Self, FileTransferManagerError> {
        // 收集所有文件条目
        let mut file_entries = Vec::new();
        let mut all_files = Vec::new();

        for path in &files {
            if !path.exists() {
                return Err(FileTransferManagerError::FileNotFound(path.clone()));
            }

            if path.is_file() {
                if let Ok(meta) = std::fs::metadata(path) {
                    let entry = FileEntry {
                        name: path
                            .file_name()
                            .and_then(|n| n.to_str())
                            .unwrap_or("unknown")
                            .to_string(),
                        size: meta.len(),
                        entry_type: FileType::File.into(),
                        ..Default::default()
                    };
                    file_entries.push(entry);
                    all_files.push(path.clone());
                }
            } else if path.is_dir() {
                // 处理目录
                if let Ok(entries) = get_recursive_files(
                    path.to_str().unwrap_or(""),
                    false, // include_hidden
                ) {
                    for entry in &entries {
                        all_files.push(path.join(&entry.name));
                    }
                    file_entries.extend(entries);
                }
            }
        }

        let reader = if !all_files.is_empty() {
            Some(Mutex::new(FileBlockReader::new(
                files[0].clone(),
                file_entries,
            )))
        } else {
            None
        };

        Ok(Self {
            id,
            direction: TransferDirection::Send,
            status: TransferStatus::Pending,
            peer_id: peer_id.to_string(),
            callback,
            reader,
            remote_path: remote_path.to_string(),
        })
    }

    /// 创建新的接收会话
    pub async fn new_receive(
        id: i32,
        _files: Vec<FileEntry>,
        remote_path: &str,
        peer_id: &str,
        callback: Arc<dyn FileTransferCallback>,
    ) -> Result<Self, FileTransferManagerError> {
        Ok(Self {
            id,
            direction: TransferDirection::Receive,
            status: TransferStatus::Pending,
            peer_id: peer_id.to_string(),
            callback,
            reader: None,
            remote_path: remote_path.to_string(),
        })
    }

    /// 获取下一个文件块（发送时使用）
    pub async fn read_next_block(
        &mut self,
    ) -> Result<Option<FileTransferBlock>, FileTransferManagerError> {
        if let Some(ref mut reader_mutex) = self.reader {
            let mut reader = reader_mutex.lock().await;

            let (_entry, data) = match reader.read_next_block().await {
                Ok(Some(result)) => result,
                Ok(None) => return Ok(None),
                Err(e) => return Err(FileTransferManagerError::IoError(e.to_string())),
            };

            let file_index = reader.file_index;
            let transferred = reader.transferred();
            let block_size = reader.block_size;

            let block = FileTransferBlock {
                id: self.id,
                file_num: file_index as i32,
                data: data.into(),
                compressed: false,
                blk_id: (transferred / block_size as u64) as u32,
                ..Default::default()
            };

            // 更新进度
            let transferred = reader.transferred();
            let total = reader.total_size();
            self.callback.on_progress(self.id, transferred, total).await;

            // 检查是否完成
            if transferred >= total {
                self.callback.on_complete(self.id).await;
                self.status = TransferStatus::Completed;
            }

            return Ok(Some(block));
        }

        // 没有更多数据
        self.callback.on_complete(self.id).await;
        self.status = TransferStatus::Completed;
        Ok(None)
    }

    /// 写入文件块（接收时使用）
    pub async fn write_block(
        &self,
        _block: FileTransferBlock,
    ) -> Result<(), FileTransferManagerError> {
        // 接收文件块的实现需要文件写入逻辑
        // 这里可以扩展为实际的文件接收
        Ok(())
    }

    /// 确认接收（接收方确认文件后可开始传输）
    pub async fn confirm(&mut self, _file_num: i32, _skip: bool, _offset_blk: Option<u32>) {
        self.status = TransferStatus::Transferring;
    }

    /// 取消传输
    pub async fn cancel(&mut self) {
        self.callback.on_cancelled(self.id).await;
        self.status = TransferStatus::Cancelled;
    }

    /// 获取传输进度
    pub async fn get_progress(&self) -> (u64, u64) {
        if let Some(ref reader) = self.reader {
            let r = reader.lock().await;
            (r.transferred(), r.total_size())
        } else {
            (0, 0)
        }
    }

    /// 获取远程路径
    pub fn remote_path(&self) -> &str {
        &self.remote_path
    }

    /// 获取状态
    pub fn status(&self) -> TransferStatus {
        self.status.clone()
    }
}

/// 文件传输管理器
#[derive(Debug, Default)]
pub struct FileTransferManager {
    /// 传输会话映射
    sessions: Arc<dashmap::DashMap<i32, Arc<Mutex<FileTransferSession>>>>,
    /// 传输队列（按 peer_id 组织）
    pending_transfers: Arc<dashmap::DashMap<String, Vec<i32>>>,
    /// 下一个传输 ID
    next_id: Arc<std::sync::atomic::AtomicI32>,
}

impl Clone for FileTransferManager {
    fn clone(&self) -> Self {
        Self {
            sessions: self.sessions.clone(),
            pending_transfers: self.pending_transfers.clone(),
            next_id: self.next_id.clone(),
        }
    }
}

impl FileTransferManager {
    /// 创建新的传输管理器
    pub fn new() -> Self {
        Self {
            sessions: Arc::new(dashmap::DashMap::new()),
            pending_transfers: Arc::new(dashmap::DashMap::new()),
            next_id: Arc::new(std::sync::atomic::AtomicI32::new(1)),
        }
    }

    /// 生成新的传输 ID
    fn generate_id(&self) -> i32 {
        self.next_id
            .fetch_add(1, std::sync::atomic::Ordering::SeqCst)
    }

    /// 创建发送会话
    pub async fn create_send_session(
        &self,
        files: Vec<PathBuf>,
        remote_path: &str,
        peer_id: &str,
        callback: Arc<dyn FileTransferCallback>,
    ) -> Result<i32, FileTransferManagerError> {
        let id = self.generate_id();

        let session =
            FileTransferSession::new_send(id, files, remote_path, peer_id, callback).await?;

        self.sessions.insert(id, Arc::new(Mutex::new(session)));

        // 添加到待传输队列
        self.pending_transfers
            .entry(peer_id.to_string())
            .or_default()
            .push(id);

        Ok(id)
    }

    /// 创建接收会话
    pub async fn create_receive_session(
        &self,
        id: i32,
        files: Vec<FileEntry>,
        remote_path: &str,
        peer_id: &str,
        callback: Arc<dyn FileTransferCallback>,
    ) -> Result<(), FileTransferManagerError> {
        let session =
            FileTransferSession::new_receive(id, files, remote_path, peer_id, callback).await?;

        self.sessions.insert(id, Arc::new(Mutex::new(session)));
        Ok(())
    }

    /// 获取会话
    pub fn get_session(&self, id: i32) -> Option<Arc<Mutex<FileTransferSession>>> {
        self.sessions.get(&id).map(|s| s.clone())
    }

    /// 移除会话
    pub fn remove_session(&self, id: i32) -> Option<Arc<Mutex<FileTransferSession>>> {
        self.sessions.remove(&id).map(|(_, s)| s)
    }

    /// 获取所有会话
    pub fn get_all_sessions(&self) -> Vec<(i32, Arc<Mutex<FileTransferSession>>)> {
        self.sessions
            .iter()
            .map(|s| (*s.key(), s.clone()))
            .collect()
    }

    /// 取消传输
    pub async fn cancel_transfer(&self, id: i32) -> Result<(), FileTransferManagerError> {
        if let Some(session) = self.remove_session(id) {
            let mut s = session.lock().await;
            s.cancel().await;
            return Ok(());
        }
        Err(FileTransferManagerError::Cancelled)
    }

    /// 暂停传输
    pub fn pause_transfer(&self, _id: i32) -> Result<(), FileTransferManagerError> {
        // TODO: 实现暂停逻辑
        Err(FileTransferManagerError::InvalidArgument(
            "暂停功能尚未实现".to_string(),
        ))
    }

    /// 恢复传输
    pub fn resume_transfer(&self, _id: i32) -> Result<(), FileTransferManagerError> {
        // TODO: 实现恢复逻辑
        Err(FileTransferManagerError::InvalidArgument(
            "恢复功能尚未实现".to_string(),
        ))
    }

    /// 获取传输进度
    pub fn get_progress(&self, id: i32) -> Option<(u64, u64)> {
        self.sessions.get(&id).map(|s| {
            let session = s.value().blocking_lock();
            futures::executor::block_on(async { session.get_progress().await })
        })
    }

    /// 获取所有传输的状态
    pub fn get_all_status(&self) -> Vec<(i32, TransferStatus)> {
        self.sessions
            .iter()
            .map(|s| (*s.key(), s.value().blocking_lock().status()))
            .collect()
    }

    /// 清理完成的传输
    pub fn cleanup_completed(&self) {
        self.sessions.retain(|_, session| {
            let status = session.blocking_lock().status();
            status != TransferStatus::Completed
                && status != TransferStatus::Cancelled
                && status != TransferStatus::Failed
        });
    }
}

/// 辅助函数：构建文件传输请求消息
#[cfg(feature = "remote-desktop")]
pub fn build_file_send_request(id: i32, path: &str, files: &[FileEntry]) -> FileAction {
    let mut action = FileAction::new();
    let request = FileTransferSendRequest {
        id,
        path: path.to_string(),
        include_hidden: false,
        file_num: files.len() as i32,
        // file_type 会使用默认值 Generic
        ..Default::default()
    };
    action.set_send(request);
    action
}

/// 辅助函数：构建文件接收请求消息
#[cfg(feature = "remote-desktop")]
pub fn build_file_receive_request(id: i32, path: &str, files: Vec<FileEntry>) -> FileAction {
    let total_size: u64 = files.iter().map(|f| f.size).sum();
    let mut action = FileAction::new();
    action.set_receive(FileTransferReceiveRequest {
        id,
        path: path.to_string(),
        files,
        file_num: 0,
        total_size,
        ..Default::default()
    });
    action
}

/// 辅助函数：构建文件取消消息
#[cfg(feature = "remote-desktop")]
pub fn build_file_cancel(id: i32) -> FileAction {
    let mut action = FileAction::new();
    let mut cancel = FileTransferCancel::default();
    cancel.id = id;
    action.set_cancel(cancel);
    action
}

/// 辅助函数：构建文件确认消息
#[cfg(feature = "remote-desktop")]
pub fn build_file_confirm(
    id: i32,
    file_num: i32,
    skip: bool,
    offset_blk: Option<u32>,
) -> FileAction {
    let mut confirm = FileTransferSendConfirmRequest {
        id,
        file_num,
        ..Default::default()
    };

    if skip {
        confirm.set_skip(true);
    } else if let Some(offset) = offset_blk {
        confirm.set_offset_blk(offset);
    }

    let mut action = FileAction::new();
    action.set_send_confirm(confirm);
    action
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_file_transfer_creation() {
        let item = FileTransferItem::new_send(
            1,
            "test.txt",
            PathBuf::from("/source/test.txt"),
            PathBuf::from("/dest/test.txt"),
            1024,
            "peer-123",
        );

        assert_eq!(item.name, "test.txt");
        assert_eq!(item.size, 1024);
        assert_eq!(item.status, TransferStatus::Pending);
        assert_eq!(item.progress(), 0.0);
        assert_eq!(item.direction, TransferDirection::Send);
    }

    #[test]
    fn test_file_transfer_progress() {
        let mut item = FileTransferItem::new_send(
            1,
            "test.txt",
            PathBuf::from("/source/test.txt"),
            PathBuf::from("/dest/test.txt"),
            1000,
            "peer-123",
        );

        item.transferred = 500;
        assert_eq!(item.progress(), 0.5);
    }

    #[test]
    fn test_transfer_manager() {
        let manager = FileTransferManager::new();
        assert!(manager.get_all_sessions().is_empty());
    }
}
