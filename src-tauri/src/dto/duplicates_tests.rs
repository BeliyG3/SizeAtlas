//! The JSON of the duplicate search.

use std::path::PathBuf;

use serde_json::json;

use super::duplicates::{CopyDto, GroupDto, RefDto, StatusDto};
use sizeatlas_core::duplicates::group::{Group, Location, Object, PathRef};
use sizeatlas_core::duplicates::results::RootMark;
use sizeatlas_core::duplicates::{DiskKind, Phase};

#[test]
fn duplicates_dto_is_camel_case() {
    let copy = CopyDto {
        refs: vec![RefDto {
            root: "C:\\".into(),
            generation: 2,
            id: 9,
        }],
        path: "C:\\a.jpg".into(),
        root: "C:\\".into(),
        mtime: 5,
        size: 4096,
        protected: false,
        hardlink: false,
        synced: false,
        no_id: true,
        trashable: false,
        hdd: false,
    };
    let copy = serde_json::to_value(copy).unwrap();
    assert_eq!(copy["noId"], json!(true));
    assert_eq!(
        copy["refs"],
        json!([{"root": "C:\\", "generation": 2, "id": 9}])
    );
    let status = StatusDto {
        job: 1,
        version: 3,
        running: true,
        stale: true,
        phase: Some(Phase::Full),
        files_done: 1,
        files_total: 2,
        bytes_done: 3,
        bytes_total: 4,
    };
    assert_eq!(
        serde_json::to_value(status).unwrap(),
        json!({"job": 1, "version": 3, "running": true, "stale": true, "phase": "full", "filesDone": 1,
            "filesTotal": 2, "bytesDone": 3, "bytesTotal": 4})
    );
    let read: RefDto =
        serde_json::from_value(json!({"root": "C:\\", "generation": 2, "id": 9})).unwrap();
    assert_eq!(read.id, 9);
}

#[test]
fn a_copy_tells_whether_its_first_path_lies_on_a_spinning_disk() {
    let object = |root: u16| Object {
        paths: vec![Location {
            at: PathRef { root, node: 1 },
            path: PathBuf::from(format!("r{root}/a.jpg")),
            len: 4096,
            mtime: 1,
            size: 4096,
            volume: root,
        }],
        id: None,
        nlink: 1,
        protected: false,
        synced: false,
        seed: true,
    };
    let group = Group {
        hash: [0; 32],
        len: 4096,
        objects: vec![object(0), object(1), object(2)],
        stale: false,
    };
    let mark = |path: &str| RootMark {
        path: path.into(),
        generation: 1,
        rev: 1,
    };
    let roots = [mark("r0"), mark("r1"), mark("r2")];
    let disks = [DiskKind::Hdd, DiskKind::Ssd, DiskKind::Unknown];
    let dto = GroupDto::of(&group, &roots, &disks);
    let hdd: Vec<bool> = dto.copies.iter().map(|c| c.hdd).collect();
    assert_eq!(hdd, [true, false, false]);
    // A result read before any disk was known.
    assert!(
        GroupDto::of(&group, &roots, &[])
            .copies
            .iter()
            .all(|c| !c.hdd)
    );
}
