//! Opening a file to hash it, and who the open file is.

use std::fs::{File, OpenOptions};
use std::io;
use std::os::windows::fs::OpenOptionsExt;
use std::os::windows::io::AsRawHandle;
use std::path::Path;

use windows_sys::Win32::Foundation::HANDLE;
use windows_sys::Win32::Storage::FileSystem::{
    BY_HANDLE_FILE_INFORMATION, FILE_FLAG_SEQUENTIAL_SCAN, FILE_ID_INFO, FILE_SHARE_DELETE,
    FILE_SHARE_READ, FILE_SHARE_WRITE, FileIdInfo, GetFileInformationByHandle,
    GetFileInformationByHandleEx,
};

use crate::platform::{FileId, Identity};

/// Opens `path` for reading without keeping others from writing, renaming or deleting it.
pub fn open_for_hash(path: &Path) -> io::Result<File> {
    OpenOptions::new()
        .read(true)
        .share_mode(FILE_SHARE_READ | FILE_SHARE_WRITE | FILE_SHARE_DELETE)
        .custom_flags(FILE_FLAG_SEQUENTIAL_SCAN)
        .open(path)
}

/// The 128-bit id and the volume serial number of `file`, and its number of links.
pub fn identity(file: &File) -> Identity {
    let handle = file.as_raw_handle() as HANDLE;
    let mut info = FILE_ID_INFO::default();
    // SAFETY: `handle` is open for as long as `file` lives; `info` is a valid out-buffer of
    // the size passed.
    let read = unsafe {
        GetFileInformationByHandleEx(
            handle,
            FileIdInfo,
            (&raw mut info).cast(),
            size_of::<FILE_ID_INFO>() as u32,
        )
    };
    let id = (read != 0)
        .then(|| {
            let file = u128::from_le_bytes(info.FileId.Identifier);
            FileId::new(info.VolumeSerialNumber, file)
        })
        .flatten();
    let mut links = BY_HANDLE_FILE_INFORMATION::default();
    // SAFETY: as above; `links` is a valid out-pointer.
    let nlink = if unsafe { GetFileInformationByHandle(handle, &mut links) } != 0 {
        u64::from(links.nNumberOfLinks)
    } else {
        u64::MAX
    };
    Identity { id, nlink }
}
