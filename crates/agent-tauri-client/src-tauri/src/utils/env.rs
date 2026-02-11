use std::collections::HashSet;

/// 修复 macOS GUI 应用的 PATH 环境变量问题
///
/// macOS GUI 应用(从 Finder、Dock 或 Spotlight 启动)不继承 shell 的环境变量。
/// 这导致通过 nvm、homebrew 等工具安装的命令(如 claude-code-acp-ts)找不到。
///
/// 该函数通过启动用户的默认 shell 并读取其 PATH 环境变量来解决此问题。
#[cfg(target_os = "macos")]
pub fn fix_macos_path_env() -> Result<(), Box<dyn std::error::Error>> {
    use std::process::Command;

    // 获取用户的默认 shell
    let shell = std::env::var("SHELL").unwrap_or_else(|_| "/bin/zsh".to_string());

    // 通过 login shell 获取正确的 PATH
    // -l: 作为 login shell 启动,会读取 .zprofile, .zshrc 等配置文件
    // -c: 执行命令
    let output = Command::new(&shell)
        .args(["-l", "-c", "echo $PATH"])
        .output()?;

    if output.status.success() {
        let path = String::from_utf8_lossy(&output.stdout).trim().to_string();
        if !path.is_empty() {
            // 获取当前 PATH 并合并
            let current_path = std::env::var("PATH").unwrap_or_default();

            // 合并 PATH,避免重复
            let mut paths: HashSet<String> = HashSet::new();
            let mut ordered_paths: Vec<String> = Vec::new();

            // 先添加 shell 的 PATH(优先级更高)
            for p in path.split(':') {
                if !p.is_empty() && paths.insert(p.to_string()) {
                    ordered_paths.push(p.to_string());
                }
            }

            // 再添加当前 PATH 中不重复的部分
            for p in current_path.split(':') {
                if !p.is_empty() && paths.insert(p.to_string()) {
                    ordered_paths.push(p.to_string());
                }
            }

            let new_path = ordered_paths.join(":");
            std::env::set_var("PATH", &new_path);

            eprintln!("[PATH Fix] Successfully fixed PATH environment");
            eprintln!(
                "[PATH Fix] New PATH includes: {} entries",
                ordered_paths.len()
            );
        }
    } else {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!("Shell command failed: {}", stderr).into());
    }

    Ok(())
}

/// Linux GUI 应用(从桌面启动器启动)不继承用户 shell 的 PATH
/// 这导致通过 nvm/pyenv 安装的命令找不到
/// 逻辑与 fix_macos_path_env 相同
#[cfg(target_os = "linux")]
pub fn fix_linux_path_env() -> Result<(), Box<dyn std::error::Error>> {
    use std::process::Command;

    let shell = std::env::var("SHELL").unwrap_or_else(|_| "/bin/bash".to_string());

    let output = Command::new(&shell)
        .args(["-l", "-c", "echo $PATH"])
        .output()?;

    if output.status.success() {
        let path = String::from_utf8_lossy(&output.stdout).trim().to_string();
        if !path.is_empty() {
            let current_path = std::env::var("PATH").unwrap_or_default();

            let mut paths: HashSet<String> = HashSet::new();
            let mut ordered_paths: Vec<String> = Vec::new();

            for p in path.split(':') {
                if !p.is_empty() && paths.insert(p.to_string()) {
                    ordered_paths.push(p.to_string());
                }
            }

            for p in current_path.split(':') {
                if !p.is_empty() && paths.insert(p.to_string()) {
                    ordered_paths.push(p.to_string());
                }
            }

            let new_path = ordered_paths.join(":");
            std::env::set_var("PATH", &new_path);

            eprintln!("[PATH Fix] Successfully fixed Linux PATH environment");
            eprintln!(
                "[PATH Fix] New PATH includes: {} entries",
                ordered_paths.len()
            );
        }
    } else {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!("Shell command failed: {}", stderr).into());
    }

    Ok(())
}

/// 构建包含 node bin 目录的 PATH 环境变量(委托给 nuwax-agent-core)
pub fn build_node_path_env() -> String {
    nuwax_agent_core::utils::build_node_path_env()
}
