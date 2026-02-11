//! 剪贴板工具
//!
//! 跨平台剪贴板操作（复制文本）

use tracing::debug;

use crate::utils::CommandNoWindowExt;

/// 复制文本到剪贴板
pub fn copy_to_clipboard(text: &str) -> anyhow::Result<()> {
    debug!("Copying text to clipboard ({} chars)", text.len());

    #[cfg(target_os = "macos")]
    {
        use std::process::Command;
        let mut child = Command::new("pbcopy")
            .no_window()
            .stdin(std::process::Stdio::piped())
            .spawn()?;

        if let Some(ref mut stdin) = child.stdin {
            use std::io::Write;
            stdin.write_all(text.as_bytes())?;
        }

        let status = child.wait()?;
        if !status.success() {
            anyhow::bail!("pbcopy failed with status: {}", status);
        }

        Ok(())
    }

    #[cfg(target_os = "windows")]
    {
        use std::process::Command;
        let mut child = Command::new("cmd")
            .no_window()
            .args(["/c", "clip"])
            .stdin(std::process::Stdio::piped())
            .spawn()?;

        if let Some(ref mut stdin) = child.stdin {
            use std::io::Write;
            stdin.write_all(text.as_bytes())?;
        }

        let status = child.wait()?;
        if !status.success() {
            anyhow::bail!("clip failed with status: {}", status);
        }

        return Ok(());
    }

    #[cfg(target_os = "linux")]
    {
        use std::process::Command;

        // 优先使用 xclip，其次 xsel，最后 wl-copy (Wayland)
        let tools = [
            ("xclip", vec!["-selection", "clipboard"]),
            ("xsel", vec!["--clipboard", "--input"]),
            ("wl-copy", vec![]),
        ];

        for (tool, args) in &tools {
            if let Ok(mut child) = Command::new(tool)
                .no_window()
                .args(args)
                .stdin(std::process::Stdio::piped())
                .spawn()
            {
                if let Some(ref mut stdin) = child.stdin {
                    use std::io::Write;
                    if stdin.write_all(text.as_bytes()).is_ok() {
                        if let Ok(status) = child.wait() {
                            if status.success() {
                                return Ok(());
                            }
                        }
                    }
                }
            }
        }

        anyhow::bail!("No clipboard tool found (tried xclip, xsel, wl-copy)");
    }

    #[cfg(not(any(target_os = "macos", target_os = "windows", target_os = "linux")))]
    {
        warn!("Clipboard not supported on this platform");
        anyhow::bail!("Clipboard not supported on this platform");
    }
}

/// 从剪贴板读取文本
pub fn read_from_clipboard() -> anyhow::Result<String> {
    #[cfg(target_os = "macos")]
    {
        use std::process::Command;
        let output = Command::new("pbpaste").no_window().output()?;
        if output.status.success() {
            return Ok(String::from_utf8_lossy(&output.stdout).to_string());
        }
        anyhow::bail!("pbpaste failed");
    }

    #[cfg(target_os = "windows")]
    {
        use std::process::Command;
        let output = Command::new("powershell")
            .no_window()
            .args(["-command", "Get-Clipboard"])
            .output()?;
        if output.status.success() {
            return Ok(String::from_utf8_lossy(&output.stdout).trim().to_string());
        }
        anyhow::bail!("Get-Clipboard failed");
    }

    #[cfg(target_os = "linux")]
    {
        use std::process::Command;

        let tools = [
            ("xclip", vec!["-selection", "clipboard", "-o"]),
            ("xsel", vec!["--clipboard", "--output"]),
            ("wl-paste", vec![]),
        ];

        for (tool, args) in &tools {
            if let Ok(output) = Command::new(tool).no_window().args(args).output() {
                if output.status.success() {
                    return Ok(String::from_utf8_lossy(&output.stdout).to_string());
                }
            }
        }

        anyhow::bail!("No clipboard tool found");
    }

    #[cfg(not(any(target_os = "macos", target_os = "windows", target_os = "linux")))]
    {
        anyhow::bail!("Clipboard not supported on this platform");
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_clipboard_roundtrip() {
        // 仅在 CI 以外的环境中运行（需要剪贴板访问）
        if std::env::var("CI").is_ok() {
            return;
        }

        let text = "Test clipboard content 测试剪贴板";
        if copy_to_clipboard(text).is_ok() {
            if let Ok(result) = read_from_clipboard() {
                assert!(result.contains("Test clipboard content"));
            }
        }
    }
}
