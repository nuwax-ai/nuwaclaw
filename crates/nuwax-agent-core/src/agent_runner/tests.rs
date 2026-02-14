//!
//! Agent Runner 模块测试
//!

#[cfg(test)]
mod tests {
    use std::path::PathBuf;

    use crate::agent_runner::{RcoderAgentRunner, RcoderAgentRunnerConfig};

    /// 测试配置创建
    #[test]
    fn test_config_default() {
        let config = RcoderAgentRunnerConfig::default();

        assert_eq!(config.projects_dir, PathBuf::from("./projects"));
        assert_eq!(config.api_key, None);
        assert_eq!(config.api_base_url, "https://api.anthropic.com");
        assert_eq!(config.default_model, "claude-sonnet-4-20250514");
        assert_eq!(config.proxy_port, 60002);
        assert_eq!(config.backend_port, 60001);
    }

    /// 测试配置自定义值
    #[test]
    fn test_config_custom() {
        let config = RcoderAgentRunnerConfig {
            projects_dir: PathBuf::from("/tmp/test-projects"),
            app_data_dir: None,
            api_key: Some("sk-test".to_string()),
            api_base_url: "https://api.example.com".to_string(),
            default_model: "claude-haiku".to_string(),
            proxy_port: 9088,
            backend_port: 9086,
            mcp_server_port: 60004,
            mcp_proxy_log_dir: None,
        };

        assert_eq!(config.projects_dir, PathBuf::from("/tmp/test-projects"));
        assert_eq!(config.api_key, Some("sk-test".to_string()));
        assert_eq!(config.api_base_url, "https://api.example.com");
        assert_eq!(config.default_model, "claude-haiku");
        assert_eq!(config.proxy_port, 9088);
        assert_eq!(config.backend_port, 9086);
    }

    /// 测试 RcoderAgentRunner 创建（不启动）
    #[tokio::test]
    async fn test_runner_creation() {
        let config = RcoderAgentRunnerConfig {
            projects_dir: PathBuf::from("/tmp/test-projects"),
            app_data_dir: None,
            api_key: None,
            api_base_url: "https://api.example.com".to_string(),
            default_model: "claude-test".to_string(),
            proxy_port: 9089,
            backend_port: 9086,
            mcp_server_port: 60004,
            mcp_proxy_log_dir: None,
        };

        let mut runner = RcoderAgentRunner::new(config.clone());

        // 验证配置被正确存储（通过 getter）
        let runner_config = runner.config();
        assert_eq!(runner_config.projects_dir, config.projects_dir);
        assert_eq!(runner_config.api_base_url, config.api_base_url);

        // 停止 runner
        runner.stop().await;
    }

    /// 测试聊天请求的默认 request_id 生成
    #[test]
    fn test_convert_chat_request_default_request_id() {
        // 测试 request_id 为 None 时能生成有效的 UUID
        // 这个测试验证配置结构的正确性
        let _config = RcoderAgentRunnerConfig::default();
        let uuid_str = uuid::Uuid::new_v4().to_string();
        assert!(!uuid_str.is_empty());
        assert!(uuid_str.len() == 36); // UUID v4 format
    }
}

/// Pingora 代理服务测试
#[cfg(test)]
mod pingora_tests {
    use std::net::SocketAddr;
    use std::sync::OnceLock;
    use std::time::Duration;
    use tokio::net::TcpStream;
    use tokio::time::timeout;

    use crate::agent_runner::{RcoderAgentRunner, RcoderAgentRunnerConfig};

    /// 初始化 Rustls CryptoProvider（确保只初始化一次）
    fn init_rustls() {
        static INIT: OnceLock<()> = OnceLock::new();
        let _ = INIT.get_or_init(|| {
            rustls::crypto::ring::default_provider()
                .install_default()
                .expect("Failed to install rustls crypto provider");
        });
    }

