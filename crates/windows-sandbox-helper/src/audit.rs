//! Simplified world-writable directory audit.
//!
//! Unlike the macOS/Linux sandbox backends (which are declarative and need no audit),
//! Windows still benefits from a lightweight scan of CWD children to prevent sandbox
//! escape through world-writable paths. The aggressive global scan (PATH, C:\, Windows)
//! has been removed to match the simpler approach of macOS/Linux.

use crate::acl::add_deny_write_ace;
use crate::cap::{cap_sid_file, load_or_create_cap_sids};
use crate::logging::log_note;
use crate::policy::SandboxPolicy;
use crate::token::{convert_string_sid_to_sid, world_sid};
use crate::winutil::to_wide;
use anyhow::Result;
use std::collections::HashSet;
use std::ffi::c_void;
use std::path::Path;
use std::path::PathBuf;
use std::time::{Duration, Instant};
use windows_sys::Win32::Foundation::{
    CloseHandle, ERROR_SUCCESS, HLOCAL, INVALID_HANDLE_VALUE, LocalFree,
};
use windows_sys::Win32::Security::{
    EqualSid, GetAce, GetAclInformation, MapGenericMask,
    Authorization::{GetNamedSecurityInfoW, GetSecurityInfo},
    DACL_SECURITY_INFORMATION, ACL, GENERIC_MAPPING,
    ACCESS_ALLOWED_ACE, ACE_HEADER,
};
use windows_sys::Win32::Storage::FileSystem::{
    CreateFileW, FILE_ALL_ACCESS, FILE_APPEND_DATA, FILE_FLAG_BACKUP_SEMANTICS,
    FILE_GENERIC_EXECUTE, FILE_GENERIC_READ, FILE_GENERIC_WRITE,
    FILE_SHARE_DELETE, FILE_SHARE_READ, FILE_SHARE_WRITE,
    FILE_WRITE_ATTRIBUTES, FILE_WRITE_DATA, FILE_WRITE_EA, OPEN_EXISTING,
};

const MAX_CWD_CHILDREN: usize = 200;
const AUDIT_TIME_LIMIT_SECS: u64 = 1;

fn normalize_path_key(p: &Path) -> String {
    let n = dunce::canonicalize(p).unwrap_or_else(|_| p.to_path_buf());
    n.to_string_lossy().replace('\\', "/").to_ascii_lowercase()
}

/// Check if a path has a world-writable ALLOW ACE in its DACL.
unsafe fn path_has_world_write_allow(path: &Path) -> Result<bool> {
    let mut p_sd: *mut c_void = std::ptr::null_mut();
    let mut p_dacl: *mut ACL = std::ptr::null_mut();
    let wpath = to_wide(path);

    let h = CreateFileW(
        wpath.as_ptr(),
        0x00020000,
        FILE_SHARE_READ | FILE_SHARE_WRITE | FILE_SHARE_DELETE,
        std::ptr::null_mut(),
        OPEN_EXISTING,
        FILE_FLAG_BACKUP_SEMANTICS,
        0,
    );
    if h == INVALID_HANDLE_VALUE {
        let code = GetNamedSecurityInfoW(
            wpath.as_ptr(),
            1,
            DACL_SECURITY_INFORMATION,
            std::ptr::null_mut(),
            std::ptr::null_mut(),
            &mut p_dacl,
            std::ptr::null_mut(),
            &mut p_sd,
        );
        if code != ERROR_SUCCESS as u32 {
            if !p_sd.is_null() { LocalFree(p_sd as HLOCAL); }
            return Ok(false);
        }
    } else {
        let code = GetSecurityInfo(
            h,
            1,
            DACL_SECURITY_INFORMATION,
            std::ptr::null_mut(),
            std::ptr::null_mut(),
            &mut p_dacl,
            std::ptr::null_mut(),
            &mut p_sd,
        );
        CloseHandle(h);
        if code != ERROR_SUCCESS as u32 {
            if !p_sd.is_null() { LocalFree(p_sd as HLOCAL); }
            return Ok(false);
        }
    }

    let mut world = world_sid()?;
    let psid_world = world.as_mut_ptr() as *mut c_void;

    if p_dacl.is_null() {
        if !p_sd.is_null() { LocalFree(p_sd as HLOCAL); }
        return Ok(false);
    }

    let mut info: windows_sys::Win32::Security::ACL_SIZE_INFORMATION = std::mem::zeroed();
    let ok = GetAclInformation(
        p_dacl as *const ACL,
        &mut info as *mut _ as *mut c_void,
        std::mem::size_of::<windows_sys::Win32::Security::ACL_SIZE_INFORMATION>() as u32,
        4, // AclSizeInformation
    );
    let has_write = if ok != 0 {
        let mapping = GENERIC_MAPPING {
            GenericRead: FILE_GENERIC_READ,
            GenericWrite: FILE_GENERIC_WRITE,
            GenericExecute: FILE_GENERIC_EXECUTE,
            GenericAll: FILE_ALL_ACCESS,
        };
        let write_mask = FILE_WRITE_DATA | FILE_APPEND_DATA | FILE_WRITE_EA | FILE_WRITE_ATTRIBUTES;
        let mut found = false;
        for i in 0..(info.AceCount as usize) {
            let mut p_ace: *mut c_void = std::ptr::null_mut();
            if GetAce(p_dacl as *const ACL, i as u32, &mut p_ace) == 0 { continue; }
            let hdr = &*(p_ace as *const ACE_HEADER);
            if hdr.AceType != 0 || (hdr.AceFlags & 0x08) != 0 { continue; }
            let base = p_ace as usize;
            let sid_ptr = (base + std::mem::size_of::<ACE_HEADER>() + std::mem::size_of::<u32>()) as *mut c_void;
            if EqualSid(sid_ptr, psid_world) == 0 { continue; }
            let ace = &*(p_ace as *const ACCESS_ALLOWED_ACE);
            let mut mask = ace.Mask;
            MapGenericMask(&mut mask, &mapping);
            if (mask & write_mask) != 0 { found = true; break; }
        }
        found
    } else { false };

    if !p_sd.is_null() { LocalFree(p_sd as HLOCAL); }
    Ok(has_write)
}

