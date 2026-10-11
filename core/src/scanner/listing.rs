//! One directory listing, shared by the parallel walk and the live root scan.

use super::*;

pub(super) fn list(ctx: &Ctx<'_>, task: DirTask) -> (DirRec, Vec<DirTask>) {
    let mut dir_flags = task.flags;
    let mut files = Vec::new();
    let mut dirs = Vec::new();
    if dir_flags & flags::CLOUD == 0 && !ctx.cancel.load(Ordering::Relaxed) {
        match fs::read_dir(&task.path) {
            Ok(entries) => {
                for entry in entries {
                    if ctx.cancel.load(Ordering::Relaxed) {
                        break;
                    }
                    let Ok(entry) = entry else {
                        dir_flags |= flags::ACCESS_ERROR;
                        continue;
                    };
                    let Ok(file_type) = entry.file_type() else {
                        dir_flags |= flags::ACCESS_ERROR;
                        continue;
                    };
                    if file_type.is_symlink() {
                        continue;
                    }
                    let meta = match entry.metadata() {
                        Ok(meta) => meta,
                        Err(e) if e.kind() == io::ErrorKind::NotFound => continue,
                        Err(_) => {
                            dir_flags |= flags::ACCESS_ERROR;
                            continue;
                        }
                    };
                    if file_type.is_dir() {
                        let path = entry.path();
                        if !ctx.volume.allows_dir(&path, &meta) {
                            continue;
                        }
                        dirs.push(DirTask {
                            path,
                            id: ctx.next_id.fetch_add(1, Ordering::Relaxed),
                            parent: task.id,
                            name: entry.file_name(),
                            mtime: mtime_of(&meta),
                            flags: flags::IS_DIR | platform::dir_flags(&meta),
                        });
                    } else {
                        let size = ctx.volume.disk_size(&meta, || entry.path());
                        ctx.progress.files.fetch_add(1, Ordering::Relaxed);
                        ctx.progress.bytes.fetch_add(size, Ordering::Relaxed);
                        files.push(FileRec {
                            name: entry.file_name(),
                            size,
                            len: meta.len(),
                            mtime: mtime_of(&meta),
                            flags: 0,
                            ino: platform::hardlink_key(&meta),
                        });
                    }
                }
            }
            Err(_) => dir_flags |= flags::ACCESS_ERROR,
        }
    }
    ctx.progress.dirs.fetch_add(1, Ordering::Relaxed);
    if let Ok(mut current) = ctx.progress.current.try_lock() {
        *current = task.path.display().to_string();
    }
    (
        DirRec {
            id: task.id,
            parent: task.parent,
            name: task.name,
            mtime: task.mtime,
            flags: dir_flags,
            files,
        },
        dirs,
    )
}
