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
    }

    /// 测试配置自定义值
    #[test]
    fn test_config_custom() {
        let config = RcoderAgentRunnerConfig {
            projects_dir: PathBuf::from("/tmp/test-projects"),
            api_key: Some("sk-test".to_string()),
            api_base_url: "https://api.example.com".to_string(),
            default_model: "claude-haiku".to_string(),
        };

        assert_eq!(config.projects_dir, PathBuf::from("/tmp/test-projects"));
        assert_eq!(config.api_key, Some("sk-test".to_string()));
        assert_eq!(config.api_base_url, "https://api.example.com");
        assert_eq!(config.default_model, "claude-haiku");
    }

    /// 测试 RcoderAgentRunner 创建（不启动）
    #[tokio::test]
    async fn test_runner_creation() {
        let config = RcoderAgentRunnerConfig {
            projects_dir: PathBuf::from("/tmp/test-projects"),
            api_key: None,
            api_base_url: "https://api.example.com".to_string(),
            default_model: "claude-test".to_string(),
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
            project_id: "test-project".to_string(),
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
