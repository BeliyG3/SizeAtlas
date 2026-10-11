use std::fs;
use std::io;

use super::*;

#[test]
fn reads_times_attributes_and_owner_of_a_file_and_a_folder() {
    let dir = tempfile::tempdir().unwrap();
    let file = dir.path().join("f.txt");
    fs::write(&file, b"x").unwrap();
    let f = read(&file).unwrap();
    let d = read(dir.path()).unwrap();
    assert!(f.accessed.is_some(), "{f:?}");
    assert!(f.owner.as_deref().is_some_and(|o| !o.is_empty()), "{f:?}");
    assert_eq!(f.owner, d.owner, "both were created by this user");
    #[cfg(windows)]
    {
        assert!(d.attributes.starts_with('D'), "{}", d.attributes);
        assert!(!f.attributes.contains('D'), "{}", f.attributes);
        assert!(f.created.is_some());
    }
    #[cfg(unix)]
    {
        assert!(d.attributes.starts_with('d'), "{}", d.attributes);
        assert_eq!(d.attributes.len(), 10);
        assert!(f.attributes.starts_with('-'), "{}", f.attributes);
    }
}

#[test]
fn missing_path_is_not_found() {
    let dir = tempfile::tempdir().unwrap();
    let err = read(&dir.path().join("missing")).unwrap_err();
    assert_eq!(err.kind(), io::ErrorKind::NotFound);
}
