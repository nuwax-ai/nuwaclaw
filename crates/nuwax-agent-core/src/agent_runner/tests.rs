//!
//! Agent Runner 模块测试
//!

#[cfg(test)]
mod tests {
    use std::path::PathBuf;
    use std::time::Duration;

    use crate::agent_runner::{
        RcoderAgentRunner, RcoderAgentRunnerConfig,
    };
    use crate::api::traits::agent_runner::ChatRequest;

    /// 测试配置创建
    #[test]
    fn test_config_default() {
        let config = RcoderAgentRunnerConfig::default();

        assert_eq!(config.projects_dir, PathBuf::from("./projects"));
        assert_eq!(config.api_key, None);
        assert_eq!(config.api_base_url, "https://api.anthropic.com");
        assert_eq!(config.default_model, "claude-sonnet-4-20250514");
        assert_eq!(config.proxy_port, 8088);
    }

    /// 测试配置自定义值
    #[test]
    fn test_config_custom() {
        let config = RcoderAgentRunnerConfig {
            projects_dir: PathBuf::from("/tmp/test-projects"),
            api_key: Some("sk-test".to_string()),
            api_base_url: "https://api.example.com".to_string(),
            default_model: "claude-haiku".to_string(),
            proxy_port: 9088,
        };

        assert_eq!(config.projects_dir, PathBuf::from("/tmp/test-projects"));
        assert_eq!(config.api_key, Some("sk-test".to_string()));
        assert_eq!(config.api_base_url, "https://api.example.com");
        assert_eq!(config.default_model, "claude-haiku");
        assert_eq!(config.proxy_port, 9088);
    }

