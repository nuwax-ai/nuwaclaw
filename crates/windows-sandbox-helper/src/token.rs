//! Windows Restricted Token creation.

use crate::policy::SandboxPolicy;
use crate::winutil::to_wide;
use anyhow::Result;
use std::ffi::c_void;
use windows_sys::Win32::Foundation::{CloseHandle, GetLastError, HANDLE, LUID};
use windows_sys::Win32::Security::{
    AdjustTokenPrivileges, CopySid, CreateRestrictedToken, CreateWellKnownSid,
    GetLengthSid, GetTokenInformation, LookupPrivilegeValueW, TokenGroups, SID_AND_ATTRIBUTES,
    TOKEN_ADJUST_DEFAULT, TOKEN_ADJUST_PRIVILEGES, TOKEN_ADJUST_SESSIONID, TOKEN_ASSIGN_PRIMARY,
    TOKEN_DUPLICATE, TOKEN_PRIVILEGES, TOKEN_QUERY,
};
use windows_sys::Win32::System::Threading::GetCurrentProcess;

const DISABLE_MAX_PRIVILEGE: u32 = 0x01;
const LUA_TOKEN: u32 = 0x04;
const WRITE_RESTRICTED: u32 = 0x08;
const WIN_WORLD_SID: i32 = 1;
const SE_GROUP_LOGON_ID: u32 = 0xC0000000;

pub unsafe fn world_sid() -> Result<Vec<u8>> {
    let mut size: u32 = 0;
    CreateWellKnownSid(WIN_WORLD_SID, std::ptr::null_mut(), std::ptr::null_mut(), &mut size);
    let mut buf: Vec<u8> = vec![0u8; size as usize];
    let ok = CreateWellKnownSid(WIN_WORLD_SID, std::ptr::null_mut(), buf.as_mut_ptr() as *mut c_void, &mut size);
    if ok == 0 {
        return Err(anyhow::anyhow!("CreateWellKnownSid failed: {}", GetLastError()));
    }
    Ok(buf)
}

pub unsafe fn convert_string_sid_to_sid(s: &str) -> Option<*mut c_void> {
    #[link(name = "advapi32")]
    extern "system" {
        fn ConvertStringSidToSidW(StringSid: *const u16, Sid: *mut *mut c_void) -> i32;
    }
    let mut psid: *mut c_void = std::ptr::null_mut();
    let ok = unsafe { ConvertStringSidToSidW(to_wide(s).as_ptr(), &mut psid) };
    if ok != 0 {
        Some(psid)
    } else {
        None
    }
}

pub unsafe fn get_current_token_for_restriction() -> Result<HANDLE> {
    let desired = TOKEN_DUPLICATE
        | TOKEN_QUERY
        | TOKEN_ASSIGN_PRIMARY
        | TOKEN_ADJUST_DEFAULT
        | TOKEN_ADJUST_SESSIONID
        | TOKEN_ADJUST_PRIVILEGES;
    let mut h: HANDLE = 0;
    #[link(name = "advapi32")]
    extern "system" {
        fn OpenProcessToken(ProcessHandle: HANDLE, DesiredAccess: u32, TokenHandle: *mut HANDLE) -> i32;
    }
    let ok = unsafe { OpenProcessToken(GetCurrentProcess(), desired, &mut h) };
    if ok == 0 {
        return Err(anyhow::anyhow!("OpenProcessToken failed: {}", GetLastError()));
    }
    Ok(h)
}

