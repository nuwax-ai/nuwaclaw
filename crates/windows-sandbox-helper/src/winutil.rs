//! Win32 utility functions.

use std::ffi::OsStr;
#[cfg(target_os = "windows")]
use std::os::windows::ffi::OsStrExt;
use windows_sys::Win32::Foundation::{LocalFree, HLOCAL};
use windows_sys::Win32::System::Diagnostics::Debug::{
    FormatMessageW, FORMAT_MESSAGE_ALLOCATE_BUFFER, FORMAT_MESSAGE_FROM_SYSTEM,
    FORMAT_MESSAGE_IGNORE_INSERTS,
};

/// Convert an OsStr to a null-terminated wide string (LPWSTR).
#[cfg(target_os = "windows")]
pub fn to_wide<S: AsRef<OsStr>>(s: S) -> Vec<u16> {
    let mut v: Vec<u16> = s.as_ref().encode_wide().collect();
    v.push(0);
    v
}

/// Produce a readable description for a Win32 error code.
#[cfg(target_os = "windows")]
pub fn format_last_error(err: i32) -> String {
    unsafe {
        let mut buf_ptr: *mut u16 = std::ptr::null_mut();
        let flags = FORMAT_MESSAGE_ALLOCATE_BUFFER
            | FORMAT_MESSAGE_FROM_SYSTEM
            | FORMAT_MESSAGE_IGNORE_INSERTS;
        let len = FormatMessageW(
            flags,
            std::ptr::null(),
            err as u32,
            0,
            (&mut buf_ptr as *mut *mut u16) as *mut u16,
            0,
            std::ptr::null_mut(),
        );
        if len == 0 || buf_ptr.is_null() {
            return format!("Win32 error {}", err);
        }
        let slice = std::slice::from_raw_parts(buf_ptr, len as usize);
        let mut s = String::from_utf16_lossy(slice);
        s = s.trim().to_string();
        let _ = LocalFree(buf_ptr as HLOCAL);
        s
    }
}
