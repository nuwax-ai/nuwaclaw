//! Phase 2 单元测试 - 核心功能
//!
//! 测试连接管理、业务通道、消息分片等

#[cfg(test)]
mod connection_tests {
    use nuwax_agent::core::connection::{ConnectionMode, ConnectionState};

    #[test]
    fn test_connection_state_default() {
        let state = ConnectionState::default();
        assert!(matches!(state, ConnectionState::Disconnected));
    }

    #[test]
    fn test_connection_state_variants() {
        // 验证可以创建所有变体
        let _disconnected = ConnectionState::Disconnected;
        let _connecting = ConnectionState::Connecting;
        let _connected = ConnectionState::Connected {
            mode: ConnectionMode::P2P,
            latency_ms: 25,
            client_id: "12345678".to_string(),
        };
        let _error = ConnectionState::Error("test error".to_string());
    }

    #[test]
    fn test_connection_mode() {
        let p2p = ConnectionMode::P2P;
        let relay = ConnectionMode::Relay;

        assert!(matches!(p2p, ConnectionMode::P2P));
        assert!(matches!(relay, ConnectionMode::Relay));
    }

    #[test]
    fn test_connection_state_equality() {
        assert_eq!(ConnectionState::Disconnected, ConnectionState::Disconnected);
        assert_eq!(ConnectionState::Connecting, ConnectionState::Connecting);
        assert_ne!(ConnectionState::Disconnected, ConnectionState::Connecting);
    }
}

#[cfg(test)]
mod connection_manager_tests {
    use nuwax_agent::core::connection::{
        ConnectionConfig, ConnectionManager, ConnectionMode, ConnectionState,
    };

    #[tokio::test]
    async fn test_connection_manager_creation() {
        let manager = ConnectionManager::new(ConnectionConfig::default());
        assert_eq!(manager.get_state().await, ConnectionState::Disconnected);
    }

    #[tokio::test]
    async fn test_state_transitions() {
        let manager = ConnectionManager::new(ConnectionConfig::default());

        manager.set_state(ConnectionState::Connecting).await;
        assert_eq!(manager.get_state().await, ConnectionState::Connecting);

        manager
            .set_state(ConnectionState::Connected {
                mode: ConnectionMode::P2P,
                latency_ms: 10,
                client_id: "test-id".to_string(),
            })
            .await;
        if let ConnectionState::Connected {
            mode, client_id, ..
        } = manager.get_state().await
        {
            assert_eq!(mode, ConnectionMode::P2P);
            assert_eq!(client_id, "test-id");
        } else {
            panic!("Expected Connected state");
        }
    }

    #[tokio::test]
    async fn test_get_client_id() {
        let manager = ConnectionManager::new(ConnectionConfig::default());

        // 未连接时无 client_id
        assert!(manager.get_client_id().await.is_none());

        // 连接后有 client_id
        manager
            .set_state(ConnectionState::Connected {
                mode: ConnectionMode::P2P,
                latency_ms: 10,
                client_id: "87654321".to_string(),
            })
            .await;
        assert_eq!(manager.get_client_id().await, Some("87654321".to_string()));
    }

    #[tokio::test]
    async fn test_disconnect() {
        let manager = ConnectionManager::new(ConnectionConfig::default());

        manager
            .set_state(ConnectionState::Connected {
                mode: ConnectionMode::Relay,
                latency_ms: 50,
                client_id: "test-id".to_string(),
            })
            .await;

        manager.disconnect().await;
        assert_eq!(manager.get_state().await, ConnectionState::Disconnected);
    }

    #[tokio::test]
    async fn test_update_latency() {
        let manager = ConnectionManager::new(ConnectionConfig::default());

        manager
            .set_state(ConnectionState::Connected {
                mode: ConnectionMode::P2P,
                latency_ms: 10,
                client_id: "test-id".to_string(),
            })
            .await;

        manager.update_latency(50).await;

        if let ConnectionState::Connected { latency_ms, .. } = manager.get_state().await {
            assert_eq!(latency_ms, 50);
        } else {
            panic!("Expected Connected state");
        }
    }

    #[tokio::test]
    async fn test_event_subscription() {
        let manager = ConnectionManager::new(ConnectionConfig::default());
        let mut rx = manager.subscribe();

        manager.set_state(ConnectionState::Connecting).await;

        let event = rx.recv().await.unwrap();
        match event {
            nuwax_agent::core::connection::ConnectionEvent::StateChanged(state) => {
                assert_eq!(state, ConnectionState::Connecting);
            }
            _ => panic!("Expected StateChanged event"),
        }
    }
}

#[cfg(test)]
mod business_channel_tests {
    use nuwax_agent::core::business_channel::{BusinessChannel, BusinessMessage, MessageType};

    #[test]
    fn test_message_creation() {
        let msg = BusinessMessage::new(MessageType::AgentTaskRequest, vec![1, 2, 3]);
        assert!(!msg.id.is_empty());
        assert_eq!(msg.message_type, MessageType::AgentTaskRequest);
        assert_eq!(msg.payload, vec![1, 2, 3]);
        assert!(msg.timestamp > 0);
    }

