//! DACL manipulation (add/deny ACEs).

use crate::winutil::to_wide;
use anyhow::Result;
use std::ffi::c_void;
use std::path::Path;
use windows_sys::Win32::Foundation::{
    CloseHandle, LocalFree, ERROR_SUCCESS, HLOCAL, INVALID_HANDLE_VALUE,
};
use windows_sys::Win32::Security::{
    AclSizeInformation, EqualSid, GetAce, GetAclInformation,
    Authorization::{
        GetNamedSecurityInfoW, GetSecurityInfo, SetEntriesInAclW, SetNamedSecurityInfoW,
        SetSecurityInfo, EXPLICIT_ACCESS_W, TRUSTEE_IS_SID, TRUSTEE_IS_UNKNOWN, TRUSTEE_W,
    },
    ACL, ACL_SIZE_INFORMATION, ACCESS_ALLOWED_ACE, ACE_HEADER, DACL_SECURITY_INFORMATION,
};
use windows_sys::Win32::Storage::FileSystem::{
    CreateFileW, FILE_ATTRIBUTE_NORMAL, FILE_GENERIC_EXECUTE, FILE_GENERIC_READ,
    FILE_GENERIC_WRITE, FILE_APPEND_DATA, FILE_WRITE_ATTRIBUTES, FILE_WRITE_DATA,
    FILE_WRITE_EA, FILE_SHARE_READ, FILE_SHARE_WRITE, OPEN_EXISTING,
};

const SE_KERNEL_OBJECT: u32 = 6;
const INHERIT_ONLY_ACE: u8 = 0x08;
const GENERIC_WRITE_MASK: u32 = 0x4000_0000;
const CONTAINER_INHERIT_ACE: u32 = 0x2;
const OBJECT_INHERIT_ACE: u32 = 0x1;

// ACE access modes
const GRANT_ACCESS: i32 = 2;
const DENY_ACCESS: i32 = 3;
const REVOKE_ACCESS: i32 = 4;

const DENY_WRITE_MASK: u32 = FILE_GENERIC_WRITE | FILE_WRITE_DATA | FILE_APPEND_DATA
    | FILE_WRITE_EA | FILE_WRITE_ATTRIBUTES | GENERIC_WRITE_MASK;

/// Check if a DACL contains an ACE of the given type matching the SID with the specified mask.
fn dacl_has_ace_for_sid(
    p_dacl: *mut ACL,
    psid: *mut c_void,
    ace_type: u8, // 0 = ACCESS_ALLOWED, 1 = ACCESS_DENIED
    mask_check: u32,
) -> bool {
    if p_dacl.is_null() {
        return false;
    }
    let mut info: ACL_SIZE_INFORMATION = unsafe { std::mem::zeroed() };
    let ok = unsafe {
        GetAclInformation(
            p_dacl as *const ACL,
            &mut info as *mut _ as *mut c_void,
            std::mem::size_of::<ACL_SIZE_INFORMATION>() as u32,
            AclSizeInformation,
        )
    };
    if ok == 0 {
        return false;
    }
    for i in 0..info.AceCount {
        let mut p_ace: *mut c_void = std::ptr::null_mut();
        if unsafe { GetAce(p_dacl as *const ACL, i, &mut p_ace) } == 0 {
            continue;
        }
        let hdr = unsafe { &*(p_ace as *const ACE_HEADER) };
        if hdr.AceType != ace_type {
            continue;
        }
        if (hdr.AceFlags & INHERIT_ONLY_ACE) != 0 {
            continue;
        }
        let ace = unsafe { &*(p_ace as *const ACCESS_ALLOWED_ACE) };
        let base = p_ace as usize;
        let sid_ptr = (base + std::mem::size_of::<ACE_HEADER>() + std::mem::size_of::<u32>()) as *mut c_void;
        if unsafe { EqualSid(sid_ptr, psid) } != 0 && (ace.Mask & mask_check) != 0 {
            return true;
        }
    }
    false
}

fn trustee(psid: *mut c_void) -> TRUSTEE_W {
    TRUSTEE_W {
        pMultipleTrustee: std::ptr::null_mut(),
        MultipleTrusteeOperation: 0,
        TrusteeForm: TRUSTEE_IS_SID,
        TrusteeType: TRUSTEE_IS_UNKNOWN,
        ptstrName: psid as *mut u16,
    }
}

fn get_dacl(path: &Path) -> Result<(*mut c_void, *mut ACL)> {
    let mut p_sd: *mut c_void = std::ptr::null_mut();
    let mut p_dacl: *mut ACL = std::ptr::null_mut();
    let code = unsafe {
        GetNamedSecurityInfoW(
            to_wide(path).as_ptr(),
            1,
            DACL_SECURITY_INFORMATION,
            std::ptr::null_mut(),
            std::ptr::null_mut(),
            &mut p_dacl,
            std::ptr::null_mut(),
            &mut p_sd,
        )
    };
    if code != ERROR_SUCCESS as u32 {
        return Err(anyhow::anyhow!("GetNamedSecurityInfoW failed: {}", code));
    }
    Ok((p_sd, p_dacl))
}

fn free_sd(p_sd: *mut c_void) {
    if !p_sd.is_null() {
        unsafe { LocalFree(p_sd as HLOCAL) };
    }
}

