//! Benchmark: scans a directory, then saves and reloads the scan cache.
//!
//! Usage: cargo run -p sizeatlas-core --release --example scan -- <path> [--live] [--twice] [--edit]
//! `--twice` keeps the first tree alive while scanning again (peak memory of a rescan).
//! `--edit` removes the largest folders until most nodes are dead, then compacts the tree.

use std::env;
use std::path::{Path, PathBuf};
use std::process::exit;
use std::sync::atomic::AtomicBool;
use std::time::Instant;

use sizeatlas_core::cache;
use sizeatlas_core::scanner::{self, Progress, ScanOutcome};
use sizeatlas_core::tree::Tree;

#[path = "scan/live.rs"]
mod live;

const GIB: f64 = (1u64 << 30) as f64;
const MIB: u64 = 1 << 20;

fn main() {
    let mut args = env::args().skip(1);
    let Some(root) = args.next().map(PathBuf::from) else {
        eprintln!("usage: scan <path> [--live] [--twice] [--edit]");
        exit(2);
    };
    let flags: Vec<String> = args.collect();
    let twice = flags.iter().any(|a| a == "--twice");
    let edit = flags.iter().any(|a| a == "--edit");
    let live = flags.iter().any(|a| a == "--live");

    let mut first = timed_scan(&root, live);
    if edit {
        timed_edit(&mut first);
    }
    let second = twice.then(|| timed_scan(&root, false));
    println!("peak memory after scan: {} MiB", peak_memory_bytes() / MIB);
    report_cache(&first);
    drop(second);
    println!("peak memory incl. cache: {} MiB", peak_memory_bytes() / MIB);
}

fn timed_scan(root: &Path, first_scan: bool) -> Tree {
    let start = Instant::now();
    let result = if first_scan {
        live::scan(root)
    } else {
        scanner::scan(root, &AtomicBool::new(false), &Progress::default())
    };
    let tree = match result {
        Ok(ScanOutcome::Done(tree)) => tree,
        Ok(ScanOutcome::Cancelled) => unreachable!("nothing cancels this scan"),
        Err(e) => {
            eprintln!("scan failed: {e}");
            exit(1);
        }
    };
    let root_node = tree.node(0);
    println!("scan time: {:.3} s", start.elapsed().as_secs_f64());
    println!(
        "nodes: {} (files {}, dirs {})",
        tree.len(),
        root_node.files,
        tree.len() - root_node.files as usize
    );
    println!(
        "total: {:.2} GiB ({:?}, cluster {} B)",
        root_node.size as f64 / GIB,
        tree.size_mode,
        tree.cluster
    );
    println!("access errors: {}", tree.access_errors);
    tree
}

/// What a large trash or refresh costs: one folder removed, then the largest folders below the
/// root until most nodes are dead, then compaction; the cache is saved after each stage.
fn timed_edit(tree: &mut Tree) {
    let largest = |tree: &Tree| tree.children(0).max_by_key(|&c| tree.node(c).size);
    let start = Instant::now();
    if let Some(folder) = largest(tree) {
        tree.remove(folder);
    }
    println!(
        "remove of the largest folder: {:.2} s",
        start.elapsed().as_secs_f64()
    );
    timed_save("cache save with dead nodes", tree);
    while tree.dead <= tree.live {
        let Some(folder) = largest(tree) else { break };
        tree.remove(folder);
    }
    let start = Instant::now();
    let old = tree.compact();
    println!(
        "compact: {:.2} s, {} live nodes",
        start.elapsed().as_secs_f64(),
        tree.live
    );
    let start = Instant::now();
    drop(old);
    println!(
        "drop of the old tree: {:.2} s",
        start.elapsed().as_secs_f64()
    );
    timed_save("cache save after compact", tree);
}

fn timed_save(label: &str, tree: &Tree) {
    let path = env::temp_dir().join(format!("sizeatlas-edit-{}.bin", std::process::id()));
    let start = Instant::now();
    let saved = cache::save(tree, &path);
    println!(
        "{label}: {:.2} s (ok: {})",
        start.elapsed().as_secs_f64(),
        saved.is_ok()
    );
    let _ = std::fs::remove_file(&path);
}

fn report_cache(tree: &Tree) {
    let path = env::temp_dir().join(format!("sizeatlas-bench-{}.bin", std::process::id()));
    let start = Instant::now();
    if let Err(e) = cache::save(tree, &path) {
        eprintln!("cache save failed: {e}");
        return;
    }
    let save_time = start.elapsed();
    let size = std::fs::metadata(&path).map_or(0, |m| m.len());
    let start = Instant::now();
    let header = cache::read_header(&path);
    let header_time = start.elapsed();
    let start = Instant::now();
    let loaded = cache::load(&path);
    let load_time = start.elapsed();
    let _ = std::fs::remove_file(&path);

    println!(
        "cache save: {:.2} s, file {} MiB",
        save_time.as_secs_f64(),
        size / MIB
    );
    println!(
        "cache header read: {:.1} ms (ok: {})",
        header_time.as_secs_f64() * 1000.0,
        header.is_ok()
    );
    println!(
        "cache load: {:.2} s (ok: {})",
        load_time.as_secs_f64(),
        loaded.is_ok()
    );
}

#[cfg(windows)]
fn peak_memory_bytes() -> u64 {
    use windows_sys::Win32::System::ProcessStatus::{
        GetProcessMemoryInfo, PROCESS_MEMORY_COUNTERS,
    };
    use windows_sys::Win32::System::Threading::GetCurrentProcess;

    // SAFETY: an all-zero PROCESS_MEMORY_COUNTERS is valid; `cb` is set before the call.
    let mut counters: PROCESS_MEMORY_COUNTERS = unsafe { std::mem::zeroed() };
    counters.cb = size_of::<PROCESS_MEMORY_COUNTERS>() as u32;
    // SAFETY: pseudo-handle of this process and a correctly sized out-struct.
    let ok = unsafe { GetProcessMemoryInfo(GetCurrentProcess(), &mut counters, counters.cb) };
    if ok == 0 {
        0
    } else {
        counters.PeakWorkingSetSize as u64
    }
}

#[cfg(unix)]
fn peak_memory_bytes() -> u64 {
    // SAFETY: an all-zero rusage is valid and `getrusage` only writes into it.
    let mut usage: libc::rusage = unsafe { std::mem::zeroed() };
    // SAFETY: valid out-pointer.
    unsafe { libc::getrusage(libc::RUSAGE_SELF, &mut usage) };
    let max = usage.ru_maxrss as u64;
    // macOS reports bytes, Linux reports KiB.
    if cfg!(target_os = "macos") {
        max
    } else {
        max * 1024
    }
}
