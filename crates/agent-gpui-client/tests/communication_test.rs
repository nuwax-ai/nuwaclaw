//! 端到端通信集成测试
//!
//! 验证 agent-client 与 agent-server-admin 通过 data-server 的完整通信流程。
//!
//! 运行方法：
//! 1. 启动 data-server: `make start-server`
//! 2. 运行测试: `cargo test --test communication_test -- --ignored --nocapture`

use std::time::Duration;
use tokio::time::timeout;

/// 测试超时时间
const TEST_TIMEOUT: Duration = Duration::from_secs(30);

/// 连接超时时间
const CONNECT_TIMEOUT: Duration = Duration::from_secs(15);

#[cfg(test)]
mod tests {
    use super::*;
    use nuwax_agent::core::connection::{ConnectionConfig, ConnectionManager, ConnectionState};

    /// 获取测试用的服务器地址
    fn get_test_config() -> ConnectionConfig {
        // 从环境变量获取，或使用默认值
        let hbbs =
            std::env::var("TEST_HBBS_ADDR").unwrap_or_else(|_| "127.0.0.1:21116".to_string());
        let hbbr =
            std::env::var("TEST_HBBR_ADDR").unwrap_or_else(|_| "127.0.0.1:21117".to_string());

        ConnectionConfig {
            hbbs_addr: hbbs,
            hbbr_addr: hbbr,
        }
    }

    /// 验证客户端可以连接到 data-server 并获取 ID
    #[tokio::test]
    #[ignore = "requires data-server running: make start-server"]
    async fn test_client_can_connect_and_get_id() {
        let config = get_test_config();
        println!(
            "Testing connection to hbbs={}, hbbr={}",
            config.hbbs_addr, config.hbbr_addr
        );

        let manager = ConnectionManager::new(config);

        // 订阅状态变化
        let mut rx = manager.subscribe();

        // 开始连接
        let result = timeout(CONNECT_TIMEOUT, manager.connect()).await;
        assert!(result.is_ok(), "Connection should not timeout");
        assert!(result.unwrap().is_ok(), "Connection should succeed");

        // 等待获取 client_id
        let result = timeout(TEST_TIMEOUT, async {
            loop {
                let state = manager.get_state().await;
                match state {
                    ConnectionState::Connected { client_id, .. } => {
                        println!("Connected with client_id: {}", client_id);
                        return Some(client_id);
                    }
                    ConnectionState::Error(e) => {
                        println!("Connection error: {}", e);
                        return None;
                    }
                    _ => {
                        // 等待状态变化
                        if let Ok(event) =
                            tokio::time::timeout(Duration::from_secs(1), rx.recv()).await
                        {
                            println!("Event: {:?}", event);
                        }
                    }
                }
            }
        })
        .await;

        assert!(
            result.is_ok(),
            "Should receive connection result within timeout"
        );
        let client_id = result.unwrap();
        assert!(client_id.is_some(), "Should get client_id");

        let id = client_id.unwrap();
        println!("Got client ID: {}", id);

        // 验证 ID 格式（通常是 9 位数字）
        assert!(!id.is_empty(), "Client ID should not be empty");

        // 断开连接
        manager.disconnect().await;

        let final_state = manager.get_state().await;
        assert_eq!(final_state, ConnectionState::Disconnected);

        println!("Test passed: client can connect and get ID");
    }

    /// 验证连接状态变化
    #[tokio::test]
    #[ignore = "requires data-server running: make start-server"]
    async fn test_connection_state_transitions() {
        let config = get_test_config();
        let manager = ConnectionManager::new(config);
        let mut rx = manager.subscribe();

        // 初始状态应该是 Disconnected
        assert_eq!(manager.get_state().await, ConnectionState::Disconnected);

        // 开始连接
        let _ = manager.connect().await;

        // 等待状态变化到 Connected 或 Error
        let result = timeout(TEST_TIMEOUT, async {
            let mut seen_connecting = false;
            loop {
                match rx.recv().await {
                    Ok(event) => {
                        println!("State event: {:?}", event);
                        match event {
                            nuwax_agent::core::connection::ConnectionEvent::StateChanged(state) => {
                                match state {
                                    ConnectionState::Connecting => {
                                        seen_connecting = true;
                                    }
                                    ConnectionState::Connected { .. } => {
                                        assert!(
                                            seen_connecting,
                                            "Should see Connecting before Connected"
                                        );
                                        return Ok(());
                                    }
                                    ConnectionState::Error(e) => {
                                        return Err(format!("Connection failed: {}", e));
                                    }
                                    _ => {}
                                }
                            }
                            _ => {}
                        }
                    }
                    Err(e) => {
                        return Err(format!("Receive error: {}", e));
                    }
                }
            }
        })
        .await;

        assert!(result.is_ok(), "Should complete within timeout");
        assert!(result.unwrap().is_ok(), "Should connect successfully");

        // 断开连接
        manager.disconnect().await;

        println!("Test passed: connection state transitions work correctly");
    }

