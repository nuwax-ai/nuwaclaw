//! FileTransferManager 单元测试
//!
//! 测试文件传输的核心功能

#[cfg(test)]
mod file_transfer_tests {
    use std::path::PathBuf;
    use std::sync::Arc;
    use tempfile::tempdir;
    use tokio::sync::Mutex;

    use crate::file_transfer::{
        FileBlockReader, FileTransferCallback, FileTransferManager, FileTransferSession,
        NoopFileTransferCallback, TransferDirection, TransferStatus,
    };

    /// 测试回调实现
    #[derive(Debug)]
    struct TestFileTransferCallback {
        pub progress_updates: Arc<Mutex<Vec<(i32, u64, u64)>>>,
        pub completions: Arc<Mutex<Vec<i32>>>,
        pub errors: Arc<Mutex<Vec<(i32, String)>>>,
        pub cancellations: Arc<Mutex<Vec<i32>>>,
    }

    impl TestFileTransferCallback {
        fn new() -> Self {
            Self {
                progress_updates: Arc::new(Mutex::new(Vec::new())),
                completions: Arc::new(Mutex::new(Vec::new())),
                errors: Arc::new(Mutex::new(Vec::new())),
                cancellations: Arc::new(Mutex::new(Vec::new())),
            }
        }
    }

    #[async_trait::async_trait]
    impl FileTransferCallback for TestFileTransferCallback {
        async fn on_progress(&self, transfer_id: i32, transferred: u64, total: u64) {
            let mut updates = self.progress_updates.lock().await;
            updates.push((transfer_id, transferred, total));
        }

        async fn on_complete(&self, transfer_id: i32) {
            let mut completions = self.completions.lock().await;
            completions.push(transfer_id);
        }

        async fn on_error(&self, transfer_id: i32, error: &str) {
            let mut errors = self.errors.lock().await;
            errors.push((transfer_id, error.to_string()));
        }

        async fn on_cancelled(&self, transfer_id: i32) {
            let mut cancellations = self.cancellations.lock().await;
            cancellations.push(transfer_id);
        }
    }

    /// 创建测试文件
    fn create_test_file(dir: &PathBuf, name: &str, content: &[u8]) -> PathBuf {
        let path = dir.join(name);
        std::fs::write(&path, content).expect("Failed to write test file");
        path
    }

    #[tokio::test]
    async fn test_file_transfer_manager_creation() {
        let manager = FileTransferManager::new();
        assert!(manager.get_all_sessions().is_empty());
    }

    #[tokio::test]
    async fn test_file_transfer_manager_clone() {
        let manager1 = FileTransferManager::new();
        let manager2 = manager1.clone();

        // 两者应该是独立的管理器（但共享底层数据）
        assert_eq!(manager1.get_all_sessions().len(), 0);
        assert_eq!(manager2.get_all_sessions().len(), 0);
    }

    #[tokio::test]
    async fn test_file_transfer_session_send_creation() {
        let dir = tempdir().unwrap();
        let file_path = create_test_file(&dir.path().to_path_buf(), "test.txt", b"Hello, World!");

        let callback = Arc::new(NoopFileTransferCallback);
        let session = FileTransferSession::new_send(
            1,
            vec![file_path.clone()],
            "/remote/path",
            "peer-123",
            callback,
        )
        .await
        .unwrap();

        assert_eq!(session.id, 1);
        assert_eq!(session.direction, TransferDirection::Send);
        assert_eq!(session.status, TransferStatus::Pending);
        assert_eq!(session.peer_id, "peer-123");
    }

    #[tokio::test]
    async fn test_file_transfer_session_receive_creation() {
        use librustdesk::client_api::FileEntry;

        let callback = Arc::new(NoopFileTransferCallback);
        let entries = vec![FileEntry {
            name: "file1.txt".to_string(),
            size: 100,
            entry_type: librustdesk::client_api::FileType::File.into(),
            ..Default::default()
        }];

        let session =
            FileTransferSession::new_receive(2, entries, "/remote/path", "peer-456", callback)
                .await
                .unwrap();

        assert_eq!(session.id, 2);
        assert_eq!(session.direction, TransferDirection::Receive);
        assert_eq!(session.status, TransferStatus::Pending);
    }

    #[tokio::test]
    async fn test_file_transfer_session_confirm() {
        let callback = Arc::new(NoopFileTransferCallback);
        let mut session =
            FileTransferSession::new_receive(1, vec![], "/remote/path", "peer-123", callback)
                .await
                .unwrap();

        assert_eq!(session.status, TransferStatus::Pending);

        // 确认后状态应该变为 Transferring
        session.confirm(0, false, None).await;
        assert_eq!(session.status, TransferStatus::Transferring);
    }

    #[tokio::test]
    async fn test_file_transfer_session_cancel() {
        let callback = Arc::new(TestFileTransferCallback::new());
        let mut session = FileTransferSession::new_receive(
            1,
            vec![],
            "/remote/path",
            "peer-123",
            callback.clone(),
        )
        .await
        .unwrap();

        session.cancel().await;

        assert_eq!(session.status, TransferStatus::Cancelled);

        // 检查回调是否被调用
        let cancellations = callback.cancellations.lock().await;
        assert_eq!(cancellations.len(), 1);
        assert_eq!(cancellations[0], 1);
    }