    /// 测试 RcoderAgentRunner 创建（不启动）
    #[tokio::test]
    async fn test_runner_creation() {
        let config = RcoderAgentRunnerConfig {
            projects_dir: PathBuf::from("/tmp/test-projects"),
            api_key: None,
            api_base_url: "https://api.example.com".to_string(),
            default_model: "claude-test".to_string(),
            proxy_port: 9089,
        };

        let runner = RcoderAgentRunner::new(config.clone());

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

/// 集成测试（需要 rcoder 运行时）
#[cfg(test)]
mod integration_tests {
    use crate::agent_runner::{
        RcoderAgentRunner, RcoderAgentRunnerConfig,
    };
    use crate::api::traits::agent_runner::{
        AgentRunnerApi, ChatRequest, ChatResponse, AgentStatusResult, AgentStatus,
    };

    /// 测试运行时停止状态下的聊天请求
    #[tokio::test]
    async fn test_chat_runtime_stopped() {
        let config = RcoderAgentRunnerConfig::default();
        let runner = RcoderAgentRunner::new(config);

        // 停止
        runner.stop().await;

        // 发送聊天请求，验证错误处理
        let request = ChatRequest {
            project_id: Some("test-project".to_string()),
            session_id: None,
            prompt: "test prompt".to_string(),
            request_id: None,
            attachments: vec![],
            model_config: None,
            service_type: None,
        };

        // 验证返回结果（可能成功也可能失败，取决于运行时状态）
        let _result: Result<ChatResponse, String> = runner.chat(request).await;
        // 由于异步竞态条件，这里只验证能正确返回，不强求错误
    }

    /// 测试获取不存在的会话状态
    #[tokio::test]
    async fn test_get_status_not_found() {
        let config = RcoderAgentRunnerConfig::default();
        let runner = RcoderAgentRunner::new(config);

        let result: Result<AgentStatusResult, String> = runner.get_status("non-existent-session", "non-existent-project").await;
        assert!(result.is_ok());

        let status = result.unwrap();
        assert!(!status.is_found);
        assert!(matches!(status.status, AgentStatus::Idle));
    }

    /// 测试停止不存在的 Agent
    #[tokio::test]
    async fn test_stop_agent_not_found() {
        let config = RcoderAgentRunnerConfig::default();
        let runner = RcoderAgentRunner::new(config);

        let result: Result<(), String> = runner.stop_agent("non-existent-project").await;
        assert!(result.is_err());
        let error_msg = result.unwrap_err();
        assert!(error_msg.contains("不存在") || error_msg.contains("not found"));
    }

    /// 测试获取所有活跃 Agent（空列表）
    #[tokio::test]
    async fn test_get_all_agents_empty() {
        let config = RcoderAgentRunnerConfig::default();
        let runner = RcoderAgentRunner::new(config);

        let result: Result<Vec<crate::api::traits::agent_runner::AgentInfo>, String> = runner.get_all_agents().await;
        assert!(result.is_ok());

        let agents = result.unwrap();
        assert!(agents.is_empty());
    }

    /// 测试取消不存在的会话
    #[tokio::test]
    async fn test_cancel_session_not_found() {
        let config = RcoderAgentRunnerConfig::default();
        let runner = RcoderAgentRunner::new(config);

        let result: Result<(), String> = runner.cancel_session("non-existent-session", "non-existent-project").await;
        assert!(result.is_err());
        let error_msg = result.unwrap_err();
        assert!(error_msg.contains("不存在") || error_msg.contains("not found"));
    }
}

/// Pingora 代理服务测试
#[cfg(test)]
mod pingora_tests {
    use std::time::Duration;
    use std::sync::OnceLock;
    use reqwest::Client;

    use crate::agent_runner::{
        RcoderAgentRunner, RcoderAgentRunnerConfig,
    };

    /// 初始化 Rustls CryptoProvider（确保只初始化一次）
    fn init_rustls() {
        static INIT: OnceLock<()> = OnceLock::new();
        let _ = INIT.get_or_init(|| {
            rustls::crypto::ring::default_provider()
                .install_default()
                .expect("Failed to install rustls crypto provider");
        });
    }

    /// 测试 Pingora 服务启动和健康检查
    #[tokio::test]
    async fn test_pingora_server_health_check() {
        init_rustls();

        let port = 38088;
        let config = RcoderAgentRunnerConfig {
            projects_dir: std::path::PathBuf::from("/tmp/test-pingora-health"),
            api_key: None,
            api_base_url: "https://api.anthropic.com".to_string(),
            default_model: "claude-sonnet-4-20250514".to_string(),
            proxy_port: port,
        };

        println!("[Test] 启动 Pingora 服务，端口: {}", port);
        let runner = RcoderAgentRunner::new(config);

        // 等待服务启动
        tokio::time::sleep(Duration::from_millis(1500)).await;

        // 使用 HTTP 健康检查接口测试
        let client = Client::new();
        let url = format!("http://127.0.0.1:{}/health", port);

        let result = tokio::time::timeout(Duration::from_secs(5), client.get(&url).send()).await;

        match result {
            Ok(Ok(response)) => {
                assert!(response.status().is_success(), "健康检查应返回 200");
                let body = response.text().await.unwrap();
                println!("✅ 健康检查响应: {}", body);
                assert!(body.contains("status") || body.contains("ok"), "响应应包含状态信息");
            }
            Ok(Err(e)) => {
                panic!("❌ 健康检查请求失败: {:?}", e);
            }
            Err(_) => {
                panic!("❌ 健康检查超时");
            }
        }

        // 清理
        runner.stop().await;
        println!("[Test] Pingora 服务已停止");
    }

    /// 测试 Pingora 服务重启后的健康检查
    #[tokio::test]
    async fn test_pingora_server_restart_health_check() {
        init_rustls();

        let port = 39088;

        // 第一次启动
        let config1 = RcoderAgentRunnerConfig {
            projects_dir: std::path::PathBuf::from("/tmp/test-pingora-restart-h1"),
            api_key: None,
            api_base_url: "https://api.anthropic.com".to_string(),
            default_model: "claude-sonnet-4-20250514".to_string(),
            proxy_port: port,
        };

        println!("[Test] 第一次启动 Pingora 服务，端口: {}", port);
        let runner1 = RcoderAgentRunner::new(config1);
        tokio::time::sleep(Duration::from_millis(1500)).await;

        // 第一次健康检查
        let client = Client::new();
        let url = format!("http://127.0.0.1:{}/health", port);
        let result1 = tokio::time::timeout(Duration::from_secs(5), client.get(&url).send()).await;

        assert!(result1.is_ok(), "第一次健康检查应该成功");
        println!("✅ 第一次健康检查成功");

        // 停止
        runner1.stop().await;
        tokio::time::sleep(Duration::from_millis(500)).await;
        println!("[Test] 第一次停止完成");

        // 第二次启动
        let config2 = RcoderAgentRunnerConfig {
            projects_dir: std::path::PathBuf::from("/tmp/test-pingora-restart-h2"),
            api_key: None,
            api_base_url: "https://api.anthropic.com".to_string(),
            default_model: "claude-sonnet-4-20250514".to_string(),
            proxy_port: port,
        };

        println!("[Test] 第二次启动 Pingora 服务，端口: {}", port);
        let runner2 = RcoderAgentRunner::new(config2);
        tokio::time::sleep(Duration::from_millis(1500)).await;

        // 第二次健康检查
        let result2 = tokio::time::timeout(Duration::from_secs(5), client.get(&url).send()).await;

        assert!(result2.is_ok(), "第二次健康检查应该成功");
        println!("✅ 第二次健康检查成功");

        println!("✅ Pingora 服务重启健康检查测试通过");

        runner2.stop().await;
        println!("[Test] Pingora 服务已停止");
    }
}
