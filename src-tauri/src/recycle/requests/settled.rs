//! The folder times the removals of a root gave, kept while the root has requests: a request
//! planned before a removal changed a folder still finds the folder as it planned it.

use std::path::Path;

use crate::state::AppState;

impl AppState {
    /// A removal in `root` changed the time of `folder` from `before` to `after`. Kept only while
    /// the root has requests.
    pub(crate) fn note_settled(&self, root: &str, folder: &Path, before: i64, after: i64) {
        let mut requests = self.requests();
        if before == after || !requests.entries.iter().any(|e| e.root == root) {
            return;
        }
        let times = requests.settled.entry(root.to_owned()).or_default();
        times
            .entry(folder.to_owned())
            .or_default()
            .push((before, after));
    }

    /// The times `folder` of `root` may have now if it had `stored` and only the removals of
    /// this app changed it since: `stored` first, then each time a removal gave it after one of
    /// those (`before → after1 → after2`).
    pub(crate) fn settled_times(&self, root: &str, folder: &Path, stored: i64) -> Vec<i64> {
        let requests = self.requests();
        let mut times = vec![stored];
        let Some(changes) = requests.settled.get(root).and_then(|f| f.get(folder)) else {
            return times;
        };
        let mut at = 0;
        while let Some(&time) = times.get(at) {
            for &(before, after) in changes {
                if before == time && !times.contains(&after) {
                    times.push(after);
                }
            }
            at += 1;
        }
        times
    }
}