pub unsafe fn get_logon_sid_bytes(h_token: HANDLE) -> Result<Vec<u8>> {
    unsafe fn scan_token_groups_for_logon(h: HANDLE) -> Option<Vec<u8>> {
        let mut needed: u32 = 0;
        GetTokenInformation(h, TokenGroups, std::ptr::null_mut(), 0, &mut needed);
        if needed == 0 {
            return None;
        }
        let mut buf: Vec<u8> = vec![0u8; needed as usize];
        let ok = GetTokenInformation(
            h, TokenGroups, buf.as_mut_ptr() as *mut c_void, needed, &mut needed,
        );
        if ok == 0 || (needed as usize) < std::mem::size_of::<u32>() {
            return None;
        }
        let group_count = std::ptr::read_unaligned(buf.as_ptr() as *const u32) as usize;
        let after_count =
            unsafe { buf.as_ptr().add(std::mem::size_of::<u32>()) } as usize;
        let align = std::mem::align_of::<SID_AND_ATTRIBUTES>();
        let aligned = (after_count + (align - 1)) & !(align - 1);
        let groups_ptr = aligned as *const SID_AND_ATTRIBUTES;
        for i in 0..group_count {
            let entry: SID_AND_ATTRIBUTES = unsafe { std::ptr::read_unaligned(groups_ptr.add(i)) };
            if (entry.Attributes & SE_GROUP_LOGON_ID) == SE_GROUP_LOGON_ID {
                let sid = entry.Sid;
                let sid_len = unsafe { GetLengthSid(sid) };
                if sid_len == 0 {
                    return None;
                }
                let mut out = vec![0u8; sid_len as usize];
                if unsafe { CopySid(sid_len, out.as_mut_ptr() as *mut c_void, sid) } == 0 {
                    return None;
                }
                return Some(out);
            }
        }
        None
    }

    if let Some(v) = unsafe { scan_token_groups_for_logon(h_token) } {
        return Ok(v);
    }

    #[repr(C)]
    struct TOKEN_LINKED_TOKEN {
        linked_token: HANDLE,
    }
    const TOKEN_LINKED_TOKEN_CLASS: i32 = 19;
    let mut ln_needed: u32 = 0;
    unsafe {
        GetTokenInformation(
            h_token,
            TOKEN_LINKED_TOKEN_CLASS,
            std::ptr::null_mut(),
            0,
            &mut ln_needed,
        )
    };
    if ln_needed >= std::mem::size_of::<TOKEN_LINKED_TOKEN>() as u32 {
        let mut ln_buf: Vec<u8> = vec![0u8; ln_needed as usize];
        let ok = unsafe {
            GetTokenInformation(
                h_token,
                TOKEN_LINKED_TOKEN_CLASS,
                ln_buf.as_mut_ptr() as *mut c_void,
                ln_needed,
                &mut ln_needed,
            )
        };
        if ok != 0 {
            let lt: TOKEN_LINKED_TOKEN = unsafe { std::ptr::read_unaligned(ln_buf.as_ptr() as *const TOKEN_LINKED_TOKEN) };
            if lt.linked_token != 0 {
                let res = unsafe { scan_token_groups_for_logon(lt.linked_token) };
                unsafe { CloseHandle(lt.linked_token) };
                if let Some(v) = res {
                    return Ok(v);
                }
            }
        }
    }

    Err(anyhow::anyhow!("Logon SID not present on token"))
}

unsafe fn enable_single_privilege(h_token: HANDLE, name: &str) -> Result<()> {
    let mut luid = LUID { LowPart: 0, HighPart: 0 };
    let ok = unsafe { LookupPrivilegeValueW(std::ptr::null(), to_wide(name).as_ptr(), &mut luid) };
    if ok == 0 {
        return Err(anyhow::anyhow!("LookupPrivilegeValueW failed: {}", GetLastError()));
    }
    let mut tp: TOKEN_PRIVILEGES = unsafe { std::mem::zeroed() };
    tp.PrivilegeCount = 1;
    tp.Privileges[0].Luid = luid;
    tp.Privileges[0].Attributes = 0x00000002;
    let ok2 = unsafe {
        AdjustTokenPrivileges(h_token, 0, &tp, 0, std::ptr::null_mut(), std::ptr::null_mut())
    };
    if ok2 == 0 {
        return Err(anyhow::anyhow!("AdjustTokenPrivileges failed: {}", GetLastError()));
    }
    let err = unsafe { GetLastError() };
    if err != 0 {
        return Err(anyhow::anyhow!("AdjustTokenPrivileges error {}", err));
    }
    Ok(())
}

