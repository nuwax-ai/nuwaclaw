//! BusinessChannel 单元测试
//!
//! 测试业务通道的核心功能

#[cfg(test)]
mod business_channel_tests {
    use std::sync::Arc;
    use std::time::Duration;
    use tokio::sync::mpsc;
    use tokio::time::timeout;

    use crate::business_channel::{
        BusinessChannel, BusinessEnvelope, BusinessMessage, BusinessMessageType, ChannelError,
        MessageType,
    };

    #[tokio::test]
    async fn test_business_channel_new() {
        let channel = BusinessChannel::new();
        assert!(!channel.is_connected().await);
    }

    #[tokio::test]
    async fn test_business_channel_not_connected_send() {
        let channel = BusinessChannel::new();

        let message = BusinessMessage::new(MessageType::Heartbeat, vec![]);
        let result = channel.send(message).await;

        assert!(result.is_ok());
        assert_eq!(channel.pending_count().await, 1);
    }

    #[tokio::test]
    async fn test_business_channel_connected_state() {
        let mut channel = BusinessChannel::new();
        let (tx, _rx) = mpsc::channel(100);

        assert!(!channel.is_connected().await);

        channel.set_connected(true, Some(tx)).await;

        assert!(channel.is_connected().await);
    }

    #[tokio::test]
    async fn test_business_channel_disconnected_state() {
        let mut channel = BusinessChannel::new();

        channel.set_connected(false, None).await;

        assert!(!channel.is_connected().await);
    }

    #[tokio::test]
    async fn test_business_channel_pending_queue_flush() {
        let mut channel = BusinessChannel::new();

        // 先发送消息（未连接，会进入队列）
        let message = BusinessMessage::new(MessageType::Heartbeat, vec![1, 2, 3]);
        channel.send(message).await.unwrap();

        assert_eq!(channel.pending_count().await, 1);

        // 建立连接，应该自动刷新队列
        let (tx, mut rx) = mpsc::channel(100);
        channel.set_connected(true, Some(tx)).await;

        // 等待消息被发送
        let received = timeout(Duration::from_millis(100), rx.recv()).await;

        assert!(received.is_ok());
        let received_msg = received.unwrap().unwrap();
        assert_eq!(received_msg.message_type, MessageType::Heartbeat);
    }

    #[tokio::test]
    async fn test_business_channel_send_connected() {
        let mut channel = BusinessChannel::new();
        let (tx, mut rx) = mpsc::channel(100);

        channel.set_connected(true, Some(tx)).await;

        let message = BusinessMessage::new(MessageType::AgentTaskRequest, vec![1, 2, 3]);
        let result = channel.send(message.clone()).await;

        assert!(result.is_ok());

        let received = timeout(Duration::from_millis(100), rx.recv()).await;
        assert!(received.is_ok());
    }

    #[tokio::test]
    async fn test_business_channel_handler_registration() {
        let mut channel = BusinessChannel::new();
        let (tx, _rx) = mpsc::channel(100);
        channel.set_connected(true, Some(tx)).await;

        let handler_count = Arc::new(std::sync::atomic::AtomicUsize::new(0));
        let handler_count_clone = handler_count.clone();

        channel
            .register_handler(MessageType::AgentTaskRequest, move |_msg| {
                handler_count_clone.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
            })
            .await;

        // 发送消息
        let message = BusinessMessage::new(MessageType::AgentTaskRequest, vec![]);
        channel.handle_message(message).await;

        // 检查处理器是否被调用
        assert_eq!(handler_count.load(std::sync::atomic::Ordering::SeqCst), 1);
    }

    #[tokio::test]
    async fn test_business_channel_multiple_handlers() {
        let mut channel = BusinessChannel::new();
        let (tx, _rx) = mpsc::channel(100);
        channel.set_connected(true, Some(tx)).await;

        let call_count = Arc::new(std::sync::atomic::AtomicUsize::new(0));
        let call_count_clone = call_count.clone();

        // 注册多个处理器
        for _ in 0..3 {
            let call_count_clone = call_count_clone.clone();
            channel
                .register_handler(MessageType::SystemNotify, move |_msg| {
                    call_count_clone.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
                })
                .await;
        }

        // 发送消息
        let message = BusinessMessage::new(MessageType::SystemNotify, vec![]);
        channel.handle_message(message).await;

        // 所有处理器都应该被调用
        assert_eq!(call_count.load(std::sync::atomic::Ordering::SeqCst), 3);
    }

