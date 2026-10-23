//! The Windows tables: dumps, error reports, caches (rules 2–7) and the info spots.

use super::tests::{ago, build, it, listed, local, roaming, rows, sorted, win};
use super::*;
use crate::tree::flags;

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
            it(r"$WINDOWS.~WS\f"),
            it(r"$WinREAgent\f"),
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
            Info::NoAccess {
                path, spot: true, ..
            } => path.clone(),
            other => panic!("{other:?}"),
        })
        .collect();
    assert_eq!(paths, [r"C:\Windows\SoftwareDistribution"]);
    assert!(out.approximate);
}

#[test]
fn every_cache_row_of_the_tables_is_offered() {
    let profile = |vendor: &str| local(&format!(r"{vendor}\User Data\Default"));
    let vendors = [
        r"Yandex\YandexBrowser",
        r"BraveSoftware\Brave-Browser",
        "Vivaldi",
        r"Google\Chrome",
    ];
    let expected = [
        roaming(r"Slack\Cache"),
        roaming(r"Slack\Code Cache"),
        roaming(r"Slack\GPUCache"),
        roaming(r"Code\Cache"),
        roaming(r"Code\CachedData"),
        roaming(r"Code\Code Cache"),
        roaming(r"Code\GPUCache"),
        profile(vendors[0]) + r"\Cache",
        profile(vendors[1]) + r"\Code Cache",
        profile(vendors[2]) + r"\GPUCache",
        profile(vendors[3]) + r"\DawnWebGPUCache",
        profile(vendors[3]) + r"\DawnGraphiteCache",
        local(r"Google\Chrome\User Data\GraphiteDawnCache"),
        local(r"Steam\htmlcache\Cache"),
        local(r"Steam\htmlcache\GPUCache"),
        local(r"AMD\GLCache"),
        local(r"NVIDIA\GLCache"),
        r"Users\u\AppData\LocalLow\NVIDIA\PerDriverVersion\DXCache".into(),
    ];
    let mut items: Vec<_> = expected.iter().map(|r| it(format!(r"{r}\f"))).collect();
    items.extend(vendors.map(|v| it(profile(v) + r"\Preferences")));
    items.push(it(local(r"Google\Chrome\User Data\Local State")));
    items.push(it(roaming(r"Code\User\settings.json")));
    items.push(it(roaming(r"Code\Backups\1\f")));
    assert_eq!(rows(items, &win()), (sorted(&expected), vec![]));
}

#[test]
fn a_spot_is_reported_unreadable_only_when_it_cannot_be_read() {
    let store = local(r"pnpm\store");
    let found = build(
        r"C:\",
        vec![
            it(local(r"pnpm\")).flags(flags::ACCESS_ERROR),
            it(format!(r"{store}\v3\f")),
        ],
    );
    let out = found.cleanup(&win());
    assert!(
        matches!(&out.info[..], [Info::ToolStore { .. }]),
        "{:?}",
        out.info
    );
    assert!(!out.approximate);

    let unreadable = build(
        r"C:\",
        vec![it(format!(r"{store}\")).flags(flags::ACCESS_ERROR)],
    );
    let out = unreadable.cleanup(&win());
    let no_access: Vec<&str> = out
        .info
        .iter()
        .filter_map(|i| match i {
            Info::NoAccess { path, .. } => Some(path.as_str()),
            _ => None,
        })
        .collect();
    assert_eq!(no_access.len(), 1);
    assert!(no_access[0].ends_with("store"), "{no_access:?}");
    assert!(out.approximate);
}