/// Audit only CWD direct children for world-writable directories.
fn audit_cwd_children(cwd: &Path, logs_base_dir: Option<&Path>) -> Result<Vec<PathBuf>> {
    let start = Instant::now();
    let mut flagged: Vec<PathBuf> = Vec::new();
    let mut seen: HashSet<String> = HashSet::new();

    if let Ok(read) = std::fs::read_dir(cwd) {
        for ent in read.flatten().take(MAX_CWD_CHILDREN) {
            if start.elapsed() > Duration::from_secs(AUDIT_TIME_LIMIT_SECS) {
                break;
            }
            let ft = match ent.file_type() {
                Ok(ft) => ft,
                Err(_) => continue,
            };
            if ft.is_symlink() || !ft.is_dir() {
                continue;
            }
            let p = ent.path();
            if unsafe { path_has_world_write_allow(&p)? } {
                let key = normalize_path_key(&p);
                if seen.insert(key) {
                    flagged.push(p);
                }
            }
        }
    }

    let elapsed_ms = start.elapsed().as_millis();
    if !flagged.is_empty() {
        let mut list = String::new();
        for p in &flagged {
            list.push_str(&format!("\n - {}", p.display()));
        }
        log_note(
            &format!("AUDIT: world-writable scan found; cwd={cwd:?}; duration_ms={elapsed_ms}; flagged:{list}"),
            logs_base_dir,
        );
    } else {
        log_note(
            &format!("AUDIT: world-writable scan OK; duration_ms={elapsed_ms}"),
            logs_base_dir,
        );
    }

    Ok(flagged)
}

pub fn apply_world_writable_scan_and_denies(
    home: &Path,
    cwd: &Path,
    _env_map: &std::collections::HashMap<String, String>,
    sandbox_policy: &SandboxPolicy,
    logs_base_dir: Option<&Path>,
) -> Result<()> {
    let flagged = audit_cwd_children(cwd, logs_base_dir)?;
    if flagged.is_empty() {
        return Ok(());
    }

    if let Err(err) = apply_capability_denies_for_world_writable(
        home, &flagged, sandbox_policy, cwd, logs_base_dir,
    ) {
        log_note(
            &format!("AUDIT: failed to apply capability deny ACEs: {}", err),
            logs_base_dir,
        );
    }

    Ok(())
}

fn apply_capability_denies_for_world_writable(
    home: &Path,
    flagged: &[PathBuf],
    sandbox_policy: &SandboxPolicy,
    cwd: &Path,
    logs_base_dir: Option<&Path>,
) -> Result<()> {
    if flagged.is_empty() {
        return Ok(());
    }
    std::fs::create_dir_all(home)?;
    let cap_path = cap_sid_file(home);
    let caps = load_or_create_cap_sids(home);
    std::fs::write(&cap_path, serde_json::to_string(&caps)?)?;

    let (active_sid, workspace_roots): (*mut c_void, Vec<PathBuf>) = match sandbox_policy {
        SandboxPolicy::WorkspaceWrite { writable_roots, .. } => {
            let sid = unsafe { convert_string_sid_to_sid(&caps.workspace) }
                .ok_or_else(|| anyhow::anyhow!("ConvertStringSidToSidW failed for workspace capability"))?;
            let mut roots: Vec<PathBuf> = vec![dunce::canonicalize(cwd).unwrap_or_else(|_| cwd.to_path_buf())];
            for root in writable_roots {
                let candidate = if root.is_absolute() {
                    root.clone()
                } else {
                    cwd.join(root)
                };
                roots.push(dunce::canonicalize(&candidate).unwrap_or(candidate));
            }
            (sid, roots)
        }
        SandboxPolicy::ReadOnly => (
            unsafe { convert_string_sid_to_sid(&caps.readonly) }.ok_or_else(|| {
                anyhow::anyhow!("ConvertStringSidToSidW failed for readonly capability")
            })?,
            Vec::new(),
        ),
    };

    for path in flagged {
        if workspace_roots.iter().any(|root| path.starts_with(root)) {
            continue;
        }
        let res = unsafe { add_deny_write_ace(path, active_sid) };
        match res {
            Ok(true) => log_note(
                &format!("AUDIT: applied capability deny ACE to {}", path.display()),
                logs_base_dir,
            ),
            Ok(false) => {}
            Err(err) => log_note(
                &format!("AUDIT: failed to apply capability deny ACE to {}: {}", path.display(), err),
                logs_base_dir,
            ),
        }
    }

    Ok(())
}
