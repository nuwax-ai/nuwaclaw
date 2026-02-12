// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    // Tauri 官方方案：尽早修复 PATH，使 GUI 进程及子进程能拿到用户 shell 的 PATH
    #[cfg(not(any(target_os = "android", target_os = "ios")))]
    let _ = fix_path_env::fix();

    agent_tauri_client_lib::run()
}