    #[test]
    fn test_message_with_source_target() {
        let msg = BusinessMessage::new(MessageType::SystemNotify, vec![])
            .with_source("src-id".to_string())
            .with_target("tgt-id".to_string());

        assert_eq!(msg.source_id, Some("src-id".to_string()));
        assert_eq!(msg.target_id, Some("tgt-id".to_string()));
    }

    #[test]
    fn test_message_serialization() {
        let msg = BusinessMessage::new(MessageType::Heartbeat, vec![42]);
        let bytes = msg.to_bytes().unwrap();
        let decoded = BusinessMessage::from_bytes(&bytes).unwrap();

        assert_eq!(msg.id, decoded.id);
        assert_eq!(msg.message_type, decoded.message_type);
        assert_eq!(msg.payload, decoded.payload);
    }

    #[tokio::test]
    async fn test_channel_offline_queue() {
        let channel = BusinessChannel::new();
        assert!(!channel.is_connected().await);

        // 离线时发送应入队
        let msg = BusinessMessage::new(MessageType::Heartbeat, vec![]);
        channel.send(msg).await.unwrap();
        assert_eq!(channel.pending_count().await, 1);

        // 再发一条
        let msg2 = BusinessMessage::new(MessageType::SystemNotify, vec![]);
        channel.send(msg2).await.unwrap();
        assert_eq!(channel.pending_count().await, 2);

        // 清空队列
        channel.clear_pending().await;
        assert_eq!(channel.pending_count().await, 0);
    }

    #[tokio::test]
    async fn test_channel_subscribe() {
        let channel = BusinessChannel::new();
        let mut rx = channel.subscribe();

        // 模拟接收到消息
        let msg = BusinessMessage::new(MessageType::SystemNotify, vec![1, 2, 3]);
        channel.handle_message(msg.clone()).await;

        // 订阅者应该收到消息
        let received = rx.recv().await.unwrap();
        assert_eq!(received.id, msg.id);
    }
}

#[cfg(test)]
mod chunking_tests {
    use nuwax_agent::message::chunking::{MessageChunk, MessageChunker, MessageReassembler};

    #[test]
    fn test_no_chunking_needed() {
        let chunker = MessageChunker::new();
        let data = vec![0u8; 1000];
        assert!(!chunker.needs_chunking(&data));
    }

    #[test]
    fn test_chunking_needed() {
        let chunker = MessageChunker::new().with_chunk_size(100);
        let data = vec![0u8; 500];
        assert!(chunker.needs_chunking(&data));
    }

    #[test]
    fn test_chunk_and_reassemble() {
        let chunker = MessageChunker::new().with_chunk_size(100);
        let data: Vec<u8> = (0..250).map(|i| (i % 256) as u8).collect();

        let chunks = chunker.chunk("test-msg", &data).unwrap();
        assert_eq!(chunks.len(), 3);

        let mut reassembler = MessageReassembler::new();

        assert!(reassembler.add_chunk(chunks[0].clone()).unwrap().is_none());
        assert!(reassembler.add_chunk(chunks[2].clone()).unwrap().is_none());
        let result = reassembler.add_chunk(chunks[1].clone()).unwrap();

        assert!(result.is_some());
        assert_eq!(result.unwrap(), data);
        assert_eq!(reassembler.pending_count(), 0);
    }

    #[test]
    fn test_single_chunk_message() {
        let chunker = MessageChunker::new().with_chunk_size(1000);
        let data = vec![42u8; 100];

        let chunks = chunker.chunk("single", &data).unwrap();
        assert_eq!(chunks.len(), 1);

        let mut reassembler = MessageReassembler::new();
        let result = reassembler.add_chunk(chunks[0].clone()).unwrap();
        assert_eq!(result.unwrap(), data);
    }

    #[test]
    fn test_message_too_large() {
        let chunker = MessageChunker::new().with_max_size(100);
        let data = vec![0u8; 200];

        let result = chunker.chunk("too-large", &data);
        assert!(result.is_err());
    }

    #[test]
    fn test_invalid_chunk_index() {
        let mut reassembler = MessageReassembler::new();
        let chunk = MessageChunk {
            message_id: "bad".to_string(),
            chunk_index: 5,
            total_chunks: 3,
            total_size: 100,
            data: vec![],
        };

        assert!(reassembler.add_chunk(chunk).is_err());
    }
}

#[cfg(test)]
mod protocol_compatibility_tests {
    use nuwax_agent::core::protocol::{ProtocolManager, PROTOCOL_VERSION};

    #[test]
    fn test_same_version_compatible() {
        let manager = ProtocolManager::new();
        let result = manager.check_compatibility(PROTOCOL_VERSION);
        assert!(result.is_ok());
    }

    #[test]
    fn test_handshake_request_creation() {
        let manager = ProtocolManager::new();
        let request = manager.create_handshake_request();

        assert_eq!(request.protocol_version, PROTOCOL_VERSION);
        assert!(!request.client_info.os.is_empty());
        assert!(!request.client_info.arch.is_empty());
    }

    #[test]
    fn test_older_version_incompatible() {
        let manager = ProtocolManager::new();
        let result = manager.check_compatibility("0.0.1");
        assert!(result.is_err());
    }

    #[test]
    fn test_newer_version_suggests_upgrade() {
        let manager = ProtocolManager::new();
        let result = manager.check_compatibility("2.0.0").unwrap();
        assert!(result.upgrade_recommended);
    }
}
