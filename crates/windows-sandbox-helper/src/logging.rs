//! Command logging for audit trail.

use std::fs::OpenOptions;
use std::io::Write;
use std::path::Path;
use std::path::PathBuf;

const LOG_COMMAND_PREVIEW_LIMIT: usize = 200;
pub const LOG_FILE_NAME: &str = "sandbox_commands.rust.log";

fn preview(command: &[String]) -> String {
    let joined = command.join(" ");
    if joined.len() <= LOG_COMMAND_PREVIEW_LIMIT {
        joined
    } else {
        joined[..LOG_COMMAND_PREVIEW_LIMIT].to_string()
    }
}

fn log_file_path(base_dir: &Path) -> Option<PathBuf> {
    if base_dir.is_dir() {
        Some(base_dir.join(LOG_FILE_NAME))
    } else {
        None
    }
}

fn append_line(line: &str, base_dir: Option<&Path>) {
    if let Some(dir) = base_dir {
        if let Some(path) = log_file_path(dir) {
            if let Ok(mut f) = OpenOptions::new().create(true).append(true).open(path) {
                let _ = writeln!(f, "{}", line);
            }
        }
    }
}

pub fn log_start(command: &[String], base_dir: Option<&Path>) {
    append_line(&format!("START: {}", preview(command)), base_dir);
}

pub fn log_success(command: &[String], base_dir: Option<&Path>) {
    append_line(&format!("SUCCESS: {}", preview(command)), base_dir);
}

pub fn log_failure(command: &[String], detail: &str, base_dir: Option<&Path>) {
    append_line(&format!("FAILURE: {} ({})", preview(command), detail), base_dir);
}

pub fn debug_log(msg: &str, base_dir: Option<&Path>) {
    if std::env::var("SBX_DEBUG").ok().as_deref() == Some("1") {
        append_line(&format!("DEBUG: {}", msg), base_dir);
        eprintln!("{}", msg);
    }
}

pub fn log_note(msg: &str, base_dir: Option<&Path>) {
    append_line(msg, base_dir);
}
