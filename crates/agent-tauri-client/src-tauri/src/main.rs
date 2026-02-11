// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    // Tauri 官方方案：尽早修复 PATH，使 GUI 进程及子进程能拿到用户 shell 的 PATH
    #[cfg(not(any(target_os = "android", target_os = "ios")))]
    let _ = fix_path_env::fix();

    // 确保进程 PATH 包含 ~/.local/bin，以便所有子进程（含 rcoder 启动的 claude-code-acp-ts）都能找到 node
    #[cfg(not(any(target_os = "android", target_os = "ios")))]
    std::env::set_var("PATH", nuwax_agent_core::utils::build_node_path_env());

    agent_tauri_client_lib::run()
}
