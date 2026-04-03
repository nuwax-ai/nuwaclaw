//! Windows Restricted Token sandbox helper binary.
//!
//! Extracted and adapted from OpenAI Codex windows-sandbox-rs.
//! https://github.com/openai/codex
//!
//! Usage:
//! ```bash
//! nuwax-sandbox-helper run \
//!   --mode <read-only|workspace-write> \
//!   --cwd <path> \
//!   [--home <path>] \
//!   [--policy-json <json>] \
//!   -- <command> [args...]
//! ```
//!
//! Outputs JSON to stdout: { exit_code, stdout, stderr, timed_out }

#![cfg(target_os = "windows")]

mod acl;
mod allow;
mod audit;
mod cap;
mod env;
mod logging;
mod policy;
mod token;
mod winutil;

use acl::{add_allow_ace, add_deny_write_ace, allow_null_device, revoke_ace};
use allow::compute_allow_paths;
use audit::apply_world_writable_scan_and_denies;
use cap::{cap_sid_file, load_or_create_cap_sids};
use clap::{Parser, ValueEnum};
use env::{apply_no_network_to_env, ensure_non_interactive_pager, normalize_null_device_env};
use logging::{debug_log, log_failure, log_start, log_success};
use policy::SandboxPolicy;
use std::collections::HashMap;
use std::ffi::c_void;
use std::fs;
use std::io;
use std::path::Path;
use std::path::PathBuf;
use std::ptr;
use std::thread;
use std::sync::mpsc;
use token::{convert_string_sid_to_sid, create_readonly_token_with_cap, create_workspace_write_token_with_cap};
use winutil::{format_last_error, to_wide};
use windows_sys::Win32::Foundation::{CloseHandle, GetLastError, SetHandleInformation, HANDLE, HANDLE_FLAG_INHERIT, INVALID_HANDLE_VALUE};
use windows_sys::Win32::System::Pipes::CreatePipe;
use windows_sys::Win32::System::Threading::{
    CreateProcessAsUserW, GetExitCodeProcess, WaitForSingleObject, CREATE_UNICODE_ENVIRONMENT,
    INFINITE, PROCESS_INFORMATION, STARTF_USESTDHANDLES, STARTUPINFOW,
};

// ============================================================================
// CLI
// ============================================================================

#[derive(ValueEnum, Clone, Debug)]
enum Mode {
    ReadOnly,
    WorkspaceWrite,
}

#[derive(Parser, Debug)]
#[command(name = "nuwax-sandbox-helper")]
#[command(author = "Nuwax Agent")]
#[command(version = "0.1.0")]
struct Args {
    #[command(subcommand)]
    subcommand: Subcommand,
}

#[derive(Parser, Debug)]
enum Subcommand {
    Run(RunArgs),
}

#[derive(Parser, Debug)]
struct RunArgs {
    #[arg(long)]
    mode: Mode,
    #[arg(long)]
    cwd: PathBuf,
    #[arg(long, env = "NUWAX_SANDBOX_HOME")]
    home: Option<PathBuf>,
    #[arg(long)]
    policy_json: Option<String>,
    #[arg(last = true)]
    command: Vec<String>,
}

// ============================================================================
// Sandbox capture
// ============================================================================

type PipeHandles = ((HANDLE, HANDLE), (HANDLE, HANDLE), (HANDLE, HANDLE));

fn should_apply_network_block(policy: &SandboxPolicy) -> bool {
    !policy.has_full_network_access()
}

fn ensure_dir(p: &Path) -> anyhow::Result<()> {
    if let Some(d) = p.parent() {
        std::fs::create_dir_all(d)?;
    }
    Ok(())
}

fn ensure_sandbox_home_exists(p: &Path) -> anyhow::Result<()> {
    std::fs::create_dir_all(p)?;
    Ok(())
}

fn make_env_block(env: &HashMap<String, String>) -> Vec<u16> {
    let mut items: Vec<(String, String)> = env.iter().map(|(k, v)| (k.clone(), v.clone())).collect();
    items.sort_by(|a, b| a.0.to_uppercase().cmp(&b.0.to_uppercase()).then(a.0.cmp(&b.0)));
    let mut w: Vec<u16> = Vec::new();
    for (k, v) in items {
        let mut s = to_wide(format!("{}={}", k, v));
        s.pop();
        w.extend_from_slice(&s);
        w.push(0);
    }
    w.push(0);
    w
}

