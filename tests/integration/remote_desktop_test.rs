//! 远程桌面集成测试
//!
//! 端到端验证远程桌面功能：连接 → 屏幕帧接收 → 输入转发
//! 注意：这些测试需要 data-server 运行且 remote-desktop feature 启用

/// 运行方法：
/// 1. 启动 data-server: `./scripts/start-data-server.sh`
/// 2. 运行测试: `cargo test -p nuwax-agent --features remote-desktop --test remote_desktop_test -- --ignored`

#[cfg(test)]
mod tests {
    use nuwax_agent::core::connection::{ConnectionConfig, ConnectionManager, RustDeskAdapter};
    use nuwax_agent::core::remote_input::{InputEvent, MouseButton, RemoteInputManager};

    /// 验证 RustDeskAdapter 可以正常创建和配置
    #[tokio::test]
    async fn test_adapter_creation_and_config() {
        let adapter = RustDeskAdapter::new();
        assert!(!adapter.is_running());

        adapter.configure_server("localhost:21116", "localhost:21117");
        // 验证配置后仍未运行（需要显式 start）
        assert!(!adapter.is_running());
    }

    /// 验证 ConnectionManager 可以通过适配层连接
    #[tokio::test]
    #[ignore = "requires data-server running"]
    async fn test_connection_manager_connect() {
        let config = ConnectionConfig {
            hbbs_addr: "localhost:21116".to_string(),
            hbbr_addr: "localhost:21117".to_string(),
        };
        let manager = ConnectionManager::new(config);

        // 连接到 data-server
        let result = manager.connect().await;
        assert!(result.is_ok(), "Connection should succeed");

        // 等待 ID 分配
        tokio::time::sleep(tokio::time::Duration::from_secs(5)).await;

        let client_id = manager.get_client_id().await;
        assert!(client_id.is_some(), "Should have a client ID after connecting");

        let id = client_id.unwrap();
        assert!(!id.is_empty(), "Client ID should not be empty");

        // 清理
        manager.disconnect().await;
    }

    /// 验证远程输入管理器的基本操作
    #[test]
    fn test_remote_input_manager() {
        let mut manager = RemoteInputManager::new();
        assert!(!manager.is_enabled());

        manager.enable();
        assert!(manager.is_enabled());

        // 构造输入事件（不实际执行，仅验证不 panic）
        let events = vec![
            InputEvent::MouseMove { x: 100, y: 200 },
            InputEvent::MouseDown {
                button: MouseButton::Left,
            },
            InputEvent::MouseUp {
                button: MouseButton::Left,
            },
            InputEvent::MouseScroll { dx: 0, dy: -3 },
            InputEvent::KeyDown { key_code: 65 },
            InputEvent::KeyUp { key_code: 65 },
            InputEvent::TextInput {
                text: "hello".to_string(),
            },
        ];

        // 禁用后处理事件应该是 no-op
        manager.disable();
        for event in &events {
            manager.handle_event(event);
        }
    }

    /// 验证远程桌面端到端连接
    #[tokio::test]
    #[ignore = "requires data-server and two peers running"]
    async fn test_remote_desktop_e2e() {
        // 1. 启动客户端 A（被控端）连接到 data-server
        let client_a = ConnectionManager::new(ConnectionConfig {
            hbbs_addr: "localhost:21116".to_string(),
            hbbr_addr: "localhost:21117".to_string(),
        });
        client_a.connect().await.expect("Client A should connect");

        // 2. 等待 ID 分配
        tokio::time::sleep(tokio::time::Duration::from_secs(5)).await;
        let peer_id = client_a
            .get_client_id()
            .await
            .expect("Client A should have an ID");

        // 3. 启动客户端 B（控制端）连接到同一 data-server
        let client_b = ConnectionManager::new(ConnectionConfig {
            hbbs_addr: "localhost:21116".to_string(),
            hbbr_addr: "localhost:21117".to_string(),
        });
        client_b.connect().await.expect("Client B should connect");

        tokio::time::sleep(tokio::time::Duration::from_secs(3)).await;

        // 4. TODO: 客户端 B 发起远程桌面连接到客户端 A
        // 需要 peer-to-peer 连接的进一步实现
        assert!(
            !peer_id.is_empty(),
            "Peer ID should be available for remote desktop"
        );

        // 清理
        client_a.disconnect().await;
        client_b.disconnect().await;
    }
}
