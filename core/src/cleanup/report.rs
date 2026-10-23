//! Matched items to rows and info: what they hold, their age and size, running apps.

use super::markers::locks;
use super::paths::{fits, node_path};
use super::walk::{Found, Walk};
use super::{Age, App, Cleanup, Info, Matches, Mode, Reason, Row, Rule, Running, is_old};

/// Temp items larger than this go to Review.
const LARGE: u64 = 1 << 30;

impl Walk<'_> {
    /// The rows and info of the walk; which rows a running app holds back is left to
    /// [`Matches::route`].
    pub(super) fn finish(self) -> Matches {
        let mut out = Matches::default();
        let path = |id| node_path(self.tree, id, self.ctx.os);
        let no_access = |id| Info::NoAccess {
            id,
            path: path(id),
            spot: false,
        };
        out.info
            .extend(self.unreadable.iter().map(|&id| no_access(id)));
        for found in &self.found {
            if found.busy || found.cloud || found.blocked {
                continue;
            }
            let rule = &self.rules[found.rule];
            if rule.reboot_blocks && self.ctx.reboot_pending {
                continue;
            }
            // A young Temp item is listed nowhere, readable or not.
            let Some((mode, reason)) = self.classify(found, rule) else {
                continue;
            };
            if found.unreadable {
                out.info.push(no_access(found.id));
                continue;
            }
            let row = Row {
                id: found.id,
                mode,
                reason,
                command: rule.command,
                restorable: locks(reason).map(|names| self.beside(found.id, names)),
            };
            let size = self.tree.node(found.id).size;
            out.rows.push((row, rule.app, size));
        }
        out
    }

    /// The mode and reason of a matched item, or `None` when it is listed nowhere.
    fn classify(&self, found: &Found, rule: &Rule) -> Option<(Mode, Reason)> {
        if let Some(Age { days, young }) = rule.age
            && !is_old(self.tree, found.id, days)
        {
            return young;
        }
        if rule.temp && found.work {
            return Some((Mode::Review, Reason::TempWork));
        }
        if rule.temp && self.tree.node(found.id).size > LARGE {
            return Some((Mode::Review, Reason::TempLarge));
        }
        Some((rule.mode, rule.reason))
    }

    /// Whether a name next to `id` fits one of `masks`.
    fn beside(&self, id: u32, masks: &[&str]) -> bool {
        let tree = self.tree;
        tree.children(tree.node(id).parent).any(|c| {
            masks
                .iter()
                .any(|m| fits(m, tree.name(c), self.ctx.os.folds()))
        })
    }
}

impl Matches {
    /// The lists with the rows of the apps in `running` held back: one info line per app and
    /// mode instead.
    pub fn route(&self, running: &[Running]) -> Cleanup {
        let mut out = Cleanup {
            info: self.info.clone(),
            approximate: self.approximate,
            ..Cleanup::default()
        };
        let mut held: Vec<(&'static App, Mode, Vec<u32>, u64)> = Vec::new();
        for (row, app, size) in &self.rows {
            if let Some(app) = app.filter(|app| is_running(app, running)) {
                match held
                    .iter_mut()
                    .find(|(a, m, ..)| a.name == app.name && *m == row.mode)
                {
                    Some((_, _, ids, total)) => {
                        ids.push(row.id);
                        *total += size;
                    }
                    None => held.push((app, row.mode, vec![row.id], *size)),
                }
                continue;
            }
            match row.mode {
                Mode::Cleanup => out.cleanup.push(row.clone()),
                Mode::Review => out.review.push(row.clone()),
            }
        }
        out.info.extend(
            held.into_iter()
                .map(|(app, mode, ids, size)| Info::AppRunning {
                    app: app.name,
                    mode,
                    ids,
                    size,
                }),
        );
        out
    }
}

fn is_running(app: &App, running: &[Running]) -> bool {
    running.iter().any(|r| {
        app.exes.iter().any(|m| fits(m, &r.exe, true))
            || app.cmds.iter().any(|(m, cmd)| {
                fits(m, &r.exe, true) && r.cmd.to_lowercase().contains(&cmd.to_lowercase())
            })
    })
}