fn quote_windows_arg(arg: &str) -> String {
    let needs_quotes =
        arg.is_empty() || arg.chars().any(|c| matches!(c, ' ' | '\t' | '\n' | '\r' | '"'));
    if !needs_quotes {
        return arg.to_string();
    }
    let mut quoted = String::with_capacity(arg.len() + 2);
    quoted.push('"');
    let mut backslashes = 0usize;
    for ch in arg.chars() {
        match ch {
            '\\' => backslashes += 1,
            '"' => {
                quoted.push_str(&"\\".repeat(backslashes * 2 + 1));
                quoted.push('"');
                backslashes = 0;
            }
            _ => {
                if backslashes > 0 {
                    quoted.push_str(&"\\".repeat(backslashes));
                    backslashes = 0;
                }
                quoted.push(ch);
            }
        }
    }
    if backslashes > 0 {
        quoted.push_str(&"\\".repeat(backslashes * 2));
    }
    quoted.push('"');
    quoted
}

unsafe fn setup_stdio_pipes() -> io::Result<PipeHandles> {
    let mut in_r: HANDLE = 0;
    let mut in_w: HANDLE = 0;
    let mut out_r: HANDLE = 0;
    let mut out_w: HANDLE = 0;
    let mut err_r: HANDLE = 0;
    let mut err_w: HANDLE = 0;

    if CreatePipe(&mut in_r, &mut in_w, std::ptr::null_mut(), 0) == 0 {
        return Err(io::Error::from_raw_os_error(GetLastError() as i32));
    }
    if CreatePipe(&mut out_r, &mut out_w, std::ptr::null_mut(), 0) == 0 {
        return Err(io::Error::from_raw_os_error(GetLastError() as i32));
    }
    if CreatePipe(&mut err_r, &mut err_w, std::ptr::null_mut(), 0) == 0 {
        return Err(io::Error::from_raw_os_error(GetLastError() as i32));
    }
    if SetHandleInformation(in_r, HANDLE_FLAG_INHERIT, HANDLE_FLAG_INHERIT) == 0 {
        return Err(io::Error::from_raw_os_error(GetLastError() as i32));
    }
    if SetHandleInformation(out_w, HANDLE_FLAG_INHERIT, HANDLE_FLAG_INHERIT) == 0 {
        return Err(io::Error::from_raw_os_error(GetLastError() as i32));
    }
    if SetHandleInformation(err_w, HANDLE_FLAG_INHERIT, HANDLE_FLAG_INHERIT) == 0 {
        return Err(io::Error::from_raw_os_error(GetLastError() as i32));
    }
    Ok(((in_r, in_w), (out_r, out_w), (err_r, err_w)))
}

#[derive(Debug)]
pub struct CaptureResult {
    pub exit_code: i32,
    pub stdout: Vec<u8>,
    pub stderr: Vec<u8>,
    pub timed_out: bool,
}

