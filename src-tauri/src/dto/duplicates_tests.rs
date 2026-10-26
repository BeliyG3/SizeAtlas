//! The JSON of the duplicate search.

use serde_json::json;

use super::duplicates::{CopyDto, RefDto, StatusDto};
use sizeatlas_core::duplicates::Phase;

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