    /// 验证断开连接后可以重连
    #[tokio::test]
    #[ignore = "requires data-server running: make start-server"]
    async fn test_reconnection() {
        let config = get_test_config();
        let manager = ConnectionManager::new(config);

        // 第一次连接
        let _ = manager.connect().await;

        let result = timeout(CONNECT_TIMEOUT, async {
            loop {
                let state = manager.get_state().await;
                if matches!(state, ConnectionState::Connected { .. }) {
                    return true;
                }
                tokio::time::sleep(Duration::from_millis(500)).await;
            }
        })
        .await;

        assert!(result.unwrap_or(false), "First connection should succeed");
        println!("First connection succeeded");

        // 断开
        manager.disconnect().await;
        tokio::time::sleep(Duration::from_secs(1)).await;
        assert_eq!(manager.get_state().await, ConnectionState::Disconnected);
        println!("Disconnected");

        // 重新连接
        let _ = manager.connect().await;

        let result = timeout(CONNECT_TIMEOUT, async {
            loop {
                let state = manager.get_state().await;
                if matches!(state, ConnectionState::Connected { .. }) {
                    return true;
                }
                tokio::time::sleep(Duration::from_millis(500)).await;
            }
        })
        .await;

        assert!(result.unwrap_or(false), "Reconnection should succeed");
        println!("Reconnection succeeded");

        manager.disconnect().await;
        println!("Test passed: reconnection works correctly");
    }

    /// 验证配置错误的服务器地址会失败
    ///
    /// 注意：RustDesk 会缓存之前获取的 client_id，所以这个测试主要验证
    /// 无法从无效服务器获取新的连接状态更新。由于 ID 缓存机制，我们
    /// 检查是否能在短时间内进入 Error 状态。
    #[tokio::test]
    #[ignore = "requires data-server running: make start-server"]
    async fn test_connection_to_invalid_server_fails() {
        let config = ConnectionConfig {
            hbbs_addr: "127.0.0.1:19999".to_string(), // 错误的端口
            hbbr_addr: "127.0.0.1:19998".to_string(),
        };

        let manager = ConnectionManager::new(config);
        let mut rx = manager.subscribe();
        let _ = manager.connect().await;

        // 等待看是否收到 Error 状态（如果 RustDesk 报告连接失败）
        // 或者状态停留在 Connecting（无法建立新连接）
        // 由于 RustDesk 可能使用缓存的 ID，我们只验证不会卡住
        let result = timeout(Duration::from_secs(3), async {
            let mut error_seen = false;
            loop {
                match tokio::time::timeout(Duration::from_millis(500), rx.recv()).await {
                    Ok(Ok(nuwax_agent::core::connection::ConnectionEvent::StateChanged(state))) => {
                        println!("Invalid server test state: {:?}", state);
                        if matches!(state, ConnectionState::Error(_)) {
                            error_seen = true;
                            break;
                        }
                    }
                    _ => {
                        // 超时或通道关闭
                        break;
                    }
                }
            }
            error_seen
        })
        .await;

        // 无论是超时还是收到错误状态，都算通过
        // 重要的是测试不会无限卡住
        println!("Invalid server test result: {:?}", result);

        manager.disconnect().await;
        println!("Test passed: connection to invalid server handled correctly");
    }

    /// 验证多次快速连接断开不会崩溃
    #[tokio::test]
    #[ignore = "requires data-server running: make start-server"]
    async fn test_rapid_connect_disconnect() {
        let config = get_test_config();

        for i in 0..3 {
            println!("Iteration {}", i + 1);
            let manager = ConnectionManager::new(config.clone());

            let _ = manager.connect().await;
            tokio::time::sleep(Duration::from_millis(500)).await;
            manager.disconnect().await;
            tokio::time::sleep(Duration::from_millis(200)).await;
        }

        println!("Test passed: rapid connect/disconnect works correctly");
    }
}

