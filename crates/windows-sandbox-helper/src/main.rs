//! Windows Restricted Token sandbox helper binary.
//!
//! Extracted and adapted from OpenAI Codex windows-sandbox-rs.
//! https://github.com/openai/codex
//!
//! Usage:
//! ```bash
//! # Capture mode: run command, capture output, print JSON result
//! nuwax-sandbox-helper run \
//!   --mode <read-only|workspace-write> \
//!   --cwd <path> \
//!   [--home <path>] \
//!   [--policy-json <json>] \
//!   -- <command> [args...]
//!
//! # Proxy mode: run command as persistent stdio proxy (stdin/stdout forwarded)
//! nuwax-sandbox-helper serve \
//!   --mode <read-only|workspace-write> \
//!   --cwd <path> \
//!   [--home <path>] \
//!   [--policy-json <json>] \
//!   -- <command> [args...]
//! ```

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
use std::io::{self, Read, Write};
use std::path::Path;
use std::path::PathBuf;
use std::ptr;
use std::thread;
use std::sync::mpsc;
use std::time::Duration;
use token::{convert_string_sid_to_sid, create_readonly_token_with_cap, create_servable_token_with_cap, create_workspace_write_token_with_cap};
use winutil::{format_last_error, to_wide};
use windows_sys::Win32::Foundation::{CloseHandle, GetLastError, SetHandleInformation, HANDLE, HANDLE_FLAG_INHERIT};
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
    /// Run a command in the sandbox, capture output, print JSON result.
    Run(CommonArgs),
    /// Run a command in the sandbox as a persistent stdio proxy.
    /// Stdin/stdout/stderr are forwarded bidirectionally.
    ///
    /// 使用不含 WRITE_RESTRICTED 的令牌，允许子进程（ACP 引擎）继续 spawn 孙进程
    /// （如 claude-code CLI、MCP 服务器）。文件系统写保护由 DACL ACE 提供。
    Serve(CommonArgs),
}

#[derive(Parser, Debug)]
struct CommonArgs {
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
// Shared helpers
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