    #[tokio::test]
    async fn test_file_block_reader_single_file() {
        let dir = tempdir().unwrap();
        let _file_path = create_test_file(&dir.path().to_path_buf(), "test.txt", b"Hello, World!");

        use librustdesk::client_api::FileEntry;

        let entries = vec![FileEntry {
            name: "test.txt".to_string(),
            size: 13,
            entry_type: librustdesk::client_api::FileType::File.into(),
            ..Default::default()
        }];

        let mut reader = FileBlockReader::new(dir.path().to_path_buf(), entries);

        // 读取第一个块
        let result = reader.read_next_block().await;
        assert!(result.is_ok());
        let block = result.unwrap();
        assert!(block.is_some());

        let (entry, data) = block.unwrap();
        assert_eq!(entry.name, "test.txt");
        assert_eq!(data, b"Hello, World!");

        // 再次读取应该返回 None
        let result = reader.read_next_block().await;
        assert!(result.unwrap().is_none());
    }

    #[tokio::test]
    async fn test_file_block_reader_multiple_files() {
        let dir = tempdir().unwrap();
        create_test_file(&dir.path().to_path_buf(), "file1.txt", b"Content1");
        create_test_file(&dir.path().to_path_buf(), "file2.txt", b"Content2 Longer");

        use librustdesk::client_api::FileEntry;

        let entries = vec![
            FileEntry {
                name: "file1.txt".to_string(),
                size: 8,
                entry_type: librustdesk::client_api::FileType::File.into(),
                ..Default::default()
            },
            FileEntry {
                name: "file2.txt".to_string(),
                size: 17,
                entry_type: librustdesk::client_api::FileType::File.into(),
                ..Default::default()
            },
        ];

        let mut reader = FileBlockReader::new(dir.path().to_path_buf(), entries);

        let mut total_read = 0;
        while let Some(block) = reader.read_next_block().await.unwrap() {
            total_read += block.1.len();
        }

        assert_eq!(total_read, 25); // 8 + 17
    }

    #[tokio::test]
    async fn test_file_block_reader_skip_missing_file() {
        let dir = tempdir().unwrap();

        use librustdesk::client_api::FileEntry;

        // 只创建一个文件条目，但文件不存在
        let entries = vec![FileEntry {
            name: "missing.txt".to_string(),
            size: 100,
            entry_type: librustdesk::client_api::FileType::File.into(),
            ..Default::default()
        }];

        let mut reader = FileBlockReader::new(dir.path().to_path_buf(), entries);

        // 应该跳过不存在的文件
        let result = reader.read_next_block().await;
        assert!(result.unwrap().is_none());
    }

    #[tokio::test]
    async fn test_file_block_reader_with_block_size() {
        let dir = tempdir().unwrap();
        // 创建一个大于块大小的文件
        let content = vec![0u8; 200]; // 200 bytes
        create_test_file(&dir.path().to_path_buf(), "large.txt", &content);

        use librustdesk::client_api::FileEntry;

        let entries = vec![FileEntry {
            name: "large.txt".to_string(),
            size: 200,
            entry_type: librustdesk::client_api::FileType::File.into(),
            ..Default::default()
        }];

        // 使用 100 字节块大小
        let mut reader = FileBlockReader::with_block_size(
            dir.path().to_path_buf(),
            entries,
            100, // 100 bytes block size
        );

        let mut blocks = Vec::new();
        while let Some(block) = reader.read_next_block().await.unwrap() {
            blocks.push(block);
        }

        // 应该分成两个块
        assert_eq!(blocks.len(), 2);
        assert_eq!(blocks[0].1.len(), 100);
        assert_eq!(blocks[1].1.len(), 100);
    }

    #[tokio::test]
    async fn test_file_transfer_manager_create_send_session() {
        let dir = tempdir().unwrap();
        let file_path = create_test_file(&dir.path().to_path_buf(), "test.txt", b"Test content");

        let manager = FileTransferManager::new();
        let callback = Arc::new(NoopFileTransferCallback);

        let id = manager
            .create_send_session(vec![file_path], "/remote", "peer-123", callback)
            .await
            .unwrap();

        assert!(id > 0);

        // 检查会话是否创建
        let session = manager.get_session(id);
        assert!(session.is_some());
    }

    #[tokio::test]
    async fn test_file_transfer_manager_create_receive_session() {
        use librustdesk::client_api::FileEntry;

        let manager = FileTransferManager::new();
        let callback = Arc::new(NoopFileTransferCallback);

        let entries = vec![FileEntry {
            name: "test.txt".to_string(),
            size: 100,
            entry_type: librustdesk::client_api::FileType::File.into(),
            ..Default::default()
        }];

        manager
            .create_receive_session(
                100, // 指定的传输 ID
                entries, "/remote", "peer-123", callback,
            )
            .await
            .unwrap();

        // 检查会话是否创建
        let session = manager.get_session(100);
        assert!(session.is_some());
    }