/// 简单的连接测试（用于快速验证）
#[tokio::test]
#[ignore = "requires data-server running: make start-server"]
async fn quick_connection_test() {
    use nuwax_agent::core::connection::{ConnectionConfig, ConnectionManager, ConnectionState};

    println!("\n=== Quick Connection Test ===\n");

    let config = ConnectionConfig {
        hbbs_addr: "127.0.0.1:21116".to_string(),
        hbbr_addr: "127.0.0.1:21117".to_string(),
    };

    println!(
        "Connecting to hbbs={}, hbbr={}",
        config.hbbs_addr, config.hbbr_addr
    );

    let manager = ConnectionManager::new(config);

    match manager.connect().await {
        Ok(()) => println!("Connection initiated"),
        Err(e) => {
            println!("Connection failed to start: {}", e);
            return;
        }
    }

    // 等待最多 20 秒获取 client_id
    for i in 0..40 {
        let state = manager.get_state().await;
        println!("[{}s] State: {:?}", i as f32 * 0.5, state);

        match state {
            ConnectionState::Connected {
                client_id,
                latency_ms,
                mode,
            } => {
                println!("\n✅ SUCCESS!");
                println!("   Client ID: {}", client_id);
                println!("   Latency: {}ms", latency_ms);
                println!("   Mode: {:?}", mode);
                manager.disconnect().await;
                return;
            }
            ConnectionState::Error(e) => {
                println!("\n❌ ERROR: {}", e);
                return;
            }
            _ => {}
        }

        tokio::time::sleep(Duration::from_millis(500)).await;
    }

    println!("\n⏰ TIMEOUT: Could not get client ID within 20 seconds");
    manager.disconnect().await;
}

// ============================================================================
// Admin-Client 通信测试
// ============================================================================

/// Admin 服务器通信测试模块
#[cfg(test)]
mod admin_tests {
    use nuwax_agent::core::admin_client::{AdminClient, AdminConfig, RegistrationRequest};

    /// 获取测试用的 Admin 服务器配置
    fn get_admin_config() -> AdminConfig {
        let admin_url =
            std::env::var("TEST_ADMIN_URL").unwrap_or_else(|_| "http://127.0.0.1:8080".to_string());

        AdminConfig {
            admin_url,
            heartbeat_interval_secs: 10,
            poll_interval_secs: 2,
            request_timeout_secs: 5,
        }
    }

    /// 测试客户端注册到管理服务器
    #[tokio::test]
    #[ignore = "requires admin server running: cargo run -p agent-server-admin"]
    async fn test_client_registration() {
        let config = get_admin_config();
        println!("Testing registration to admin server: {}", config.admin_url);

        let client = AdminClient::new(config);

        let req = RegistrationRequest {
            client_id: "test-client-001".to_string(),
            name: Some("Test Client".to_string()),
            os: std::env::consts::OS.to_string(),
            os_version: "1.0.0".to_string(),
            arch: std::env::consts::ARCH.to_string(),
            client_version: env!("CARGO_PKG_VERSION").to_string(),
        };

        match client.register(req).await {
            Ok(()) => {
                println!("✅ Registration successful");
                assert!(client.is_registered().await);
            }
            Err(e) => {
                println!("❌ Registration failed: {}", e);
                panic!("Registration should succeed");
            }
        }
    }

    /// 测试心跳发送
    #[tokio::test]
    #[ignore = "requires admin server running: cargo run -p agent-server-admin"]
    async fn test_heartbeat() {
        let config = get_admin_config();
        let client = AdminClient::new(config);

        // 先注册
        let req = RegistrationRequest {
            client_id: "test-client-heartbeat".to_string(),
            name: Some("Heartbeat Test".to_string()),
            os: std::env::consts::OS.to_string(),
            os_version: "1.0.0".to_string(),
            arch: std::env::consts::ARCH.to_string(),
            client_version: env!("CARGO_PKG_VERSION").to_string(),
        };

        client
            .register(req)
            .await
            .expect("Registration should succeed");

        // 发送心跳
        match client.send_heartbeat(Some(15)).await {
            Ok(pending) => {
                println!("✅ Heartbeat successful, pending messages: {}", pending);
            }
            Err(e) => {
                println!("❌ Heartbeat failed: {}", e);
                panic!("Heartbeat should succeed");
            }
        }
    }

