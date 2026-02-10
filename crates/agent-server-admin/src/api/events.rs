//! SSE 事件流 API

use std::convert::Infallible;
use std::time::Duration;

use axum::{
    extract::{Path, Query, State},
    http::StatusCode,
    response::sse::{Event, Sse},
};
use futures::stream::{self, Stream};
use tokio_stream::StreamExt;

use crate::state::{AppState, ServerEvent};

use super::dto::SseFilterParams;

/// SSE 事件流
pub async fn sse_events(
    State(state): State<AppState>,
    Query(params): Query<SseFilterParams>,
) -> Sse<impl Stream<Item = Result<Event, Infallible>>> {
    let rx = state.subscribe_events();
    let client_filter = params.client_id.clone();

    let stream = stream::unfold((rx, client_filter), |(mut rx, client_filter)| async move {
        loop {
            match rx.recv().await {
                Ok(event) => {
                    // 应用客户端过滤
                    let event_client_id = match &event {
                        ServerEvent::ClientOnline(id) => Some(id.clone()),
                        ServerEvent::ClientOffline(id) => Some(id.clone()),
                        ServerEvent::MessageReceived { client_id, .. } => Some(client_id.clone()),
                        ServerEvent::TaskCreated { client_id, .. } => Some(client_id.clone()),
                        ServerEvent::TaskStarted { client_id, .. } => Some(client_id.clone()),
                        ServerEvent::TaskProgress { client_id, .. } => Some(client_id.clone()),
                        ServerEvent::TaskCompleted { client_id, .. } => Some(client_id.clone()),
                        ServerEvent::TaskFailed { client_id, .. } => Some(client_id.clone()),
                        ServerEvent::TaskCancelled { client_id, .. } => Some(client_id.clone()),
                    };

                    if let Some(ref filter) = client_filter {
                        if event_client_id.as_ref() != Some(filter) {
                            continue;
                        }
                    }

                    let event_data = match &event {
                        ServerEvent::ClientOnline(id) => Event::default()
                            .event("client_online")
                            .data(serde_json::json!({ "client_id": id }).to_string()),
                        ServerEvent::ClientOffline(id) => Event::default()
                            .event("client_offline")
                            .data(serde_json::json!({ "client_id": id }).to_string()),
                        ServerEvent::MessageReceived {
                            client_id,
                            message_type,
                            payload,
                        } => Event::default().event("message").data(
                            serde_json::json!({
                                "client_id": client_id,
                                "message_type": message_type,
                                "payload": payload
                            })
                            .to_string(),
                        ),
                        ServerEvent::TaskCreated { task_id, client_id } => {
                            Event::default().event("task_created").data(
                                serde_json::json!({
                                    "task_id": task_id,
                                    "client_id": client_id
                                })
                                .to_string(),
                            )
                        }
                        ServerEvent::TaskStarted { task_id, client_id } => {
                            Event::default().event("task_started").data(
                                serde_json::json!({
                                    "task_id": task_id,
                                    "client_id": client_id
                                })
                                .to_string(),
                            )
                        }
                        ServerEvent::TaskProgress {
                            task_id,
                            client_id,
                            event,
                        } => Event::default().event("task_progress").data(
                            serde_json::json!({
                                "task_id": task_id,
                                "client_id": client_id,
                                "event": event
                            })
                            .to_string(),
                        ),
                        ServerEvent::TaskCompleted {
                            task_id,
                            client_id,
                            result,
                        } => Event::default().event("task_completed").data(
                            serde_json::json!({
                                "task_id": task_id,
                                "client_id": client_id,
                                "result": result
                            })
                            .to_string(),
                        ),
                        ServerEvent::TaskFailed {
                            task_id,
                            client_id,
                            error,
                            error_code,
                        } => Event::default().event("task_failed").data(
                            serde_json::json!({
                                "task_id": task_id,
                                "client_id": client_id,
                                "error": error,
                                "error_code": error_code
                            })
                            .to_string(),
                        ),
                        ServerEvent::TaskCancelled {
                            task_id,
                            client_id,
                            reason,
                        } => Event::default().event("task_cancelled").data(
                            serde_json::json!({
                                "task_id": task_id,
                                "client_id": client_id,
                                "reason": reason
                            })
                            .to_string(),
                        ),
                    };
                    return Some((Ok(event_data), (rx, client_filter)));
                }
                Err(_) => return None,
            }
        }
    });

    // 添加心跳
    let heartbeat = stream::repeat_with(|| Ok(Event::default().comment("heartbeat")))
        .throttle(Duration::from_secs(30));

    Sse::new(stream.merge(heartbeat)).keep_alive(
        axum::response::sse::KeepAlive::new()
            .interval(Duration::from_secs(15))
            .text("ping"),
    )
}