    #[tokio::test]
    async fn test_business_channel_subscribe() {
        let mut channel = BusinessChannel::new();
        let (tx, _rx) = mpsc::channel(100);
        channel.set_connected(true, Some(tx)).await;

        let mut rx1 = channel.subscribe();
        let mut rx2 = channel.subscribe();

        // 发送消息
        let message = BusinessMessage::new(MessageType::Heartbeat, vec![]);
        channel.handle_message(message).await;

        // 两个订阅者都应该收到消息
        let timeout_duration = Duration::from_millis(100);

        let recv1 = timeout(timeout_duration, rx1.recv()).await;
        let recv2 = timeout(timeout_duration, rx2.recv()).await;

        assert!(recv1.is_ok());
        assert!(recv2.is_ok());
    }

    #[tokio::test]
    async fn test_business_channel_clear_pending() {
        let channel = BusinessChannel::new();

        // 发送多条消息
        for i in 0..5 {
            let message = BusinessMessage::new(MessageType::Heartbeat, vec![i]);
            channel.send(message).await.unwrap();
        }

        assert_eq!(channel.pending_count().await, 5);

        // 清空队列
        channel.clear_pending().await;

        assert_eq!(channel.pending_count().await, 0);
    }

    #[tokio::test]
    async fn test_business_channel_pending_queue_limit() {
        let channel = BusinessChannel::new();

        // 发送超过限制的消息
        for i in 0..1500 {
            let message = BusinessMessage::new(MessageType::Heartbeat, vec![i as u8]);
            channel.send(message).await.unwrap();
        }

        // 应该不超过最大限制 (默认是1000)
        let count = channel.pending_count().await;
        assert!(count <= 1000);
    }

    // ============================================================================
    // BusinessMessage Tests
    // ============================================================================

    #[test]
    fn test_business_message_new() {
        let message = BusinessMessage::new(MessageType::AgentTaskRequest, vec![1, 2, 3]);

        assert!(!message.id.is_empty());
        assert_eq!(message.message_type, MessageType::AgentTaskRequest);
        assert_eq!(message.payload, vec![1, 2, 3]);
        assert!(message.timestamp > 0);
        assert!(message.source_id.is_none());
        assert!(message.target_id.is_none());
    }

    #[test]
    fn test_business_message_with_source_target() {
        let message = BusinessMessage::new(MessageType::SystemNotify, vec![])
            .with_source("client-1".to_string())
            .with_target("client-2".to_string());

        assert_eq!(message.source_id, Some("client-1".to_string()));
        assert_eq!(message.target_id, Some("client-2".to_string()));
    }

    #[test]
    fn test_business_message_serialization() {
        let message = BusinessMessage::new(MessageType::FileTransferRequest, vec![1, 2, 3, 4, 5])
            .with_source("sender".to_string())
            .with_target("receiver".to_string());

        let bytes = message.to_bytes().unwrap();
        let decoded = BusinessMessage::from_bytes(&bytes).unwrap();

        assert_eq!(message.id, decoded.id);
        assert_eq!(message.message_type, decoded.message_type);
        assert_eq!(message.payload, decoded.payload);
        assert_eq!(message.source_id, decoded.source_id);
        assert_eq!(message.target_id, decoded.target_id);
    }

    #[test]
    fn test_business_message_timestamp() {
        let before = chrono::Utc::now().timestamp_millis();
        let message = BusinessMessage::new(MessageType::Heartbeat, vec![]);
        let after = chrono::Utc::now().timestamp_millis();

        assert!(message.timestamp >= before);
        assert!(message.timestamp <= after);
    }

    // ============================================================================
    // BusinessEnvelope Tests
    // ============================================================================

    #[test]
    fn test_business_envelope_new() {
        let envelope = BusinessEnvelope::new();

        assert!(envelope.message_id.is_empty());
        assert_eq!(envelope.type_, BusinessMessageType::BusinessUnknown);
        assert!(envelope.payload.is_empty());
        assert_eq!(envelope.timestamp, 0);
        assert!(envelope.source_id.is_empty());
        assert!(envelope.target_id.is_empty());
    }

