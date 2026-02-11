use crate::state::*;

/// 启动 nuwax-file-server
#[tauri::command]
pub async fn file_server_start(
    state: tauri::State<'_, ServiceManagerState>,
) -> Result<bool, String> {
    let manager = state.manager.lock().await;
    manager.file_server_start().await?;
    Ok(true)
}

/// 停止 nuwax-file-server
#[tauri::command]
pub async fn file_server_stop(
    state: tauri::State<'_, ServiceManagerState>,
) -> Result<bool, String> {
    let manager = state.manager.lock().await;
    manager.file_server_stop().await?;
    Ok(true)
}

/// 重启 nuwax-file-server
#[tauri::command]
pub async fn file_server_restart(
    state: tauri::State<'_, ServiceManagerState>,
) -> Result<bool, String> {
    let manager = state.manager.lock().await;
    manager.file_server_restart().await?;
    Ok(true)
}