/// 任务进度 SSE（按任务 ID 过滤）
///
/// GET /api/tasks/:id/progress
pub async fn task_progress_sse(
    State(state): State<AppState>,
    Path(task_id): Path<String>,
) -> Result<Sse<impl Stream<Item = Result<Event, Infallible>>>, StatusCode> {
    let task = state.get_task(&task_id).ok_or(StatusCode::NOT_FOUND)?;

    let rx = state.subscribe_events();
    let target_task_id = task_id.clone();

    // 首先发送已有的进度事件
    let existing_events: Vec<_> = task
        .progress_events
        .iter()
        .map(|e| {
            Ok(Event::default().event("task_progress").data(
                serde_json::json!({
                    "task_id": task_id,
                    "client_id": task.client_id,
                    "event": e
                })
                .to_string(),
            ))
        })
        .collect();

    let existing_stream = stream::iter(existing_events);

    // 订阅新事件
    let live_stream = stream::unfold(
        (rx, target_task_id),
        |(mut rx, target_task_id)| async move {
            loop {
                match rx.recv().await {
                    Ok(event) => match &event {
                        ServerEvent::TaskProgress {
                            task_id,
                            client_id,
                            event,
                        } if task_id == &target_task_id => {
                            let event_data = Event::default().event("task_progress").data(
                                serde_json::json!({
                                    "task_id": task_id,
                                    "client_id": client_id,
                                    "event": event
                                })
                                .to_string(),
                            );
                            return Some((Ok(event_data), (rx, target_task_id)));
                        }
                        ServerEvent::TaskCompleted {
                            task_id,
                            client_id,
                            result,
                        } if task_id == &target_task_id => {
                            let event_data = Event::default().event("task_completed").data(
                                serde_json::json!({
                                    "task_id": task_id,
                                    "client_id": client_id,
                                    "result": result
                                })
                                .to_string(),
                            );
                            return Some((Ok(event_data), (rx, target_task_id)));
                        }
                        ServerEvent::TaskFailed {
                            task_id,
                            client_id,
                            error,
                            error_code,
                        } if task_id == &target_task_id => {
                            let event_data = Event::default().event("task_failed").data(
                                serde_json::json!({
                                    "task_id": task_id,
                                    "client_id": client_id,
                                    "error": error,
                                    "error_code": error_code
                                })
                                .to_string(),
                            );
                            return Some((Ok(event_data), (rx, target_task_id)));
                        }
                        ServerEvent::TaskCancelled {
                            task_id,
                            client_id,
                            reason,
                        } if task_id == &target_task_id => {
                            let event_data = Event::default().event("task_cancelled").data(
                                serde_json::json!({
                                    "task_id": task_id,
                                    "client_id": client_id,
                                    "reason": reason
                                })
                                .to_string(),
                            );
                            return Some((Ok(event_data), (rx, target_task_id)));
                        }
                        _ => continue,
                    },
                    Err(_) => return None,
                }
            }
        },
    );

    // 添加心跳
    let heartbeat = stream::repeat_with(|| Ok(Event::default().comment("heartbeat")))
        .throttle(Duration::from_secs(30));

    let combined = existing_stream.chain(live_stream).merge(heartbeat);

    Ok(Sse::new(combined).keep_alive(
        axum::response::sse::KeepAlive::new()
            .interval(Duration::from_secs(15))
            .text("ping"),
    ))
}
