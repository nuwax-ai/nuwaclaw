//! Computer Progress Handler (SSE)

use crate::api::traits::agent_runner::{AgentRunnerApi, ProgressMessage};
use super::AppError;
use axum::http::Response as HttpResponse;
use std::sync::Arc;
use tokio::sync::mpsc;
use tokio_stream::wrappers::ReceiverStream;

/// Computer Progress Handler (SSE)
///
/// 调用 AgentRunnerApi::subscribe_progress 方法，返回 SSE 流
#[axum::debug_handler]
pub async fn computer_progress(
    axum::extract::State(agent_runner_api): axum::extract::State<Arc<dyn AgentRunnerApi>>,
    path: axum::extract::Path<String>,
) -> Result<impl axum::response::IntoResponse, AppError> {
    let session_id = path.0;

    let mut receiver = agent_runner_api.subscribe_progress(&session_id).await?;

    // 创建通道用于 SSE
    let (tx, rx) = mpsc::channel::<Result<String, std::convert::Infallible>>(32);

    // 在后台任务中读取 receiver 并转换为 SSE
    tokio::spawn(async move {
        while let Some(msg) = receiver.recv().await {
            let data = format_sse_event(&msg);
            if tx.send(Ok(data)).await.is_err() {
                break;
            }
        }
    });

    let stream = ReceiverStream::new(rx);

    let response = HttpResponse::builder()
        .header("Content-Type", "text/event-stream")
        .header("Cache-Control", "no-cache")
        .header("Connection", "keep-alive")
        .body(axum::body::Body::from_stream(stream))?;

    Ok(response)
}

/// 将 ProgressMessage 格式化为 SSE 事件
fn format_sse_event(msg: &ProgressMessage) -> String {
    let data = serde_json::to_string(msg).unwrap_or_default();
    format!("data: {}\n\n", data)
}
