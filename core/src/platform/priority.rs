//! Background priority for the threads that read files in bulk.

/// Lowers the calling thread to background priority for the rest of its life, so a long read
/// leaves the computer responsive. A failure is ignored: the work just runs at normal priority.
pub(crate) fn lower_this_thread() {
    #[cfg(windows)]
    // SAFETY: the pseudo-handle of the calling thread is always valid. The mode ends with the
    // thread, which is not reused: the readers are scoped threads.
    unsafe {
        use windows_sys::Win32::System::Threading::{
            GetCurrentThread, SetThreadPriority, THREAD_MODE_BACKGROUND_BEGIN,
        };
        SetThreadPriority(GetCurrentThread(), THREAD_MODE_BACKGROUND_BEGIN);
    }
    #[cfg(target_os = "linux")]
    // SAFETY: plain system calls; nice is per thread on Linux, so `gettid` lowers only this one.
    unsafe {
        let tid = libc::syscall(libc::SYS_gettid) as libc::id_t;
        libc::setpriority(libc::PRIO_PROCESS, tid, 10);
    }
    #[cfg(target_os = "macos")]
    // SAFETY: only sets the quality of service of the calling thread.
    unsafe {
        libc::pthread_set_qos_class_self_np(libc::qos_class_t::QOS_CLASS_UTILITY, 0);
    }
    // ponytail: other Unixes keep the normal priority, add their own call if one needs it.
}

#[cfg(test)]
mod tests {
    use super::lower_this_thread;

    /// The priority of the calling thread.
    #[cfg(windows)]
    fn priority() -> i32 {
        use windows_sys::Win32::System::Threading::{GetCurrentThread, GetThreadPriority};
        // SAFETY: the pseudo-handle of the calling thread is always valid.
        unsafe { GetThreadPriority(GetCurrentThread()) }
    }

    #[cfg(target_os = "linux")]
    fn priority() -> i32 {
        // SAFETY: `gettid` has no arguments; `getpriority` only reads.
        unsafe {
            let tid = libc::syscall(libc::SYS_gettid) as libc::id_t;
            libc::getpriority(libc::PRIO_PROCESS, tid)
        }
    }

    #[cfg(any(windows, target_os = "linux"))]
    #[test]
    fn a_thread_that_lowers_itself_ends_up_below_normal() {
        let (before, after) = std::thread::spawn(|| {
            let before = priority();
            lower_this_thread();
            (before, priority())
        })
        .join()
        .unwrap();
        // Windows: a higher number is a higher priority; Linux: a higher nice is a lower one.
        #[cfg(windows)]
        assert!(after < before, "{after} is not below {before}");
        #[cfg(target_os = "linux")]
        assert!(after > before, "nice {after} is not above {before}");
    }
}