    if CreatePipe(&mut in_r, &mut in_w, ptr::null_mut(), 0) == 0 {
        return Err(io::Error::from_raw_os_error(GetLastError() as i32));
    }
    if CreatePipe(&mut out_r, &mut out_w, ptr::null_mut(), 0) == 0 {
        return Err(io::Error::from_raw_os_error(GetLastError() as i32));
    }
    if CreatePipe(&mut err_r, &mut err_w, ptr::null_mut(), 0) == 0 {
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

/// Helper to close an array of HANDLEs, ignoring nulls.
unsafe fn close_handles(handles: &[HANDLE]) {
    for &h in handles {
        if h != 0 {
            CloseHandle(h);
        }
    }
}

// ============================================================================
// Shared sandbox context (token + ACL + env setup)
// ============================================================================

/// Holds the state needed to spawn a sandboxed child process.
struct SandboxContext {
    /// Modified environment block for the child.
    env_map: HashMap<String, String>,
    /// Restricted token for CreateProcessAsUserW.
    h_token: HANDLE,
    /// Whether ACEs should persist (workspace-write mode).
    persist_aces: bool,
    /// ACE guards to revoke on cleanup (only when !persist_aces).
    guards: Vec<(PathBuf, *mut c_void)>,
    /// Logging directory.
    logs_base_dir: Option<PathBuf>,
    /// Full command line (for logging).
    command: Vec<String>,
}

impl SandboxContext {
    /// Set up sandbox policy, restricted token, ACLs, and environment.
    ///
    /// `is_serve`: 当为 true 时使用不含 WRITE_RESTRICTED 的令牌，允许子进程继续 spawn
    /// 孙进程（ACP 引擎进程级沙箱所需）。文件系统写保护降为 ACL 级单层。
    fn setup(
        policy_json_or_preset: &str,
        sandbox_policy_cwd: &Path,
        home: &Path,
        command: Vec<String>,
        cwd: &Path,
        args: Vec<String>,
        is_serve: bool,
    ) -> anyhow::Result<Self> {
        let mut env_map: HashMap<String, String> = std::env::vars().collect();
        let mut command = command;
        command.extend(args);

        let policy = policy::parse_policy(policy_json_or_preset)?;
        if should_apply_network_block(&policy) {
            normalize_null_device_env(&mut env_map);
            ensure_non_interactive_pager(&mut env_map);
            apply_no_network_to_env(&mut env_map)?;
        } else {
            normalize_null_device_env(&mut env_map);
            ensure_non_interactive_pager(&mut env_map);
        }
        ensure_sandbox_home_exists(home)?;

        let current_dir = cwd.to_path_buf();
        let logs_base_dir = Some(home.to_path_buf());
        log_start(&command, logs_base_dir.as_deref());

        let cap_sid_path = cap_sid_file(home);
        let is_workspace_write = matches!(&policy, SandboxPolicy::WorkspaceWrite { .. });

        let (h_token, psid): (HANDLE, *mut c_void) = unsafe {
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
                    if is_serve {
                        // serve 模式：去掉 WRITE_RESTRICTED，允许引擎进程 spawn 子进程
                        create_servable_token_with_cap(psid)?
                    } else {
                        create_workspace_write_token_with_cap(psid)?
                    }
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
                if let Ok(added) = add_allow_ace(p, psid) {
                    if added && !persist_aces {
                        guards.push((p.clone(), psid));
                    }
                }
            }
            for p in &allow_deny.deny {
                if let Ok(added) = add_deny_write_ace(p, psid) {
                    if added && !persist_aces {
                        guards.push((p.clone(), psid));
                    }
                }
            }
            allow_null_device(psid);
        }

        let _ = apply_world_writable_scan_and_denies(
            home, &current_dir, &env_map, &policy, logs_base_dir.as_deref(),
        );

        // Mark the child as running inside a sandbox so it skips nested sandboxing.
        env_map.insert("NUWAX_IN_SANDBOX".to_string(), "1".to_string());

        Ok(Self {
            env_map,
            h_token,
            persist_aces,
            guards,
            logs_base_dir,
            command,
        })
    }

    /// Spawn the child process with restricted token and the given stdio handles.
    /// Returns `(PROCESS_INFORMATION, cmdline_string)` on success.
    ///
    /// On failure, closes all pipe handles and the token.
    unsafe fn spawn_child(
        &self,
        cwd: &Path,
        child_stdin_r: HANDLE,
        child_stdout_w: HANDLE,
        child_stderr_w: HANDLE,
        all_pipe_handles: &[HANDLE],
    ) -> anyhow::Result<PROCESS_INFORMATION> {
        let mut si: STARTUPINFOW = std::mem::zeroed();
        si.cb = std::mem::size_of::<STARTUPINFOW>() as u32;
        si.dwFlags |= STARTF_USESTDHANDLES;
        si.hStdInput = child_stdin_r;
        si.hStdOutput = child_stdout_w;
        si.hStdError = child_stderr_w;

        let cmdline_str = self.command
            .iter()
            .map(|a| quote_windows_arg(a))
            .collect::<Vec<_>>()
            .join(" ");
        let mut cmdline: Vec<u16> = to_wide(&cmdline_str);
        let env_block = make_env_block(&self.env_map);
        let desktop = to_wide("Winsta0\\Default");
        si.lpDesktop = desktop.as_ptr() as *mut u16;

        let mut pi: PROCESS_INFORMATION = std::mem::zeroed();

        let spawn_res = CreateProcessAsUserW(
            self.h_token,
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
        );

        if spawn_res == 0 {
            let err = GetLastError() as i32;
            let msg = format!(
                "CreateProcessAsUserW failed: {} ({}) | cwd={} | cmd={} | env_u16_len={}",
                err,
                format_last_error(err),
                cwd.display(),
                cmdline_str,
                env_block.len(),
            );
            debug_log(&msg, self.logs_base_dir.as_deref());
            close_handles(all_pipe_handles);
            CloseHandle(self.h_token);
            return Err(anyhow::anyhow!("CreateProcessAsUserW failed: {}", err));
        }

        Ok(pi)
    }

    /// Log the result and revoke temporary ACEs.
    fn cleanup(&mut self, exit_code: i32) {
        if exit_code == 0 {
            log_success(&self.command, self.logs_base_dir.as_deref());
        } else {
            log_failure(&self.command, &format!("exit code {}", exit_code), self.logs_base_dir.as_deref());
        }

        if !self.persist_aces {
            unsafe {
                for (p, sid) in &self.guards {
                    revoke_ace(p, *sid);
                }
            }
        }
    }
}

// ============================================================================
// Resolve common args
// ============================================================================

fn resolve_home(args: &CommonArgs) -> PathBuf {
    args.home.clone().unwrap_or_else(|| {
        dirs_next::home_dir()
            .unwrap_or_else(|| PathBuf::from("C:\\Users\\Default"))
            .join(".nuwax-sandbox")
    })
}

fn resolve_policy(args: &CommonArgs) -> String {
    if let Some(json) = &args.policy_json {
        json.clone()
    } else {
        match args.mode {
            Mode::ReadOnly => "read-only".to_string(),
            Mode::WorkspaceWrite => "workspace-write".to_string(),
        }
    }
}

fn split_command(args: &CommonArgs) -> anyhow::Result<(String, Vec<String>)> {
    if args.command.is_empty() {
        anyhow::bail!("no command provided; use `-- -- <command> [args...]`");
    }
    Ok((args.command[0].clone(), args.command[1..].to_vec()))
}

// ============================================================================
// Capture mode (run subcommand)
// ============================================================================

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
    command: Vec<String>,
    cwd: &Path,
    args: Vec<String>,
    timeout_ms: Option<u64>,
) -> anyhow::Result<CaptureResult> {
    let mut ctx = SandboxContext::setup(policy_json_or_preset, sandbox_policy_cwd, home, command, cwd, args, false)?;

    let (stdin_pair, stdout_pair, stderr_pair) = unsafe { setup_stdio_pipes()? };
    let ((in_r, in_w), (out_r, out_w), (err_r, err_w)) = (stdin_pair, stdout_pair, stderr_pair);

    let all_pipes = [in_r, in_w, out_r, out_w, err_r, err_w];
    let pi = unsafe { ctx.spawn_child(cwd, in_r, out_w, err_w, &all_pipes)? };

    // Close all child-ends and the stdin write-end (capture mode doesn't forward stdin)
    unsafe {
        CloseHandle(in_r);   // child's stdin read end
        CloseHandle(in_w);   // parent's stdin write end (not forwarding stdin in capture mode)
        CloseHandle(out_w);  // child's stdout write end
        CloseHandle(err_w);  // child's stderr write end
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
                    ptr::null_mut(),
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
                    ptr::null_mut(),
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
        close_handles(&[pi.hThread, pi.hProcess, ctx.h_token]);
    }

    let _ = t_out.join();
    let _ = t_err.join();
    let stdout = rx_out.recv().unwrap_or_default();
    let stderr = rx_err.recv().unwrap_or_default();
    let exit_code = if timed_out { 128 + 64 } else { exit_code_u32 as i32 };

    ctx.cleanup(exit_code);

    Ok(CaptureResult { exit_code, stdout, stderr, timed_out })
}

