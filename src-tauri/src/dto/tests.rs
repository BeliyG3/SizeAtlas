use serde_json::json;
use sizeatlas_core::tree::{ListKind, ListOrder, SortKey};

use super::*;

#[test]
fn errors_serialize_with_a_code_and_camel_case_fields() {
    let error = CmdError::Io {
        path: "C:\\x".into(),
        os_message: "denied".into(),
    };
    assert_eq!(
        serde_json::to_value(error).unwrap(),
        json!({"code": "Io", "path": "C:\\x", "osMessage": "denied"})
    );
    assert_eq!(
        serde_json::to_value(CmdError::StaleId).unwrap(),
        json!({"code": "StaleId"})
    );
}

#[test]
fn summary_uses_camel_case_and_nests_the_volume() {
    let summary = Summary {
        generation: 3,
        rev: 0,
        root_id: 0,
        root: "C:\\".into(),
        total: 10,
        files: 2,
        len: 12,
        dirs: 1,
        scanned_at: 5,
        size_mode: SizeMode::ClusterEstimate,
        access_errors: 1,
        approximate: false,
        scanning: false,
        volume: Some(VolumeDto {
            total: 100,
            free: 60,
            unaccounted: 30,
        }),
        baseline_at: Some(4),
        baseline_rev: 2,
        baseline_pending: true,
    };
    assert_eq!(
        serde_json::to_value(summary).unwrap(),
        json!({
            "generation": 3, "rev": 0, "rootId": 0, "root": "C:\\", "total": 10, "files": 2,
            "len": 12, "dirs": 1,
            "scannedAt": 5, "sizeMode": "ClusterEstimate", "accessErrors": 1,
            "approximate": false, "scanning": false, "volume": {"total": 100, "free": 60, "unaccounted": 30},
            "baselineAt": 4, "baselineRev": 2, "baselinePending": true
        })
    );
}

#[test]
fn panel_dtos_use_camel_case() {
    let crumb = CrumbDto {
        id: 4,
        name: "docs".into(),
        size: 7,
        rank: 2,
    };
    assert_eq!(
        serde_json::to_value(crumb).unwrap(),
        json!({"id": 4, "name": "docs", "size": 7, "rank": 2})
    );
    let scan = CachedScanDto {
        root: "/".into(),
        scanned_at: 1,
        total: 2,
        files: 3,
        outdated: true,
    };
    assert_eq!(
        serde_json::to_value(scan).unwrap(),
        json!({"root": "/", "scannedAt": 1, "total": 2, "files": 3, "outdated": true})
    );
}

#[test]
fn items_details_and_orders_use_camel_case() {
    let item = ItemDto {
        id: 5,
        name: "a".into(),
        size: 4096,
        len: 10,
        files: 1,
        dirs: 0,
        folders: 0,
        modified: 1_700_000_000_000,
        is_dir: false,
        category: 7,
        access_error: false,
        cloud: false,
        lossy: false,
        pending: false,
        scanning: false,
        before: Some(4000),
        change: Some(ChangeDto::Delta(96)),
        approx_change: true,
    };
    assert_eq!(
        serde_json::to_value(item).unwrap(),
        json!({
            "id": 5, "name": "a", "size": 4096, "len": 10, "files": 1, "dirs": 0,
            "folders": 0, "modified": 1_700_000_000_000i64, "isDir": false, "category": 7,
            "accessError": false, "cloud": false, "lossy": false, "pending": false, "scanning": false,
            "before": 4000, "change": {"delta": 96}, "approxChange": true
        })
    );
    let detail = DetailDto {
        id: 5,
        created: Some(1),
        accessed: None,
        attributes: Some("A".into()),
        owner: None,
    };
    assert_eq!(
        serde_json::to_value(detail).unwrap(),
        json!({"id": 5, "created": 1, "accessed": null, "attributes": "A", "owner": null})
    );
    let order: ListOrder =
        serde_json::from_value(json!({"key": "len", "descending": false, "dirsOnly": true}))
            .unwrap();
    assert_eq!(
        order,
        ListOrder {
            key: SortKey::Len,
            descending: false,
            dirs_only: true
        }
    );
    assert_eq!((millis(1_999_999), millis(-1)), (1, -1));
    let change: SortKey = serde_json::from_value(json!("change")).unwrap();
    assert_eq!(change, SortKey::Change);
    let changes = [ChangeDto::Delta(-5), ChangeDto::New, ChangeDto::Unknown];
    assert_eq!(
        serde_json::to_value(changes).unwrap(),
        json!([{"delta": -5}, "new", "unknown"])
    );
}

#[test]
fn roots_queue_progress_and_scan_errors_use_camel_case() {
    let roots = RootsDto {
        roots: Vec::new(),
        queue: vec![
            QueueEntryDto {
                root: "C:\\".into(),
                state: QueueState::Scanning,
                folder: None,
            },
            QueueEntryDto {
                root: "/b".into(),
                state: QueueState::Queued,
                folder: Some("/b/x".into()),
            },
        ],
    };
    assert_eq!(
        serde_json::to_value(roots).unwrap(),
        json!({"roots": [], "queue": [
            {"root": "C:\\", "state": "scanning", "folder": null},
            {"root": "/b", "state": "queued", "folder": "/b/x"}
        ]})
    );
    let error = ScanErrorDto {
        root: "/b".into(),
        error: CmdError::CacheNotSaved,
    };
    assert_eq!(
        serde_json::to_value(error).unwrap(),
        json!({"root": "/b", "error": {"code": "CacheNotSaved"}})
    );
    let progress = ProgressDto {
        root: "/b".into(),
        files: 1,
        dirs: 2,
        bytes: 3,
        current: "/b/x".into(),
    };
    assert_eq!(
        serde_json::to_value(progress).unwrap(),
        json!({"root": "/b", "files": 1, "dirs": 2, "bytes": 3, "current": "/b/x"})
    );
}

