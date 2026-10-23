//! Never places and names, the guard for the re-check before deleting, and info spots.

use super::tests::{build, id, it, listed, run, win};
use super::*;

const INETCACHE: &[&str] = &["Microsoft", "Windows", "INetCache"];

#[test]
fn anywhere_names_ignore_case_and_spare_package_names() {
    for name in [
        ".ssh",
        ".SSH",
        "NuGet.Config",
        "backup.PST",
        "почта.Pst",
        "llama.gguf",
        "models--bert",
        "huggingface",
        "tdata",
        "FILE0001.CHK",
    ] {
        assert!(is_protected_name(name), "{name}");
    }
    for name in ["torch", "Crypto", "Protect", "Vault", "package.json", "ssh"] {
        assert!(!is_protected_name(name), "{name}");
    }
}

#[test]
fn ai_tool_work_in_temp_is_never_listed() {
    let tree = build(
        r"C:\",
        vec![
            it(r"Users\u\AppData\Local\Temp\claude\session\a").size(79 << 30),
            it(r"Users\u\AppData\Local\Temp\Low\a"),
            it(r"Users\u\AppData\Local\Temp\old\a"),
        ],
    );
    let out = run(&tree, &win());
    assert_eq!(
        listed(&tree, &out),
        (vec![r"Users\u\AppData\Local\Temp\old".into()], vec![])
    );
}

#[test]
fn a_never_place_closes_its_subtree_and_blocks_a_folder_holding_it() {
    let children = Rule::new(
        Place::At(At::Local, INETCACHE),
        Target::Any("*"),
        Mode::Cleanup,
        Reason::WindowsCache,
    );
    let whole = Rule::new(
        Place::At(At::Local, &["Microsoft", "Windows"]),
        Target::Dir("INetCache"),
        Mode::Cleanup,
        Reason::WindowsCache,
    );
    let base = r"Users\u\AppData\Local\Microsoft\Windows\INetCache";
    let tree = build(
        r"C:\",
        vec![
            it(format!(r"{base}\IE\a")),
            it(format!(r"{base}\Content.Outlook\X1\mail.docx")),
            it(format!(r"{base}\Content.MSO\b")),
        ],
    );
    let out = tree.cleanup_with(&win(), &[children], &[]);
    assert_eq!(listed(&tree, &out).0, [format!(r"{base}\IE")]);
    let out = tree.cleanup_with(&win(), &[whole], &[]);
    assert_eq!(out, Cleanup::default());
}

#[test]
fn the_system_folder_is_closed_except_its_temp_and_dumps() {
    let any = Rule::new(
        Place::At(At::SystemRoot, &["*"]),
        Target::Any("*"),
        Mode::Cleanup,
        Reason::WindowsCache,
    );
    let tree = build(
        r"C:\",
        vec![
            it(r"Windows\System32\drivers\x.sys"),
            it(r"Windows\WinSxS\a\b"),
            it(r"Windows\Temp\old\a"),
            it(r"Windows\Minidump\a.dmp"),
        ],
    );
    let out = tree.cleanup_with(&win(), &[any], &[]);
    assert_eq!(
        listed(&tree, &out).0,
        [r"Windows\Minidump\a.dmp", r"Windows\Temp\old"]
    );
}

#[test]
fn the_guard_blocks_never_places_and_names_at_any_depth() {
    let ctx = win();
    let guard = Guard::new(Os::Windows, &ctx.known);
    for path in [
        r"C:\Users\u\.ssh\id_rsa",
        r"c:\users\U\APPDATA\Roaming\Microsoft\Protect\S-1\key",
        r"\\?\C:\Windows\System32\config\SAM",
        r"C:\Users\u\AppData\Local\Temp\claude\x\y",
        r"C:\Users\u\AppData\Local\Temp\old\models--gpt2\a",
        r"C:\Users\u\OneDrive\notes.txt",
        r"C:\Users\u\Documents\a.txt",
        r"C:\Users\u\AppData\Local\Google\Chrome\User Data\Default\IndexedDB\x",
    ] {
        assert!(guard.blocks(path), "{path}");
    }
    for path in [
        r"C:\Windows\Temp\old\a",
        r"C:\Users\u\AppData\Local\Temp\old\a.txt",
        r"C:\Users\u\AppData\Local\Google\Chrome\User Data\Default\Cache\data_0",
        r"C:\src\p\node_modules\torch\x",
    ] {
        assert!(!guard.blocks(path), "{path}");
    }

    let known = Known {
        home: "/home/u".into(),
        ..Known::default()
    };
    let guard = Guard::new(Os::Linux, &known);
    assert!(guard.blocks("/home/u/.cache/torch/hub/x"));
    assert!(guard.blocks("/tmp/x"));
    assert!(guard.blocks("/etc/passwd"));
    assert!(!guard.blocks("/home/u/.cache/pip/http/a"));
}

#[test]
fn spots_are_found_by_path_even_inside_never_places() {
    let spots = [
        Spot {
            at: At::SystemDrive,
            path: &["pagefile.sys"],
            kind: SpotKind::Pagefile,
        },
        Spot {
            at: At::Local,
            path: &["uv", "cache"],
            kind: SpotKind::ToolStore("uv cache clean"),
        },
        Spot {
            at: At::SystemRoot,
            path: &["SoftwareDistribution", "Download"],
            kind: SpotKind::WindowsUpdate,
        },
    ];
    let tree = build(
        r"C:\",
        vec![it("pagefile.sys"), it(r"Users\u\AppData\Local\uv\cache\a")],
    );
    let out = tree.cleanup_with(&win(), &[], &spots);
    assert_eq!(
        out.info,
        [
            Info::Pagefile {
                id: id(&tree, "pagefile.sys")
            },
            Info::ToolStore {
                id: id(&tree, r"Users\u\AppData\Local\uv\cache"),
                command: "uv cache clean"
            },
        ]
    );
}
