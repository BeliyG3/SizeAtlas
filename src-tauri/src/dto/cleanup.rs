//! Why a clean-up row is listed, and the facts shown under the total of the clean-up modes
//! (see `sizeatlas_core::cleanup`).

use serde::Serialize;
use sizeatlas_core::cleanup::{Info, Mode, Reason, Row};
use sizeatlas_core::tree::Tree;

/// Why a row of the clean-up modes is listed.
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ReasonDto {
    pub reason: Reason,
    /// The tool's own clean-up command, for the user to run.
    pub command: Option<String>,
    /// `node_modules` and venvs: whether a lock file lies next to them.
    pub restorable: Option<bool>,
}

impl From<&Row> for ReasonDto {
    fn from(row: &Row) -> Self {
        ReasonDto {
            reason: row.reason,
            command: row.command.map(str::to_owned),
            restorable: row.restorable,
        }
    }
}

/// What the clean-up modes show besides their rows.
#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CleanupDto {
    pub info: Vec<InfoDto>,
    /// The tree is approximate or a place could not be read: the total is a lower bound.
    pub approximate: bool,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum InfoKind {
    Pagefile,
    Hiberfil,
    PreviousWindows,
    WindowsUpdate,
    DeliveryOptimization,
    ToolStore,
    NoAccess,
    AppRunning,
}

/// One fact under the total. Which fields are set depends on `kind`: `path` and `size` for the
/// system places and tool stores, `command` for tool stores, `path` for `noAccess`, `app` and
/// `size` for `appRunning`.
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InfoDto {
    pub kind: InfoKind,
    pub path: Option<String>,
    pub size: Option<u64>,
    pub app: Option<String>,
    pub command: Option<String>,
}

impl InfoDto {
    fn bare(kind: InfoKind) -> InfoDto {
        InfoDto {
            kind,
            path: None,
            size: None,
            app: None,
            command: None,
        }
    }

    /// `info` as shown in the list of `mode` made for the nodes `inside` accepts; `None` when
    /// it does not belong there. System places and tool stores show only in `Cleanup`; a running
    /// app shows in the mode of its rows, with the size of those `inside`.
    pub fn of(tree: &Tree, info: &Info, mode: Mode, inside: impl Fn(u32) -> bool) -> Option<Self> {
        let path = |id: u32| Some(tree.path(id).to_string_lossy().into_owned());
        let place = |kind, id: u32, command: Option<&str>| {
            (mode == Mode::Cleanup && inside(id)).then(|| InfoDto {
                path: path(id),
                size: Some(tree.node(id).size),
                command: command.map(str::to_owned),
                ..InfoDto::bare(kind)
            })
        };
        match info {
            Info::Pagefile { id } => place(InfoKind::Pagefile, *id, None),
            Info::Hiberfil { id } => place(InfoKind::Hiberfil, *id, None),
            Info::PreviousWindows { id } => place(InfoKind::PreviousWindows, *id, None),
            Info::WindowsUpdate { id } => place(InfoKind::WindowsUpdate, *id, None),
            Info::DeliveryOptimization { id } => place(InfoKind::DeliveryOptimization, *id, None),
            Info::ToolStore { id, command } => place(InfoKind::ToolStore, *id, Some(command)),
            // A place on the way to an info spot concerns only the info of `Cleanup`.
            Info::NoAccess { id, spot, .. } => (inside(*id) && (!spot || mode == Mode::Cleanup))
                .then(|| InfoDto {
                    path: path(*id),
                    ..InfoDto::bare(InfoKind::NoAccess)
                }),
            Info::AppRunning {
                app, mode: of, ids, ..
            } => {
                let mut held = ids.iter().filter(|&&id| inside(id)).peekable();
                (*of == mode && held.peek().is_some()).then(|| InfoDto {
                    app: Some((*app).to_owned()),
                    size: Some(held.map(|&id| tree.node(id).size).sum()),
                    ..InfoDto::bare(InfoKind::AppRunning)
                })
            }
        }
    }
}
