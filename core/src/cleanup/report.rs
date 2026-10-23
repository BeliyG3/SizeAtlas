//! Matched items to rows and info: what they hold, their age and size, running apps.

use super::markers::locks;
use super::paths::fits;
use super::walk::{Found, Walk};
use super::{Age, App, Cleanup, Info, Mode, Reason, Row, Rule, is_old};

/// Temp items larger than this go to Review.
const LARGE: u64 = 1 << 30;

impl Walk<'_> {
    pub(super) fn finish(self) -> Cleanup {
        let mut out = Cleanup::default();
        let path = |id| self.tree.path(id).to_string_lossy().into_owned();
        let no_access = |id| Info::NoAccess { path: path(id) };
        out.info
            .extend(self.unreadable.iter().map(|&id| no_access(id)));
        let mut running: Vec<(&'static App, u64)> = Vec::new();
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
            if let Some(app) = rule.app.filter(|app| self.is_running(app)) {
                let size = self.tree.node(found.id).size;
                match running.iter_mut().find(|(a, _)| a.name == app.name) {
                    Some((_, total)) => *total += size,
                    None => running.push((app, size)),
                }
                continue;
            }
            let row = Row {
                id: found.id,
                mode,
                reason,
                command: rule.command,
                restorable: locks(reason).map(|names| self.beside(found.id, names)),
            };
            match mode {
                Mode::Cleanup => out.cleanup.push(row),
                Mode::Review => out.review.push(row),
            }
        }
        out.info
            .extend(running.into_iter().map(|(app, size)| Info::AppRunning {
                app: app.name,
                size,
            }));
        out.approximate = out.info.iter().any(|i| matches!(i, Info::NoAccess { .. }));
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

    fn is_running(&self, app: &App) -> bool {
        self.ctx.running.iter().any(|r| {
            app.exes.iter().any(|m| fits(m, &r.exe, true))
                && app
                    .cmd
                    .is_none_or(|cmd| r.cmd.to_lowercase().contains(&cmd.to_lowercase()))
        })
    }
}