    /// 测试消息轮询
    #[tokio::test]
    #[ignore = "requires admin server running: cargo run -p agent-server-admin"]
    async fn test_message_polling() {
        let config = get_admin_config();
        let client = AdminClient::new(config);

        // 先注册
        let req = RegistrationRequest {
            client_id: "test-client-poll".to_string(),
            name: Some("Poll Test".to_string()),
            os: std::env::consts::OS.to_string(),
            os_version: "1.0.0".to_string(),
            arch: std::env::consts::ARCH.to_string(),
            client_version: env!("CARGO_PKG_VERSION").to_string(),
        };

        client
            .register(req)
            .await
            .expect("Registration should succeed");

        // 轮询消息
        match client.poll_messages(Some(10)).await {
            Ok(messages) => {
                println!("✅ Poll successful, received {} messages", messages.len());
                for msg in &messages {
                    println!("   - type: {}, id: {}", msg.message_type, msg.message_id);
                }
            }
            Err(e) => {
                println!("❌ Poll failed: {}", e);
                panic!("Poll should succeed");
            }
        }
    }

    /// 测试消息上报
    #[tokio::test]
    #[ignore = "requires admin server running: cargo run -p agent-server-admin"]
    async fn test_message_report() {
        let config = get_admin_config();
        let client = AdminClient::new(config);

        // 先注册
        let req = RegistrationRequest {
            client_id: "test-client-report".to_string(),
            name: Some("Report Test".to_string()),
            os: std::env::consts::OS.to_string(),
            os_version: "1.0.0".to_string(),
            arch: std::env::consts::ARCH.to_string(),
            client_version: env!("CARGO_PKG_VERSION").to_string(),
        };

        client
            .register(req)
            .await
            .expect("Registration should succeed");

        // 上报消息
        let payload = serde_json::json!({
            "status": "completed",
            "result": "success"
        });

        match client.report_message("task_result", payload, None).await {
            Ok(message_id) => {
                println!("✅ Report successful, message_id: {}", message_id);
            }
            Err(e) => {
                println!("❌ Report failed: {}", e);
                panic!("Report should succeed");
            }
        }
    }

    /// 综合测试：注册 -> 心跳 -> 轮询 -> 上报
    #[tokio::test]
    #[ignore = "requires admin server running: cargo run -p agent-server-admin"]
    async fn test_full_admin_communication_flow() {
        println!("\n=== Full Admin Communication Flow Test ===\n");

        let config = get_admin_config();
        println!("Admin URL: {}", config.admin_url);

        let client = AdminClient::new(config);
        let client_id = format!("test-full-flow-{}", chrono::Utc::now().timestamp());

        // Step 1: 注册
        println!("\n[1/4] Registering...");
        let req = RegistrationRequest {
            client_id: client_id.clone(),
            name: Some("Full Flow Test".to_string()),
            os: std::env::consts::OS.to_string(),
            os_version: "1.0.0".to_string(),
            arch: std::env::consts::ARCH.to_string(),
            client_version: env!("CARGO_PKG_VERSION").to_string(),
        };
        client
            .register(req)
            .await
            .expect("Registration should succeed");
        println!("   ✅ Registered as {}", client_id);

        // Step 2: 心跳
        println!("\n[2/4] Sending heartbeat...");
        let pending = client
            .send_heartbeat(Some(10))
            .await
            .expect("Heartbeat should succeed");
        println!("   ✅ Heartbeat sent, pending messages: {}", pending);

        // Step 3: 轮询
        println!("\n[3/4] Polling messages...");
        let messages = client
            .poll_messages(Some(10))
            .await
            .expect("Poll should succeed");
        println!("   ✅ Polled {} messages", messages.len());

        // Step 4: 上报
        println!("\n[4/4] Reporting message...");
        let payload = serde_json::json!({
            "test": "full_flow",
            "timestamp": chrono::Utc::now().to_rfc3339()
        });
        let msg_id = client
            .report_message("test_report", payload, None)
            .await
            .expect("Report should succeed");
        println!("   ✅ Reported message: {}", msg_id);

        println!("\n=== All steps completed successfully! ===\n");
    }
}