// ============================================================================
// Proxy mode (serve subcommand)
// ============================================================================

/// Result of a proxy-mode sandbox run.
pub struct ProxyResult {
    pub exit_code: i32,
}

/// Run a sandboxed process with bidirectional stdio forwarding.
///
/// Unlike `run_sandbox_capture` which buffers all output and returns it as a
/// JSON blob, this function forwards data between the parent's
/// stdin ↔ child's stdin and child's stdout/stderr ↔ parent's stdout/stderr
/// in real time, keeping the helper alive as a persistent proxy until the
/// child exits or the parent closes stdin.
pub fn run_sandbox_proxy(
    policy_json_or_preset: &str,
    sandbox_policy_cwd: &Path,
    home: &Path,
    command: Vec<String>,
    cwd: &Path,
    args: Vec<String>,
) -> anyhow::Result<ProxyResult> {
    let mut ctx = SandboxContext::setup(policy_json_or_preset, sandbox_policy_cwd, home, command, cwd, args, true)?;

    let (stdin_pair, stdout_pair, stderr_pair) = unsafe { setup_stdio_pipes()? };
    let ((child_stdin_r, child_stdin_w), (child_stdout_r, child_stdout_w), (child_stderr_r, child_stderr_w)) =
        (stdin_pair, stdout_pair, stderr_pair);

    let all_pipes = [child_stdin_r, child_stdin_w, child_stdout_r, child_stdout_w, child_stderr_r, child_stderr_w];
    let pi = unsafe { ctx.spawn_child(cwd, child_stdin_r, child_stdout_w, child_stderr_w, &all_pipes)? };

    // Close child-side handles that the parent doesn't need
    unsafe {
        CloseHandle(child_stdin_r);  // child's stdin read end
        CloseHandle(child_stdout_w); // child's stdout write end
        CloseHandle(child_stderr_w); // child's stderr write end
    }

    // --- Bidirectional forwarding threads ---
    // stdin: parent_stdin → child_stdin_w
    let stdin_writer_w = child_stdin_w;
    let (stdin_done_tx, stdin_done_rx) = mpsc::channel::<()>();
    let stdin_thread = thread::spawn(move || {
        let mut buf = [0u8; 8192];
        let mut stdin_handle = io::stdin();
        loop {
            match stdin_handle.read(&mut buf) {
                Ok(0) => break, // EOF
                Ok(n) => {
                    let mut written = 0usize;
                    while written < n {
                        let mut bytes_written: u32 = 0;
                        let ok = unsafe {
                            windows_sys::Win32::Storage::FileSystem::WriteFile(
                                stdin_writer_w,
                                buf[written..].as_ptr(),
                                (n - written) as u32,
                                &mut bytes_written,
                                ptr::null_mut(),
                            )
                        };
                        if ok == 0 || bytes_written == 0 {
                            break;
                        }
                        written += bytes_written as usize;
                    }
                    if written < n {
                        break; // pipe broken
                    }
                }
                Err(_) => break,
            }
        }
        unsafe { CloseHandle(stdin_writer_w); }
        let _ = stdin_done_tx.send(());
    });

    // stdout: child_stdout_r → parent_stdout
    let stdout_reader_r = child_stdout_r;
    let stdout_thread = thread::spawn(move || {
        let mut buf = [0u8; 8192];
        let mut stdout_handle = io::stdout();
        loop {
            let mut read_bytes: u32 = 0;
            let ok = unsafe {
                windows_sys::Win32::Storage::FileSystem::ReadFile(
                    stdout_reader_r,
                    buf.as_mut_ptr(),
                    buf.len() as u32,
                    &mut read_bytes,
                    ptr::null_mut(),
                )
            };
            if ok == 0 || read_bytes == 0 {
                break;
            }
            if stdout_handle.write_all(&buf[..read_bytes as usize]).is_err() {
                break;
            }
            let _ = stdout_handle.flush();
        }
        unsafe { CloseHandle(stdout_reader_r); }
    });

    // stderr: child_stderr_r → parent_stderr
    let stderr_reader_r = child_stderr_r;
    let stderr_thread = thread::spawn(move || {
        let mut buf = [0u8; 8192];
        let mut stderr_handle = io::stderr();
        loop {
            let mut read_bytes: u32 = 0;
            let ok = unsafe {
                windows_sys::Win32::Storage::FileSystem::ReadFile(
                    stderr_reader_r,
                    buf.as_mut_ptr(),
                    buf.len() as u32,
                    &mut read_bytes,
                    ptr::null_mut(),
                )
            };
            if ok == 0 || read_bytes == 0 {
                break;
            }
            if stderr_handle.write_all(&buf[..read_bytes as usize]).is_err() {
                break;
            }
            let _ = stderr_handle.flush();
        }
        unsafe { CloseHandle(stderr_reader_r); }
    });

    // Wait for child process to exit
    unsafe { WaitForSingleObject(pi.hProcess, INFINITE) };

    let mut exit_code_u32: u32 = 1;
    unsafe { GetExitCodeProcess(pi.hProcess, &mut exit_code_u32); }

    // Close child process handles so stdout/stderr forwarding threads can unblock
    unsafe {
        close_handles(&[pi.hThread, pi.hProcess, ctx.h_token]);
    }

    // Wait for stdout/stderr threads to drain (they unblock when child pipe closes)
    let _ = stdout_thread.join();
    let _ = stderr_thread.join();

    // stdin thread may block on parent stdin — give it a short window then detach
    if stdin_done_rx.recv_timeout(Duration::from_secs(2)).is_err() {
        // stdin_thread is still blocking on parent stdin read; drop the receiver
        // and let it finish naturally when the process exits.
        drop(stdin_thread);
    }

    let exit_code = exit_code_u32 as i32;
    ctx.cleanup(exit_code);

    Ok(ProxyResult { exit_code })
}

// ============================================================================
// main
// ============================================================================

fn main() -> anyhow::Result<()> {
    let args = Args::parse();

    match args.subcommand {
        Subcommand::Run(run) => {
            let home = resolve_home(&run);
            let policy = resolve_policy(&run);
            let (cmd, cmd_args) = split_command(&run)?;

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
        Subcommand::Serve(serve) => {
            let home = resolve_home(&serve);
            let policy = resolve_policy(&serve);
            let (cmd, cmd_args) = split_command(&serve)?;

            let result = run_sandbox_proxy(
                &policy,
                &serve.cwd,
                &home,
                vec![cmd],
                &serve.cwd,
                cmd_args,
            )?;

            // Propagate child exit code; cleanup already done inside run_sandbox_proxy.
            std::process::exit(result.exit_code);
        }
    }

    Ok(())
}
