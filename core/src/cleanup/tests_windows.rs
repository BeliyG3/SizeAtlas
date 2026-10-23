//! The Windows tables: dumps, error reports, caches (rules 2–7) and the info spots.

use super::tests::{Item, ago, build, it, listed, win};
use super::*;
use crate::tree::flags;

fn local(rest: &str) -> String {
    format!(r"Users\u\AppData\Local\{rest}")
}

fn roaming(rest: &str) -> String {
    format!(r"Users\u\AppData\Roaming\{rest}")
}

/// Paths of the Cleanup and Review rows of a tree below `C:\`, with the real tables.
fn rows(items: Vec<Item>, ctx: &Context) -> (Vec<String>, Vec<String>) {
    let tree = build(r"C:\", items);
    listed(&tree, &tree.cleanup(ctx))
}

fn sorted<S: AsRef<str>>(paths: &[S]) -> Vec<String> {
    let mut v: Vec<String> = paths.iter().map(|p| p.as_ref().to_owned()).collect();
    v.sort();
    v
}

#[test]
fn a_browser_profile_cache_matches_only_next_to_preferences() {
    let chrome = |rest: &str| local(&format!(r"Google\Chrome\User Data\{rest}"));
    let items = vec![
        it(chrome("Local State")),
        it(chrome(r"Default\Preferences")),
        it(chrome(r"Default\Cache\Cache_Data\f")),
        it(chrome(r"Default\Code Cache\js\f")),
        it(chrome(r"Default\Cookies")),
        it(chrome(r"Default\Network\Cookies")),
        it(chrome(r"Default\Service Worker\CacheStorage\f")),
        it(chrome(r"Default\IndexedDB\f")),
        it(chrome(r"Backup\Cache\f")),
        it(chrome(r"ShaderCache\f")),
        it(chrome(r"GrShaderCache\f")),
        it(local(r"Microsoft\Edge\User Data\Profile 1\Preferences")),
        it(local(r"Microsoft\Edge\User Data\Profile 1\GPUCache\f")),
        it(local(
            r"Mozilla\Firefox\Profiles\x.default\cache2\entries\f",
        )),
        it(local(r"Mozilla\Firefox\Profiles\x.default\startupCache\f")),
        it(roaming(r"Mozilla\Firefox\Profiles\x.default\cache2\f")),
    ];
    let expected = [
        chrome(r"Default\Cache"),
        chrome(r"Default\Code Cache"),
        chrome("GrShaderCache"),
        chrome("ShaderCache"),
        local(r"Microsoft\Edge\User Data\Profile 1\GPUCache"),
        local(r"Mozilla\Firefox\Profiles\x.default\cache2"),
    ];
    let (cleanup, review) = rows(items, &win());
    assert_eq!(cleanup, sorted(&expected));
    assert!(review.is_empty());
}

#[test]
fn opera_keeps_its_cache_in_local_and_the_rest_in_roaming() {
    let items = vec![
        it(local(r"Opera Software\Opera Stable\Cache\f")),
        it(local(r"Opera Software\Opera Stable\Code Cache\f")),
        it(roaming(r"Opera Software\Opera Stable\Code Cache\f")),
        it(roaming(r"Opera Software\Opera Stable\Cache\f")),
        it(roaming(
            r"Opera Software\Opera GX Stable\Default\GPUCache\f",
        )),
        it(roaming(
            r"Opera Software\Opera GX Stable\Default\Local Storage\f",
        )),
    ];
    let expected = [
        local(r"Opera Software\Opera Stable\Cache"),
        roaming(r"Opera Software\Opera GX Stable\Default\GPUCache"),
        roaming(r"Opera Software\Opera Stable\Code Cache"),
    ];
    let (cleanup, _) = rows(items, &win());
    assert_eq!(cleanup, sorted(&expected));
}

#[test]
fn discord_code_cache_is_cleaned_and_its_cache_is_checked() {
    let tree = build(
        r"C:\",
        vec![
            it(roaming(r"discord\Code Cache\f")),
            it(roaming(r"discordptb\GPUCache\f")),
            it(roaming(r"discord\Cache\Cache_Data\f")),
            it(roaming(r"discord\Local Storage\f")),
            it(local(r"Discord\app-1.0\Cache\f")),
            it(local(r"Steam\htmlcache\Code Cache\f")),
            it(local(r"Steam\htmlcache\Cookies")),
            it(local(r"Steam\htmlcache\Local Storage\f")),
        ],
    );
    let out = tree.cleanup(&win());
    let (cleanup, review) = listed(&tree, &out);
    assert_eq!(
        cleanup,
        [
            local(r"Steam\htmlcache\Code Cache"),
            roaming(r"discord\Code Cache"),
            roaming(r"discordptb\GPUCache"),
        ]
    );
    assert_eq!(review, [roaming(r"discord\Cache")]);
    assert_eq!(out.review[0].reason, Reason::DiscordCache);
}

#[test]
fn system_and_shader_caches_are_offered_whole() {
    let items = vec![
        it(local(r"D3DSCache\a\f")),
        it(local(r"NVIDIA\DXCache\f")),
        it(local(r"NVIDIA\Other\f")),
        it(r"Users\u\AppData\LocalLow\NVIDIA\PerDriverVersion\GLCache\f"),
        it(roaming(r"NVIDIA\ComputeCache\f")),
        it(local(r"AMD\DxCache\f")),
        it(local(r"Intel\ShaderCache\f")),
        it(local(r"Microsoft\Windows\INetCache\IE\f")),
        it(local(
            r"Microsoft\Windows\INetCache\Content.Outlook\X1\edited.docx",
        )),
        it(local(r"Microsoft\Windows\INetCache\Content.MSO\f")),
    ];
    let expected = [
        local(r"AMD\DxCache"),
        local(r"D3DSCache"),
        local(r"Intel\ShaderCache"),
        local(r"Microsoft\Windows\INetCache\IE"),
        local(r"NVIDIA\DXCache"),
        roaming(r"NVIDIA\ComputeCache"),
        r"Users\u\AppData\LocalLow\NVIDIA\PerDriverVersion\GLCache".to_string(),
    ];
    let (cleanup, review) = rows(items, &win());
    assert_eq!(cleanup, sorted(&expected));
    assert!(review.is_empty());
}

#[test]
fn crash_dumps_and_error_reports_split_by_age() {
    let report = |rest: &str| format!(r"ProgramData\Microsoft\Windows\WER\{rest}");
    let tree = build(
        r"C:\",
        vec![
            it(local(r"CrashDumps\young.dmp")).mtime(ago(3)),
            it(local(r"CrashDumps\old.dmp")),
            it(r"Windows\Minidump\old.dmp"),
            it(r"Windows\Minidump\notes.txt"),
            it(r"Windows\MEMORY.DMP"),
            it(r"Windows\Logs\CBS\CBS.log"),
            it(report(r"ReportQueue\young\Report.wer")).mtime(ago(3)),
            it(report(r"ReportQueue\old\Report.wer")),
            it(report(r"ReportArchive\young\Report.wer")).mtime(ago(3)),
            it(local(r"Microsoft\Windows\WER\ReportQueue\old\Report.wer")),
        ],
    );
    let out = tree.cleanup(&win());
    let (cleanup, review) = listed(&tree, &out);
    let expected = [
        local(r"CrashDumps\old.dmp"),
        local(r"Microsoft\Windows\WER\ReportQueue\old"),
        report(r"ReportArchive\young"),
        report(r"ReportQueue\old"),
        r"Windows\MEMORY.DMP".to_string(),
        r"Windows\Minidump\old.dmp".to_string(),
    ];
    assert_eq!(cleanup, sorted(&expected));
    assert_eq!(review, [local(r"CrashDumps\young.dmp")]);
    assert_eq!(out.review[0].reason, Reason::CrashDumpRecent);
}

#[test]
fn system_files_update_folders_and_tool_stores_are_info_only() {
    let delivery = concat!(
        r"Windows\ServiceProfiles\NetworkService\AppData\Local",
        r"\Microsoft\Windows\DeliveryOptimization\Cache\f"
    );
    let tree = build(
        r"C:\",
        vec![
            it("pagefile.sys"),
            it("swapfile.sys"),
            it("hiberfil.sys"),
            it(r"Windows.old\Windows\f"),
            it(r"$WINDOWS.~BT\f"),
            it(r"Windows\SoftwareDistribution\Download\a\f"),
            it(delivery),
            it(local(r"uv\cache\archive-v0\f")),
            it(local(r"pnpm\store\v3\files\f")),
            it(local(r"Yarn\Berry\cache\a.zip")),
        ],
    );
    let out = tree.cleanup(&win());
    assert_eq!(listed(&tree, &out), (vec![], vec![]));
    let kind = |i: &Info| match i {
        Info::Pagefile { .. } => "pagefile",
        Info::Hiberfil { .. } => "hiberfil",
        Info::PreviousWindows { .. } => "previous",
        Info::WindowsUpdate { .. } => "update",
        Info::DeliveryOptimization { .. } => "delivery",
        Info::ToolStore { command, .. } => command,
        other => panic!("{other:?}"),
    };
    let mut kinds: Vec<&str> = out.info.iter().map(kind).collect();
    kinds.sort();
    let mut expected = [
        "delivery",
        "hiberfil",
        "pagefile",
        "pagefile",
        "pnpm store prune",
        "previous",
        "previous",
        "update",
        "uv cache clean",
        "yarn cache clean",
    ];
    expected.sort();
    assert_eq!(kinds, expected);
}

#[test]
fn an_unreadable_update_folder_is_reported() {
    let tree = build(
        r"C:\",
        vec![it(r"Windows\SoftwareDistribution\").flags(flags::ACCESS_ERROR)],
    );
    let out = tree.cleanup(&win());
    let paths: Vec<String> = out
        .info
        .iter()
        .map(|i| match i {
            Info::NoAccess { path } => path.replace('/', "\\"),
            other => panic!("{other:?}"),
        })
        .collect();
    assert_eq!(paths, [r"C:\Windows\SoftwareDistribution"]);
    assert!(out.approximate);
}