/// 为 serve 模式创建令牌：不含 WRITE_RESTRICTED，允许子进程继续 spawn 孙进程。
/// 文件系统写保护降为 ACL 级单层（DACL ACE），不再有令牌级写限制。
/// 用途：ACP 引擎进程级沙箱包装（需要 spawn claude-code / MCP 服务器等子进程）。
///
/// 不传受限 SID 列表：serve 模式下不需要双重访问检查，特权裁剪由 DISABLE_MAX_PRIVILEGE
/// + LUA_TOKEN 完成，文件系统限制由 DACL ACE 提供。
pub unsafe fn create_servable_token_with_cap(
    psid_capability: *mut c_void,
) -> Result<(HANDLE, *mut c_void)> {
    let base = get_current_token_for_restriction()?;

    let mut new_token: HANDLE = 0;
    // 去掉 WRITE_RESTRICTED：子进程可以通过 CreateProcess 继续 spawn 孙进程。
    // 不传受限 SID 列表（第 7-9 参数均为 0/null），避免双重访问检查阻塞子进程 spawn。
    let flags = DISABLE_MAX_PRIVILEGE | LUA_TOKEN;
    let ok = CreateRestrictedToken(
        base, flags, 0, std::ptr::null(), 0, std::ptr::null(), 0,
        std::ptr::null_mut(), &mut new_token,
    );
    CloseHandle(base); // base 使命完成，无论成败都要关闭
    if ok == 0 {
        return Err(anyhow::anyhow!("CreateRestrictedToken failed: {}", GetLastError()));
    }
    enable_single_privilege(new_token, "SeChangeNotifyPrivilege")
        .map_err(|e| { CloseHandle(new_token); e })?;
    Ok((new_token, psid_capability))
}

pub unsafe fn create_workspace_write_token_with_cap(
    psid_capability: *mut c_void,
) -> Result<(HANDLE, *mut c_void)> {
    let base = get_current_token_for_restriction()?;
    let mut logon_sid_bytes = get_logon_sid_bytes(base)
        .map_err(|e| { CloseHandle(base); e })?;
    let psid_logon = logon_sid_bytes.as_mut_ptr() as *mut c_void;
    let mut everyone = world_sid()?;
    let psid_everyone = everyone.as_mut_ptr() as *mut c_void;

    let mut entries: [SID_AND_ATTRIBUTES; 3] = unsafe { std::mem::zeroed() };
    entries[0].Sid = psid_capability;
    entries[0].Attributes = 0;
    entries[1].Sid = psid_logon;
    entries[1].Attributes = 0;
    entries[2].Sid = psid_everyone;
    entries[2].Attributes = 0;

    let mut new_token: HANDLE = 0;
    let flags = DISABLE_MAX_PRIVILEGE | LUA_TOKEN | WRITE_RESTRICTED;
    let ok = CreateRestrictedToken(
        base, flags, 0, std::ptr::null(), 0, std::ptr::null(), 3,
        entries.as_mut_ptr(), &mut new_token,
    );
    CloseHandle(base);
    if ok == 0 {
        return Err(anyhow::anyhow!("CreateRestrictedToken failed: {}", GetLastError()));
    }
    enable_single_privilege(new_token, "SeChangeNotifyPrivilege")
        .map_err(|e| { CloseHandle(new_token); e })?;
    Ok((new_token, psid_capability))
}

pub unsafe fn create_readonly_token_with_cap(
    psid_capability: *mut c_void,
) -> Result<(HANDLE, *mut c_void)> {
    let base = get_current_token_for_restriction()?;
    let mut logon_sid_bytes = get_logon_sid_bytes(base)
        .map_err(|e| { CloseHandle(base); e })?;
    let psid_logon = logon_sid_bytes.as_mut_ptr() as *mut c_void;
    let mut everyone = world_sid()?;
    let psid_everyone = everyone.as_mut_ptr() as *mut c_void;

    let mut entries: [SID_AND_ATTRIBUTES; 3] = unsafe { std::mem::zeroed() };
    entries[0].Sid = psid_capability;
    entries[0].Attributes = 0;
    entries[1].Sid = psid_logon;
    entries[1].Attributes = 0;
    entries[2].Sid = psid_everyone;
    entries[2].Attributes = 0;

    let mut new_token: HANDLE = 0;
    let flags = DISABLE_MAX_PRIVILEGE | LUA_TOKEN | WRITE_RESTRICTED;
    let ok = CreateRestrictedToken(
        base, flags, 0, std::ptr::null(), 0, std::ptr::null(), 3,
        entries.as_mut_ptr(), &mut new_token,
    );
    CloseHandle(base);
    if ok == 0 {
        return Err(anyhow::anyhow!("CreateRestrictedToken failed: {}", GetLastError()));
    }
    enable_single_privilege(new_token, "SeChangeNotifyPrivilege")
        .map_err(|e| { CloseHandle(new_token); e })?;
    Ok((new_token, psid_capability))
}
