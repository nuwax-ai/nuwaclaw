# codex-acp fork: src/lib.rs 改动说明

## 改动点

1. `let config` → `let mut config`（允许修改）
2. config 加载后、`CodexAgent::new()` 前插入环境变量覆盖逻辑

## 完整文件

```rust
//! Codex ACP - An Agent Client Protocol implementation for Codex.
#![deny(clippy::print_stdout, clippy::print_stderr)]

use agent_client_protocol::ByteStreams;
use codex_core::config::{Config, ConfigOverrides};
use codex_utils_cli::CliConfigOverrides;
use std::path::PathBuf;
use std::sync::Arc;
use tokio_util::compat::{TokioAsyncReadCompatExt, TokioAsyncWriteCompatExt};
use tracing_subscriber::EnvFilter;

mod codex_agent;
mod thread;

/// Run the Codex ACP agent.
///
/// This sets up an ACP agent that communicates over stdio, bridging
/// the ACP protocol with the existing codex-rs infrastructure.
///
/// # Errors
///
/// If unable to parse the config or start the program.
pub async fn run_main(
    codex_linux_sandbox_exe: Option<PathBuf>,
    cli_config_overrides: CliConfigOverrides,
) -> std::io::Result<()> {
    // Install a simple subscriber so `tracing` output is visible.
    // Users can control the log level with `RUST_LOG`.
    tracing_subscriber::fmt()
        .with_writer(std::io::stderr)
        .with_env_filter(EnvFilter::from_default_env())
        .init();

    // Parse CLI overrides and load configuration
    let cli_kv_overrides = cli_config_overrides.parse_overrides().map_err(|e| {
        std::io::Error::new(
            std::io::ErrorKind::InvalidInput,
            format!("error parsing -c overrides: {e}"),
        )
    })?;

    let config_overrides = ConfigOverrides {
        codex_linux_sandbox_exe: codex_linux_sandbox_exe.clone(),
        ..ConfigOverrides::default()
    };

    let mut config =
        Config::load_with_cli_overrides_and_harness_overrides(cli_kv_overrides, config_overrides)
            .await
            .map_err(|e| {
                std::io::Error::new(
                    std::io::ErrorKind::InvalidData,
                    format!("error loading config: {e}"),
                )
            })?;

    // --- NuwaClaw: environment variable overrides ---
    // Priority: config.toml fields > env vars > hardcoded defaults
    // These CODEX_* vars are injected by the Electron host (acpClient.ts)
    // to deliver ACP-distributed model configuration without writing
    // sensitive data to disk.

    // CODEX_BASE_URL → override current provider's base_url
    if config.model_provider.base_url.is_none() {
        if let Ok(url) = std::env::var("CODEX_BASE_URL") {
            if !url.trim().is_empty() {
                tracing::info!("CODEX_BASE_URL env var overriding provider base_url");
                config.model_provider.base_url = Some(url.clone());
                // Also update the entry in model_providers map so downstream
                // code that reads from the map sees the override.
                if let Some(provider) =
                    config.model_providers.get_mut(&config.model_provider_id)
                {
                    provider.base_url = Some(url);
                }
            }
        }
    }

    // CODEX_API_KEY → override API key
    // The built-in OpenAI provider has env_key = None, so AuthManager reads
    // OPENAI_API_KEY directly. We write CODEX_API_KEY into OPENAI_API_KEY
    // so AuthManager picks it up normally.
    if let Ok(api_key) = std::env::var("CODEX_API_KEY") {
        if !api_key.trim().is_empty() {
            tracing::info!("CODEX_API_KEY env var overriding OPENAI_API_KEY");
            // SAFETY: This runs in run_main before the Tokio runtime is
            // multi-threaded (we are still in single-threaded setup).
            // CodexAgent::new() below is the first spawn point.
            unsafe { std::env::set_var("OPENAI_API_KEY", &api_key) };
        }
    }

    // CODEX_MODEL → override model name
    if config.model.is_none() {
        if let Ok(model) = std::env::var("CODEX_MODEL") {
            if !model.trim().is_empty() {
                tracing::info!("CODEX_MODEL env var overriding config model");
                config.model = Some(model);
            }
        }
    }
    // --- End NuwaClaw overrides ---

    // Apply residency requirement so the HTTP client sends the
    // x-openai-internal-codex-residency header on all requests.
    codex_login::default_client::set_default_client_residency_requirement(
        config.enforce_residency.value(),
    );

    let agent = Arc::new(codex_agent::CodexAgent::new(config, codex_linux_sandbox_exe).await?);

    let stdin = tokio::io::stdin().compat();
    let stdout = tokio::io::stdout().compat_write();

    agent
        .serve(ByteStreams::new(stdout, stdin))
        .await
        .map_err(|e| std::io::Error::other(format!("ACP error: {e}")))?;

    Ok(())
}

// Re-export the MCP server types for compatibility
pub use codex_mcp_server::{
    CodexToolCallParam, CodexToolCallReplyParam, ExecApprovalElicitRequestParams,
    ExecApprovalResponse, PatchApprovalElicitRequestParams, PatchApprovalResponse,
};
```

## 关键说明

- `set_var` 使用 `unsafe` 块：在 Rust 2024 edition 中 `set_var` 标记为 unsafe（多线程环境下修改 env 可能 data race）。
  这里安全因为 `run_main` 在 Tokio runtime 启动前执行，是单线程的。
  `CodexAgent::new()` 在 env 设置之后才被调用。
- `tracing::info!` 用于调试，生产可去掉或改为 `tracing::debug!`。
- 三个 env var 互相独立，可只设置其中一个或全部。
