//! Computer Progress Handler (SSE)

use super::AppError;
use crate::api::traits::agent_runner::{AgentRunnerApi, ProgressMessage, ProgressMessageType};
use axum::response::sse::{Event, Sse};
use chrono::Utc;
use futures::stream::{self, Stream};
use std::convert::Infallible;
use std::sync::Arc;
use std::time::Duration;
use tracing::{debug, error, info};

/// Computer Progress Handler (SSE)
///
/// 调用 AgentRunnerApi::subscribe_progress 方法，返回 SSE 流
#[axum::debug_handler]
pub async fn computer_progress(
    axum::extract::State(agent_runner_api): axum::extract::State<Arc<dyn AgentRunnerApi>>,
    path: axum::extract::Path<String>,
) -> Result<Sse<impl Stream<Item = Result<Event, Infallible>>>, AppError> {
    let session_id = path.0;

    info!(
        "[computer_progress] 订阅进度请求: session_id={}",
        session_id
    );

    let receiver = match agent_runner_api.subscribe_progress(&session_id).await {
        Ok(rx) => {
            info!("[computer_progress] 订阅成功: session_id={}", session_id);
            rx
        }
        Err(e) => {
            error!(
                "[computer_progress] 订阅失败: session_id={}, error={}",
                session_id, e
            );
            return Err(AppError::from(e));
        }
    };

    // 使用 stream::unfold 将 mpsc::Receiver 转换为 Stream
    // 同时支持心跳消息（每 30 秒发送一次）
    let message_stream = stream::unfold(
        (receiver, session_id, tokio::time::Instant::now()),
        |(mut rx, session_id, last_heartbeat)| async move {
            let heartbeat_interval = Duration::from_secs(30);

            loop {
                let time_since_heartbeat = last_heartbeat.elapsed();
                let time_until_heartbeat = heartbeat_interval.saturating_sub(time_since_heartbeat);

                tokio::select! {
                    // 优先处理消息
                    msg = rx.recv() => {
                        match msg {
                            Some(msg) => {
                                let event = format_sse_event(&msg);
                                return Some((Ok(event), (rx, session_id, last_heartbeat)));
                            }
                            None => {
                                debug!(
                                    "[computer_progress] 消息通道已关闭: session_id={}",
                                    session_id
                                );
                                return None;
                            }
                        }
                    }
                    // 心跳定时器
                    _ = tokio::time::sleep(time_until_heartbeat) => {
                        let heartbeat = create_heartbeat_message(&session_id);
                        let event = format_sse_event(&heartbeat);
                        debug!("[computer_progress] 发送心跳: session_id={}", session_id);
                        return Some((Ok(event), (rx, session_id, tokio::time::Instant::now())));
                    }
                }
            }
        },
    );

    Ok(Sse::new(message_stream).keep_alive(
        axum::response::sse::KeepAlive::new()
            .interval(Duration::from_secs(15))
            .text("keep-alive"),
    ))
}

/// 创建心跳消息
///
/// 格式与 agent_runner 的 gRPC 心跳消息保持一致：
/// - message_type: Heartbeat
/// - sub_type: "ping"
/// - data: {"type":"heartbeat","message":"keep-alive"}
fn create_heartbeat_message(session_id: &str) -> ProgressMessage {
    ProgressMessage {
        session_id: session_id.to_string(),
        message_type: ProgressMessageType::Heartbeat,
        sub_type: "ping".to_string(),
        data: serde_json::json!({
            "type": "heartbeat",
            "message": "keep-alive"
        }),
        timestamp: Utc::now(),
    }
}

/// 将 ProgressMessage 格式化为 SSE Event
///
/// 使用 axum 的 Event 类型，格式与 rcoder 保持一致
fn format_sse_event(msg: &ProgressMessage) -> Event {
    let data = serde_json::to_string(msg).unwrap_or_default();
    Event::default().event(&msg.sub_type).data(data)
}