/// Internal: apply an EXPLICIT_ACCESS_W entry to a path's DACL.
unsafe fn set_ace_on_path(
    path: &Path,
    psid: *mut c_void,
    access_mode: i32,
    permissions: u32,
    skip_if_present: Option<(u8, u32)>, // (ace_type, mask) to check before adding
) -> Result<bool> {
    let (p_sd, p_dacl) = get_dacl(path)?;

    if let Some((ace_type, mask)) = skip_if_present {
        if dacl_has_ace_for_sid(p_dacl, psid, ace_type, mask) {
            free_sd(p_sd);
            return Ok(false);
        }
    }

    let mut explicit: EXPLICIT_ACCESS_W = std::mem::zeroed();
    explicit.grfAccessPermissions = permissions;
    explicit.grfAccessMode = access_mode;
    explicit.grfInheritance = CONTAINER_INHERIT_ACE | OBJECT_INHERIT_ACE;
    explicit.Trustee = trustee(psid);

    let mut p_new_dacl: *mut ACL = std::ptr::null_mut();
    let code2 = unsafe { SetEntriesInAclW(1, &explicit, p_dacl, &mut p_new_dacl) };
    let mut added = false;
    if code2 == ERROR_SUCCESS as u32 {
        let code3 = unsafe {
            SetNamedSecurityInfoW(
                to_wide(path).as_ptr() as *mut u16,
                1,
                DACL_SECURITY_INFORMATION,
                std::ptr::null_mut(),
                std::ptr::null_mut(),
                p_new_dacl,
                std::ptr::null_mut(),
            )
        };
        if code3 == ERROR_SUCCESS as u32 {
            added = true;
        }
        if !p_new_dacl.is_null() {
            unsafe { LocalFree(p_new_dacl as HLOCAL) };
        }
    }
    free_sd(p_sd);
    Ok(added)
}

pub unsafe fn add_allow_ace(path: &Path, psid: *mut c_void) -> Result<bool> {
    set_ace_on_path(
        path,
        psid,
        GRANT_ACCESS,
        FILE_GENERIC_READ | FILE_GENERIC_WRITE | FILE_GENERIC_EXECUTE,
        Some((0, FILE_GENERIC_WRITE)), // skip if ALLOW ACE with write exists
    )
}

pub unsafe fn add_deny_write_ace(path: &Path, psid: *mut c_void) -> Result<bool> {
    set_ace_on_path(
        path,
        psid,
        DENY_ACCESS,
        DENY_WRITE_MASK,
        Some((1, DENY_WRITE_MASK)), // skip if DENY ACE with write mask exists
    )
}

pub unsafe fn revoke_ace(path: &Path, psid: *mut c_void) {
    let _ = set_ace_on_path(
        path,
        psid,
        REVOKE_ACCESS,
        0,
        None, // always revoke
    );
}

pub unsafe fn allow_null_device(psid: *mut c_void) {
    let desired = 0x00020000 | 0x00040000;
    let h = unsafe {
        CreateFileW(
            to_wide(r"\\.\NUL").as_ptr(),
            desired,
            FILE_SHARE_READ | FILE_SHARE_WRITE,
            std::ptr::null_mut(),
            OPEN_EXISTING,
            FILE_ATTRIBUTE_NORMAL,
            0,
        )
    };
    if h == 0 || h == INVALID_HANDLE_VALUE {
        return;
    }

    let mut p_sd: *mut c_void = std::ptr::null_mut();
    let mut p_dacl: *mut ACL = std::ptr::null_mut();
    let code = unsafe {
        GetSecurityInfo(
            h,
            SE_KERNEL_OBJECT as i32,
            DACL_SECURITY_INFORMATION,
            std::ptr::null_mut(),
            std::ptr::null_mut(),
            &mut p_dacl,
            std::ptr::null_mut(),
            &mut p_sd,
        )
    };
    if code == ERROR_SUCCESS as u32 {
        let mut explicit: EXPLICIT_ACCESS_W = unsafe { std::mem::zeroed() };
        explicit.grfAccessPermissions = FILE_GENERIC_READ | FILE_GENERIC_WRITE | FILE_GENERIC_EXECUTE;
        explicit.grfAccessMode = GRANT_ACCESS;
        explicit.grfInheritance = 0;
        explicit.Trustee = trustee(psid);

        let mut p_new_dacl: *mut ACL = std::ptr::null_mut();
        let code2 = unsafe { SetEntriesInAclW(1, &explicit, p_dacl, &mut p_new_dacl) };
        if code2 == ERROR_SUCCESS as u32 {
            let _ = unsafe {
                SetSecurityInfo(
                    h,
                    SE_KERNEL_OBJECT as i32,
                    DACL_SECURITY_INFORMATION,
                    std::ptr::null_mut(),
                    std::ptr::null_mut(),
                    p_new_dacl,
                    std::ptr::null_mut(),
                )
            };
            if !p_new_dacl.is_null() {
                unsafe { LocalFree(p_new_dacl as HLOCAL) };
            }
        }
    }
    if !p_sd.is_null() {
        unsafe { LocalFree(p_sd as HLOCAL) };
    }
    unsafe { CloseHandle(h) };
}