    #[test]
    fn test_business_envelope_builder_pattern() {
        let envelope = BusinessEnvelope::new()
            .with_message_id("msg-123".to_string())
            .with_type(BusinessMessageType::AgentTaskRequest)
            .with_payload(vec![1, 2, 3])
            .with_source_id("admin-1".to_string())
            .with_target_id("agent-1".to_string());

        assert_eq!(envelope.message_id, "msg-123");
        assert_eq!(envelope.type_, BusinessMessageType::AgentTaskRequest);
        assert_eq!(envelope.payload, vec![1, 2, 3]);
        assert_eq!(envelope.source_id, "admin-1");
        assert_eq!(envelope.target_id, "agent-1");
    }

    #[test]
    fn test_business_envelope_serialization() {
        let envelope = BusinessEnvelope::new()
            .with_message_id("msg-456".to_string())
            .with_type(BusinessMessageType::FileTransferRequest)
            .with_payload(vec![0x01, 0x02, 0x03])
            .with_source_id("server".to_string())
            .with_target_id("client".to_string());

        let bytes = envelope.to_bytes().unwrap();
        let decoded = BusinessEnvelope::from_bytes(&bytes).unwrap();

        assert_eq!(envelope.message_id, decoded.message_id);
        assert_eq!(envelope.type_, decoded.type_);
        assert_eq!(envelope.payload, decoded.payload);
        assert_eq!(envelope.source_id, decoded.source_id);
        assert_eq!(envelope.target_id, decoded.target_id);
    }

    #[test]
    fn test_business_envelope_default() {
        let default: BusinessEnvelope = Default::default();

        assert!(default.message_id.is_empty());
        assert_eq!(default.type_, BusinessMessageType::BusinessUnknown);
    }

    // ============================================================================
    // BusinessMessageType Conversion Tests
    // ============================================================================

    #[test]
    fn test_business_message_type_from_i32() {
        assert_eq!(
            BusinessMessageType::from(1),
            BusinessMessageType::AgentTaskRequest
        );
        assert_eq!(
            BusinessMessageType::from(2),
            BusinessMessageType::AgentTaskResponse
        );
        assert_eq!(
            BusinessMessageType::from(3),
            BusinessMessageType::TaskProgress
        );
        assert_eq!(
            BusinessMessageType::from(4),
            BusinessMessageType::TaskCancel
        );
        assert_eq!(
            BusinessMessageType::from(10),
            BusinessMessageType::Heartbeat
        );
        assert_eq!(
            BusinessMessageType::from(20),
            BusinessMessageType::SystemNotify
        );
        assert_eq!(
            BusinessMessageType::from(99),
            BusinessMessageType::BusinessCustom
        );
        assert_eq!(
            BusinessMessageType::from(100),
            BusinessMessageType::FileTransferRequest
        );
        assert_eq!(
            BusinessMessageType::from(101),
            BusinessMessageType::FileTransferResponse
        );
        assert_eq!(
            BusinessMessageType::from(102),
            BusinessMessageType::FileBlock
        );
        assert_eq!(
            BusinessMessageType::from(103),
            BusinessMessageType::FileTransferCancel
        );
        assert_eq!(
            BusinessMessageType::from(104),
            BusinessMessageType::FileTransferDone
        );
        assert_eq!(
            BusinessMessageType::from(105),
            BusinessMessageType::FileTransferError
        );
        assert_eq!(
            BusinessMessageType::from(999),
            BusinessMessageType::BusinessUnknown
        );
    }

    #[test]
    fn test_business_message_type_into_i32() {
        assert_eq!(i32::from(BusinessMessageType::AgentTaskRequest), 1);
        assert_eq!(i32::from(BusinessMessageType::AgentTaskResponse), 2);
        assert_eq!(i32::from(BusinessMessageType::Heartbeat), 10);
        assert_eq!(i32::from(BusinessMessageType::FileTransferRequest), 100);
        assert_eq!(i32::from(BusinessMessageType::FileTransferDone), 104);
    }

    // ============================================================================
    // ChannelError Tests
    // ============================================================================

    #[test]
    fn test_channel_error_messages() {
        let error = ChannelError::NotConnected;
        assert!(error.to_string().contains("未连接"));

        let error = ChannelError::SendFailed("test".to_string());
        assert!(error.to_string().contains("发送失败"));

        let error = ChannelError::ReceiveFailed("test".to_string());
        assert!(error.to_string().contains("接收失败"));

        let error = ChannelError::Timeout;
        assert!(error.to_string().contains("超时"));

        let error = ChannelError::ChannelClosed;
        assert!(error.to_string().contains("已关闭"));
    }
}