pub fn run_sandbox_capture(
    policy_json_or_preset: &str,
    sandbox_policy_cwd: &Path,
    home: &Path,
    mut command: Vec<String>,
    cwd: &Path,
    args: Vec<String>,
    timeout_ms: Option<u64>,
) -> anyhow::Result<CaptureResult> {
    // Inherit the full current process environment; the sandbox policy
    // functions in env.rs will then restrict/modify it as needed.
    let mut env_map: HashMap<String, String> = std::env::vars().collect();
    command.extend(args);

    let policy = policy::parse_policy(policy_json_or_preset)?;
    let apply_network_block = should_apply_network_block(&policy);
    normalize_null_device_env(&mut env_map);
    ensure_non_interactive_pager(&mut env_map);
    if apply_network_block {
        apply_no_network_to_env(&mut env_map)?;
    }
    ensure_sandbox_home_exists(home)?;

    let current_dir = cwd.to_path_buf();
    let logs_base_dir = Some(home);
    log_start(&command, logs_base_dir);

    let cap_sid_path = cap_sid_file(home);
    let is_workspace_write = matches!(&policy, SandboxPolicy::WorkspaceWrite { .. });

    let (h_token, psid_to_use): (HANDLE, *mut c_void) = unsafe {
        match &policy {
            SandboxPolicy::ReadOnly => {
                let caps = load_or_create_cap_sids(home);
                ensure_dir(&cap_sid_path)?;
                fs::write(&cap_sid_path, serde_json::to_string(&caps)?)?;
                let psid = convert_string_sid_to_sid(&caps.readonly).unwrap();
                create_readonly_token_with_cap(psid)?
            }
            SandboxPolicy::WorkspaceWrite { .. } => {
                let caps = load_or_create_cap_sids(home);
                ensure_dir(&cap_sid_path)?;
                fs::write(&cap_sid_path, serde_json::to_string(&caps)?)?;
                let psid = convert_string_sid_to_sid(&caps.workspace).unwrap();
                create_workspace_write_token_with_cap(psid)?
            }
            SandboxPolicy::DangerFullAccess => {
                anyhow::bail!("DangerFullAccess is not supported for sandboxing")
            }
        }
    };

    unsafe {
        if is_workspace_write {
            if let Ok(base) = token::get_current_token_for_restriction() {
                if let Ok(bytes) = token::get_logon_sid_bytes(base) {
                    let mut tmp = bytes.clone();
                    let psid2 = tmp.as_mut_ptr() as *mut c_void;
                    allow_null_device(psid2);
                }
                CloseHandle(base);
            }
        }
    }

    let persist_aces = is_workspace_write;
    let allow_deny = compute_allow_paths(&policy, sandbox_policy_cwd, &current_dir, &env_map);
    let mut guards: Vec<(PathBuf, *mut c_void)> = Vec::new();

    unsafe {
        for p in &allow_deny.allow {
            if let Ok(added) = add_allow_ace(p, psid_to_use) {
                if added && !persist_aces {
                    guards.push((p.clone(), psid_to_use));
                }
            }
        }
        for p in &allow_deny.deny {
            if let Ok(added) = add_deny_write_ace(p, psid_to_use) {
                if added && !persist_aces {
                    guards.push((p.clone(), psid_to_use));
                }
            }
        }
        allow_null_device(psid_to_use);
    }

    // Apply world-writable audit scan (best-effort)
    let _ = apply_world_writable_scan_and_denies(home, &current_dir, &env_map, &policy, logs_base_dir);

    let (stdin_pair, stdout_pair, stderr_pair) = unsafe { setup_stdio_pipes()? };
    let ((in_r, in_w), (out_r, out_w), (err_r, err_w)) = (stdin_pair, stdout_pair, stderr_pair);

    let mut si: STARTUPINFOW = unsafe { std::mem::zeroed() };
    si.cb = std::mem::size_of::<STARTUPINFOW>() as u32;
    si.dwFlags |= STARTF_USESTDHANDLES;
    si.hStdInput = in_r;
    si.hStdOutput = out_w;
    si.hStdError = err_w;

    let mut pi: PROCESS_INFORMATION = unsafe { std::mem::zeroed() };

    let cmdline_str = command
        .iter()
        .map(|a| quote_windows_arg(a))
        .collect::<Vec<_>>()
        .join(" ");
    let mut cmdline: Vec<u16> = to_wide(&cmdline_str);
    let env_block = make_env_block(&env_map);
    let desktop = to_wide("Winsta0\\Default");
    si.lpDesktop = desktop.as_ptr() as *mut u16;

    let spawn_res = unsafe {
        CreateProcessAsUserW(
            h_token,
            ptr::null(),
            cmdline.as_mut_ptr(),
            ptr::null_mut(),
            ptr::null_mut(),
            1,
            CREATE_UNICODE_ENVIRONMENT,
            env_block.as_ptr() as *mut c_void,
            to_wide(cwd).as_ptr(),
            &si,
            &mut pi,
        )
    };

    if spawn_res == 0 {
        let err = unsafe { GetLastError() } as i32;
        let dbg = format!(
            "CreateProcessAsUserW failed: {} ({}) | cwd={} | cmd={} | env_u16_len={}",
            err,
            format_last_error(err),
            cwd.display(),
            cmdline_str,
            env_block.len(),
        );
        debug_log(&dbg, logs_base_dir);
        unsafe {
            CloseHandle(in_r);
            CloseHandle(in_w);
            CloseHandle(out_r);
            CloseHandle(out_w);
            CloseHandle(err_r);
            CloseHandle(err_w);
            CloseHandle(h_token);
        }
        return Err(anyhow::anyhow!("CreateProcessAsUserW failed: {}", err));
    }

    unsafe {
        CloseHandle(in_r);
        CloseHandle(in_w);
        CloseHandle(out_w);
        CloseHandle(err_w);
    }

    // Read stdout/stderr in background threads
    let (tx_out, rx_out) = mpsc::channel::<Vec<u8>>();
    let (tx_err, rx_err) = mpsc::channel::<Vec<u8>>();

    let t_out = thread::spawn(move || {
        let mut buf = Vec::new();
        let mut tmp = [0u8; 8192];
        loop {
            let mut read_bytes: u32 = 0;
            let ok = unsafe {
                windows_sys::Win32::Storage::FileSystem::ReadFile(
                    out_r,
                    tmp.as_mut_ptr(),
                    tmp.len() as u32,
                    &mut read_bytes,
                    std::ptr::null_mut(),
                )
            };
            if ok == 0 || read_bytes == 0 {
                break;
            }
            buf.extend_from_slice(&tmp[..read_bytes as usize]);
        }
        let _ = tx_out.send(buf);
    });

    let t_err = thread::spawn(move || {
        let mut buf = Vec::new();
        let mut tmp = [0u8; 8192];
        loop {
            let mut read_bytes: u32 = 0;
            let ok = unsafe {
                windows_sys::Win32::Storage::FileSystem::ReadFile(
                    err_r,
                    tmp.as_mut_ptr(),
                    tmp.len() as u32,
                    &mut read_bytes,
                    std::ptr::null_mut(),
                )
            };
            if ok == 0 || read_bytes == 0 {
                break;
            }
            buf.extend_from_slice(&tmp[..read_bytes as usize]);
        }
        let _ = tx_err.send(buf);
    });

    let timeout = timeout_ms.unwrap_or(u64::MAX).min(u64::from(INFINITE)) as u32;
    let res = unsafe { WaitForSingleObject(pi.hProcess, timeout) };
    let timed_out = res == 0x0000_0102;

    let mut exit_code_u32: u32 = 1;
    if !timed_out {
        unsafe { GetExitCodeProcess(pi.hProcess, &mut exit_code_u32); }
    } else {
        unsafe {
            windows_sys::Win32::System::Threading::TerminateProcess(pi.hProcess, 1);
        }
    }

    unsafe {
        if pi.hThread != 0 { CloseHandle(pi.hThread); }
        if pi.hProcess != 0 { CloseHandle(pi.hProcess); }
        CloseHandle(h_token);
    }

    let _ = t_out.join();
    let _ = t_err.join();
    let stdout = rx_out.recv().unwrap_or_default();
    let stderr = rx_err.recv().unwrap_or_default();
    let exit_code = if timed_out { 128 + 64 } else { exit_code_u32 as i32 };

    if exit_code == 0 {
        log_success(&command, logs_base_dir);
    } else {
        log_failure(&command, &format!("exit code {}", exit_code), logs_base_dir);
    }

    if !persist_aces {
        unsafe {
            for (p, sid) in guards {
                revoke_ace(&p, sid);
            }
        }
    }

    Ok(CaptureResult { exit_code, stdout, stderr, timed_out })
}

