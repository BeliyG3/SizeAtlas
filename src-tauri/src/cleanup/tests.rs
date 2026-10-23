use std::collections::HashMap;
use std::fs;
use std::sync::atomic::AtomicBool;

use sizeatlas_core::scanner::{Progress, ScanOutcome, scan};
use sizeatlas_core::tree::Tree;

use super::*;

/// The only test that reads this machine: it checks that the folders the "anywhere" rules need
/// are found, and nothing about what they are.
#[test]
fn the_real_context_reads_without_failing() {
    let dir = tempfile::tempdir().unwrap();
    let ctx = real_context(dir.path());
    assert_eq!(ctx.os, Os::current());
    assert!(!ctx.known.home.is_empty());
    assert!(!ctx.running.is_empty(), "this test runs in a process");
    if cfg!(windows) {
        let k = &ctx.known;
        assert!(!k.system_root.is_empty() && !k.program_data.is_empty());
        assert!(k.users.as_deref().is_some_and(|u| !u.is_empty()));
        assert!(!k.program_files.is_empty());
        let mut unique = k.program_files.clone();
        unique.sort();
        unique.dedup();
        assert_eq!(unique.len(), k.program_files.len(), "no duplicates");
    }
}

#[test]
fn a_missing_or_empty_folder_is_absent() {
    let dir = tempfile::tempdir().unwrap();
    assert_eq!(folder(Path::new("")), None);
    assert_eq!(folder(&dir.path().join("missing")), None);
    let found = folder(dir.path()).unwrap();
    assert!(!found.starts_with(r"\\?\"), "{found}");
    assert_eq!(parent(&found), folder(dir.path().parent().unwrap()));
}

/// `known` with the variables of `vars` and every folder taken as written.
fn known_from(os: Os, vars: &[(&str, String)]) -> Known {
    let map: HashMap<&str, String> = vars.iter().cloned().collect();
    let var = |name: &str| map.get(name).cloned();
    let dir = |path: &Path| Some(path.to_string_lossy().into_owned());
    known(
        os,
        &Env {
            var: &var,
            dir: &dir,
        },
    )
}

/// The `node_modules` rows found with `known`, by the folder holding the project.
fn projects(tree: &Tree, known: Known) -> Vec<String> {
    let ctx = Context {
        os: Os::Windows,
        known,
        running: Vec::new(),
        reboot_pending: false,
        recyclable: true,
    };
    let rows = tree.cleanup(&ctx).review;
    let parent = |id: u32| tree.name(tree.node(id).parent).to_owned();
    rows.iter().map(|r| parent(r.id)).collect()
}

#[test]
fn as_system_other_profiles_stay_a_zone() {
    let dir = tempfile::tempdir().unwrap();
    let root = dunce::canonicalize(dir.path()).unwrap();
    for project in ["Users/alice/web", "Dev/app"] {
        fs::create_dir_all(root.join(project).join("node_modules")).unwrap();
        fs::write(root.join(project).join("package.json"), b"{}").unwrap();
        fs::write(root.join(project).join("node_modules/x.js"), b"x").unwrap();
    }
    let ScanOutcome::Done(tree) =
        scan(&root, &AtomicBool::new(false), &Progress::default()).unwrap()
    else {
        panic!("not cancelled")
    };
    let at = |rel: &str| root.join(rel).to_string_lossy().into_owned();
    let mut vars = vec![
        ("USERPROFILE", at("Windows/System32/config/systemprofile")),
        ("SystemRoot", at("Windows")),
        ("ProgramData", at("ProgramData")),
        ("ProgramFiles", at("Program Files")),
        ("PUBLIC", at("Users/Public")),
    ];
    let known = known_from(Os::Windows, &vars);
    assert_eq!(known.users, Some(at("Users")));
    // Alice's project is another profile's: only the control outside the profiles is listed.
    assert_eq!(projects(&tree, known), ["app"]);

    vars.retain(|(name, _)| *name != "PUBLIC");
    let known = known_from(Os::Windows, &vars);
    assert_eq!(known.users.as_deref(), Some(""));
    assert_eq!(projects(&tree, known), Vec::<String>::new(), "fails closed");
}

#[test]
fn on_unix_the_core_decides_the_users_folder() {
    for home in ["/var/root", "/root", "/home/u"] {
        let known = known_from(Os::Mac, &[("HOME", home.to_owned())]);
        assert_eq!(known.home, home);
        assert_eq!(known.users, None, "{home}");
    }
}

#[test]
fn a_cloud_folder_made_after_launch_is_known_at_the_next_context() {
    let dir = tempfile::tempdir().unwrap();
    let home = folder(dir.path()).unwrap();
    let map = HashMap::from([("USERPROFILE", home.clone()), ("HOME", home)]);
    let var = |name: &str| map.get(name).cloned();
    let env = Env {
        var: &var,
        dir: &folder,
    };
    let at_launch = known(Os::current(), &env);
    assert_eq!(at_launch.cloud, Vec::<String>::new());
    fs::create_dir(dir.path().join("Dropbox")).unwrap();
    let now = with_clouds(&at_launch, Os::current(), &env);
    assert_eq!(now.cloud, [folder(&dir.path().join("Dropbox")).unwrap()]);
    let others = Known {
        cloud: Vec::new(),
        ..now
    };
    assert_eq!(others, at_launch, "only the cloud folders are read again");
}