    #[tokio::test]
    async fn test_file_transfer_manager_cancel_transfer() {
        let dir = tempdir().unwrap();
        let file_path = create_test_file(&dir.path().to_path_buf(), "test.txt", b"Test content");

        let manager = FileTransferManager::new();
        let callback = Arc::new(NoopFileTransferCallback);

        let id = manager
            .create_send_session(vec![file_path], "/remote", "peer-123", callback)
            .await
            .unwrap();

        // 取消传输
        let result = manager.cancel_transfer(id).await;
        assert!(result.is_ok());

        // 会话应该被移除
        let session = manager.get_session(id);
        assert!(session.is_none());
    }

    #[tokio::test]
    async fn test_file_transfer_manager_get_progress() {
        let dir = tempdir().unwrap();
        let file_path = create_test_file(&dir.path().to_path_buf(), "test.txt", b"12345");

        let manager = FileTransferManager::new();
        let callback = Arc::new(NoopFileTransferCallback);

        let id = manager
            .create_send_session(vec![file_path], "/remote", "peer-123", callback)
            .await
            .unwrap();

        let progress = manager.get_progress(id);
        assert!(progress.is_some());
        let (transferred, total) = progress.unwrap();
        assert_eq!(transferred, 0); // 尚未读取
        assert_eq!(total, 5); // 文件大小
    }

    #[tokio::test]
    async fn test_file_transfer_manager_get_all_status() {
        let dir = tempdir().unwrap();
        let file_path = create_test_file(&dir.path().to_path_buf(), "test.txt", b"Test content");

        let manager = FileTransferManager::new();
        let callback = Arc::new(NoopFileTransferCallback);

        manager
            .create_send_session(
                vec![file_path.clone()],
                "/remote",
                "peer-123",
                callback.clone(),
            )
            .await
            .unwrap();

        manager
            .create_send_session(vec![file_path], "/remote", "peer-456", callback)
            .await
            .unwrap();

        let statuses = manager.get_all_status();
        assert_eq!(statuses.len(), 2);
    }

    #[tokio::test]
    async fn test_file_transfer_manager_cleanup_completed() {
        let dir = tempdir().unwrap();
        let file_path = create_test_file(&dir.path().to_path_buf(), "test.txt", b"Test content");

        let manager = FileTransferManager::new();
        let callback = Arc::new(NoopFileTransferCallback);

        let id = manager
            .create_send_session(vec![file_path], "/remote", "peer-123", callback)
            .await
            .unwrap();

        // 模拟完成传输
        manager.cancel_transfer(id).await;

        // 清理
        manager.cleanup_completed();

        // 应该没有会话了
        assert_eq!(manager.get_all_status().len(), 0);
    }

    #[tokio::test]
    async fn test_file_transfer_session_read_next_block() {
        let dir = tempdir().unwrap();
        let file_path = create_test_file(&dir.path().to_path_buf(), "test.txt", b"1234567890");

        let callback = Arc::new(TestFileTransferCallback::new());
        let mut session = FileTransferSession::new_send(
            1,
            vec![file_path],
            "/remote/path",
            "peer-123",
            callback.clone(),
        )
        .await
        .unwrap();

        let block = session.read_next_block().await.unwrap();
        assert!(block.is_some());

        let block = block.unwrap();
        assert_eq!(&block.data[..], b"1234567890");

        // 再次读取应该返回 None
        let block = session.read_next_block().await.unwrap();
        assert!(block.is_none());
    }

    #[tokio::test]
    async fn test_file_transfer_progress_callback() {
        let dir = tempdir().unwrap();
        let file_path = create_test_file(&dir.path().to_path_buf(), "test.txt", b"12345");

        let callback = Arc::new(TestFileTransferCallback::new());
        let mut session = FileTransferSession::new_send(
            1,
            vec![file_path],
            "/remote/path",
            "peer-123",
            callback.clone(),
        )
        .await
        .unwrap();

        // 读取块
        let _ = session.read_next_block().await.unwrap();

        // 检查进度回调
        let updates = callback.progress_updates.lock().await;
        assert!(!updates.is_empty());
        assert_eq!(updates[0].0, 1); // transfer_id
        assert_eq!(updates[0].1, 5); // transferred
        assert_eq!(updates[0].2, 5); // total
    }

    #[test]
    fn test_file_transfer_item_progress_calculation() {
        use crate::file_transfer::FileTransferItem;

        let item = FileTransferItem::new_send(
            1,
            "test.txt",
            PathBuf::from("/source"),
            PathBuf::from("/dest"),
            1000,
            "peer-123",
        );

        assert_eq!(item.progress(), 0.0);

        let mut item = item;
        item.transferred = 500;
        assert_eq!(item.progress(), 0.5);

        item.transferred = 1000;
        assert_eq!(item.progress(), 1.0);

        // 零大小文件
        let empty_item = FileTransferItem::new_send(
            2,
            "empty.txt",
            PathBuf::from("/source"),
            PathBuf::from("/dest"),
            0,
            "peer-123",
        );
        assert_eq!(empty_item.progress(), 0.0);
    }
}
