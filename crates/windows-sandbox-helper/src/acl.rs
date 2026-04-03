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
const DENY_ACCESS: i32 = 3;
const CONTAINER_INHERIT_ACE: u32 = 0x2;
const OBJECT_INHERIT_ACE: u32 = 0x1;

fn dacl_has_write_allow_for_sid(p_dacl: *mut ACL, psid: *mut c_void) -> bool {
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
    let count = info.AceCount as usize;
    for i in 0..count {
        let mut p_ace: *mut c_void = std::ptr::null_mut();
        if unsafe { GetAce(p_dacl as *const ACL, i as u32, &mut p_ace) } == 0 {
            continue;
        }
        let hdr = unsafe { &*(p_ace as *const ACE_HEADER) };
        if hdr.AceType != 0 {
            continue;
        }
        if (hdr.AceFlags & INHERIT_ONLY_ACE) != 0 {
            continue;
        }
        let ace = unsafe { &*(p_ace as *const ACCESS_ALLOWED_ACE) };
        let mask = ace.Mask;
        let base = p_ace as usize;
        let sid_ptr = (base + std::mem::size_of::<ACE_HEADER>() + std::mem::size_of::<u32>()) as *mut c_void;
        if unsafe { EqualSid(sid_ptr, psid) } != 0 && (mask & FILE_GENERIC_WRITE) != 0 {
            return true;
        }
    }
    false
}

fn dacl_has_write_deny_for_sid(p_dacl: *mut ACL, psid: *mut c_void) -> bool {
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
    let deny_write_mask =
        FILE_GENERIC_WRITE | FILE_WRITE_DATA | FILE_APPEND_DATA | FILE_WRITE_EA | FILE_WRITE_ATTRIBUTES | GENERIC_WRITE_MASK;
    for i in 0..info.AceCount {
        let mut p_ace: *mut c_void = std::ptr::null_mut();
        if unsafe { GetAce(p_dacl as *const ACL, i, &mut p_ace) } == 0 {
            continue;
        }
        let hdr = unsafe { &*(p_ace as *const ACE_HEADER) };
        if hdr.AceType != 1 {
            continue;
        }
        if (hdr.AceFlags & INHERIT_ONLY_ACE) != 0 {
            continue;
        }
        let ace = unsafe { &*(p_ace as *const ACCESS_ALLOWED_ACE) };
        let base = p_ace as usize;
        let sid_ptr = (base + std::mem::size_of::<ACE_HEADER>() + std::mem::size_of::<u32>()) as *mut c_void;
        if unsafe { EqualSid(sid_ptr, psid) } != 0 && (ace.Mask & deny_write_mask) != 0 {
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

fn get_dacl(path: &Path) -> Result<(*mut c_void, *mut ACL, *mut c_void)> {
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
    Ok((p_sd, p_dacl, std::ptr::null_mut()))
}

fn free_sd(p_sd: *mut c_void) {
    if !p_sd.is_null() {
        unsafe { LocalFree(p_sd as HLOCAL) };
    }
}

pub unsafe fn add_allow_ace(path: &Path, psid: *mut c_void) -> Result<bool> {
    let (p_sd, p_dacl, _p_sacl) = get_dacl(path)?;

    let mut added = false;
    if !dacl_has_write_allow_for_sid(p_dacl, psid) {
        let mut explicit: EXPLICIT_ACCESS_W = unsafe { std::mem::zeroed() };
        explicit.grfAccessPermissions =
            FILE_GENERIC_READ | FILE_GENERIC_WRITE | FILE_GENERIC_EXECUTE;
        explicit.grfAccessMode = 2;
        explicit.grfInheritance = CONTAINER_INHERIT_ACE | OBJECT_INHERIT_ACE;
        explicit.Trustee = trustee(psid);

        let mut p_new_dacl: *mut ACL = std::ptr::null_mut();
        let code2 = unsafe { SetEntriesInAclW(1, &explicit, p_dacl, &mut p_new_dacl) };
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
    }
    Ok(added)
}

pub unsafe fn add_deny_write_ace(path: &Path, psid: *mut c_void) -> Result<bool> {
    let (p_sd, p_dacl, _p_sacl) = get_dacl(path)?;

    let mut added = false;
    if !dacl_has_write_deny_for_sid(p_dacl, psid) {
        let mut explicit: EXPLICIT_ACCESS_W = unsafe { std::mem::zeroed() };
        explicit.grfAccessPermissions =
            FILE_GENERIC_WRITE | FILE_WRITE_DATA | FILE_APPEND_DATA | FILE_WRITE_EA
                | FILE_WRITE_ATTRIBUTES | GENERIC_WRITE_MASK;
        explicit.grfAccessMode = DENY_ACCESS;
        explicit.grfInheritance = CONTAINER_INHERIT_ACE | OBJECT_INHERIT_ACE;
        explicit.Trustee = trustee(psid);

        let mut p_new_dacl: *mut ACL = std::ptr::null_mut();
        let code2 = unsafe { SetEntriesInAclW(1, &explicit, p_dacl, &mut p_new_dacl) };
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
    }
    Ok(added)
}

pub unsafe fn revoke_ace(path: &Path, psid: *mut c_void) {
    let (p_sd, p_dacl, _p_sacl) = get_dacl(path).unwrap_or((std::ptr::null_mut(), std::ptr::null_mut(), std::ptr::null_mut()));

    let mut explicit: EXPLICIT_ACCESS_W = unsafe { std::mem::zeroed() };
    explicit.grfAccessPermissions = 0;
    explicit.grfAccessMode = 4;
    explicit.grfInheritance = CONTAINER_INHERIT_ACE | OBJECT_INHERIT_ACE;
    explicit.Trustee = trustee(psid);

    let mut p_new_dacl: *mut ACL = std::ptr::null_mut();
    let code2 = unsafe { SetEntriesInAclW(1, &explicit, p_dacl, &mut p_new_dacl) };
    if code2 == ERROR_SUCCESS as u32 {
        let _ = unsafe {
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
        if !p_new_dacl.is_null() {
            unsafe { LocalFree(p_new_dacl as HLOCAL) };
        }
    }
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
        explicit.grfAccessMode = 2;
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