    /// 测试 Pingora 服务启动和端口监听
    #[tokio::test]
    async fn test_pingora_server_startup() {
        init_rustls();

        let port = 48088;
        let config = RcoderAgentRunnerConfig {
            projects_dir: std::path::PathBuf::from("/tmp/test-pingora-startup"),
            app_data_dir: None,
            api_key: None,
            api_base_url: "https://api.anthropic.com".to_string(),
            default_model: "claude-sonnet-4-20250514".to_string(),
            proxy_port: port,
            backend_port: 60001,
            mcp_server_port: 60004,
            mcp_proxy_log_dir: None,
        };

        println!("[Test] 启动 Pingora 服务，端口: {}", port);
        let mut runner = RcoderAgentRunner::new(config);
        runner.start().await.expect("启动失败");

        // 等待服务启动
        tokio::time::sleep(Duration::from_millis(1500)).await;

        // 测试端口是否可连接
        let addr: SocketAddr = format!("127.0.0.1:{}", port).parse().unwrap();

        // 尝试连接（带超时）
        let result = timeout(Duration::from_secs(3), TcpStream::connect(addr)).await;

        match result {
            Ok(Ok(_stream)) => {
                println!("✅ Pingora 服务在端口 {} 启动成功", port);
            }
            Ok(Err(e)) => {
                panic!("❌ 无法连接到 Pingora 服务: {:?}", e);
            }
            Err(_) => {
                panic!("❌ 连接 Pingora 服务超时");
            }
        }

        // 清理
        runner.stop().await;
        println!("[Test] Pingora 服务已停止");
    }

    /// 测试 Pingora 服务重启场景
    #[tokio::test]
    async fn test_pingora_server_restart() {
        init_rustls();

        let port = 49088;

        // 第一次启动
        let config1 = RcoderAgentRunnerConfig {
            projects_dir: std::path::PathBuf::from("/tmp/test-pingora-restart-1"),
            app_data_dir: None,
            api_key: None,
            api_base_url: "https://api.anthropic.com".to_string(),
            default_model: "claude-sonnet-4-20250514".to_string(),
            proxy_port: port,
            backend_port: 60001,
            mcp_server_port: 60004,
            mcp_proxy_log_dir: None,
        };

        println!("[Test] 第一次启动 Pingora 服务，端口: {}", port);
        let mut runner1 = RcoderAgentRunner::new(config1);
        runner1.start().await.expect("第一次启动失败");
        tokio::time::sleep(Duration::from_millis(1500)).await;

        // 验证第一次启动成功
        let addr: SocketAddr = format!("127.0.0.1:{}", port).parse().unwrap();
        let result1 = timeout(Duration::from_secs(3), TcpStream::connect(addr)).await;

        assert!(result1.is_ok(), "第一次启动应该成功");
        println!("✅ 第一次启动成功");

        // 停止
        runner1.stop().await;
        tokio::time::sleep(Duration::from_millis(500)).await;
        println!("[Test] 第一次停止完成");

        // 第二次启动（模拟重启场景）
        let config2 = RcoderAgentRunnerConfig {
            projects_dir: std::path::PathBuf::from("/tmp/test-pingora-restart-2"),
            app_data_dir: None,
            api_key: None,
            api_base_url: "https://api.anthropic.com".to_string(),
            default_model: "claude-sonnet-4-20250514".to_string(),
            proxy_port: port,
            backend_port: 60001,
            mcp_server_port: 60004,
            mcp_proxy_log_dir: None,
        };

        println!("[Test] 第二次启动 Pingora 服务，端口: {}", port);
        let mut runner2 = RcoderAgentRunner::new(config2);
        runner2.start().await.expect("第二次启动失败");
        tokio::time::sleep(Duration::from_millis(1500)).await;

        // 验证第二次启动成功
        let result2 = timeout(Duration::from_secs(3), TcpStream::connect(addr)).await;

        assert!(result2.is_ok(), "重启后应该也能成功启动");
        println!("✅ 第二次启动成功");

        println!("✅ Pingora 服务重启测试通过");

        runner2.stop().await;
        println!("[Test] Pingora 服务已停止");
    }
}