#[test]
fn list_kinds_and_list_items_use_camel_case() {
    let kinds = [
        ("largestFiles", ListKind::LargestFiles),
        ("largestFolders", ListKind::LargestFolders),
        ("largest", ListKind::Largest),
        ("oldestFiles", ListKind::OldestFiles),
        ("oldestFolders", ListKind::OldestFolders),
        ("oldest", ListKind::Oldest),
        ("newestFiles", ListKind::NewestFiles),
        ("newestFolders", ListKind::NewestFolders),
        ("newest", ListKind::Newest),
        ("emptyFolders", ListKind::EmptyFolders),
        ("emptyFiles", ListKind::EmptyFiles),
        ("empty", ListKind::Empty),
        ("unreadable", ListKind::Unreadable),
        ("longestPaths", ListKind::LongestPaths),
        ("grewMost", ListKind::GrewMost),
        ("search", ListKind::Search),
        ("cleanup", ListKind::Cleanup),
        ("review", ListKind::Review),
    ];
    for (name, kind) in kinds {
        assert_eq!(
            serde_json::from_value::<ListKind>(json!(name)).unwrap(),
            kind
        );
    }
    let list = ListDto {
        generation: 2,
        rev: 0,
        size: 50,
        truncated: true,
        items: vec![ListItemDto {
            item: ItemDto {
                id: 5,
                name: "a".into(),
                size: 4096,
                len: 10,
                files: 1,
                dirs: 0,
                folders: 0,
                modified: 1,
                is_dir: false,
                category: 7,
                access_error: false,
                cloud: false,
                lossy: false,
                pending: false,
                scanning: false,
                before: None,
                change: None,
                approx_change: false,
            },
            folder: "x".into(),
            parent: 3,
            deleted: true,
            reason: None,
        }],
        found: Some(FoundDto { count: 7, size: 90 }),
        cleanup: None,
        baseline_at: None,
        baseline_rev: 0,
        baseline_pending: false,
    };
    let value = serde_json::to_value(list).unwrap();
    assert_eq!(
        (&value["size"], &value["truncated"], &value["baselineAt"]),
        (&json!(50), &json!(true), &json!(null))
    );
    assert_eq!(value["found"], json!({ "count": 7, "size": 90 }));
    assert_eq!(value["cleanup"], json!(null));
    assert_eq!(value["items"][0]["reason"], json!(null));
    let item = &value["items"][0];
    assert_eq!(
        (
            &item["name"],
            &item["isDir"],
            &item["folder"],
            &item["parent"],
            &item["deleted"],
            &item["change"]
        ),
        (
            &json!("a"),
            &json!(false),
            &json!("x"),
            &json!(3),
            &json!(true),
            &json!(null)
        )
    );
}

#[test]
fn clean_up_reasons_and_info_use_camel_case() {
    use sizeatlas_core::cleanup::Reason;
    let reason = ReasonDto {
        reason: Reason::NodeModules,
        command: None,
        restorable: Some(true),
    };
    assert_eq!(
        serde_json::to_value(reason).unwrap(),
        json!({"reason": "nodeModules", "command": null, "restorable": true})
    );
    let info = |kind| InfoDto {
        kind,
        path: None,
        size: Some(5),
        app: None,
        command: None,
    };
    let cleanup = CleanupDto {
        info: vec![
            InfoDto {
                path: Some(r"C:\Users\u\AppData\Local\uv\cache".into()),
                command: Some("uv cache clean".into()),
                ..info(InfoKind::ToolStore)
            },
            InfoDto {
                app: Some("Google Chrome".into()),
                ..info(InfoKind::AppRunning)
            },
            info(InfoKind::PreviousWindows),
            info(InfoKind::DeliveryOptimization),
        ],
        approximate: true,
    };
    assert_eq!(
        serde_json::to_value(cleanup).unwrap(),
        json!({"info": [
            {"kind": "toolStore", "path": r"C:\Users\u\AppData\Local\uv\cache", "size": 5,
                "app": null, "command": "uv cache clean"},
            {"kind": "appRunning", "path": null, "size": 5, "app": "Google Chrome", "command": null},
            {"kind": "previousWindows", "path": null, "size": 5, "app": null, "command": null},
            {"kind": "deliveryOptimization", "path": null, "size": 5, "app": null, "command": null},
        ], "approximate": true})
    );
    assert_eq!(
        serde_json::to_value(InfoKind::NoAccess).unwrap(),
        json!("noAccess")
    );
}

#[test]
fn trash_results_use_camel_case() {
    let done = TrashDto {
        removed: 1,
        failed: vec![TrashFailureDto {
            path: "C:\\x".into(),
            error: CmdError::NoTrash,
        }],
        warning: Some(CmdError::CacheNotSaved),
        stopped: true,
    };
    assert_eq!(
        serde_json::to_value(done).unwrap(),
        json!({"removed": 1, "failed": [{"path": "C:\\x", "error": {"code": "NoTrash"}}],
            "warning": {"code": "CacheNotSaved"}, "stopped": true})
    );
    let progress = TrashProgressDto {
        done: 2,
        total: 5,
        current: None,
    };
    assert_eq!(
        serde_json::to_value(progress).unwrap(),
        json!({"done": 2, "total": 5, "current": null})
    );
}