// ============================================================================
// main
// ============================================================================

fn main() -> anyhow::Result<()> {
    let args = Args::parse();

    match args.subcommand {
        Subcommand::Run(run) => {
            let home = run.home.unwrap_or_else(|| {
                dirs_next::home_dir()
                    .unwrap_or_else(|| PathBuf::from("C:\\Users\\Default"))
                    .join(".nuwax-sandbox")
            });

            let policy = if let Some(json) = run.policy_json {
                json
            } else {
                match run.mode {
                    Mode::ReadOnly => "read-only".to_string(),
                    Mode::WorkspaceWrite => "workspace-write".to_string(),
                }
            };

            if run.command.is_empty() {
                anyhow::bail!("no command provided; use `-- -- <command> [args...]`");
            }

            let cmd = run.command[0].clone();
            let cmd_args = run.command[1..].to_vec();

            let timeout_ms: u64 = 300_000;
            let result = run_sandbox_capture(
                &policy,
                &run.cwd,
                &home,
                vec![cmd],
                &run.cwd,
                cmd_args,
                Some(timeout_ms),
            )?;

            println!(
                "{{\"exit_code\":{},\"stdout\":{},\"stderr\":{},\"timed_out\":{}}}",
                result.exit_code,
                serde_json::to_string(&String::from_utf8_lossy(&result.stdout))?,
                serde_json::to_string(&String::from_utf8_lossy(&result.stderr))?,
                result.timed_out
            );
        }
    }

    Ok(())
}
