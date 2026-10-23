//! One iterative walk over the tree: known places and zones are tracked as partial matches of
//! component patterns, a matched item is walked as a whole to check what it holds, and its
//! subtree is closed for every other rule.

use super::markers::WORK_NAMES;
use super::names::{Names, lower};
use super::never::{PROTECTED, add_never, add_spots};
use super::paths::{components, fits};
use super::pattern::{Hit, Pattern, State, add, ended, is_never, start, step};
use super::zones::{ZONE_NAMES, add_zones, anywhere_allowed};
use super::{Cleanup, Context, Marker, Place, Rule, Spot, Target};
use crate::tree::{Tree, flags};

/// A matched item and what its subtree holds.
pub(super) struct Found {
    pub id: u32,
    pub rule: usize,
    pub busy: bool,
    pub unreadable: bool,
    pub cloud: bool,
    pub blocked: bool,
    pub work: bool,
}

pub(super) struct Walk<'a> {
    pub tree: &'a Tree,
    pub ctx: &'a Context,
    pub rules: &'a [Rule],
    patterns: Vec<Pattern<'a>>,
    /// The "anywhere" rules with their target masks; empty when such rules are off.
    anywhere: Vec<(usize, Names)>,
    pub found: Vec<Found>,
    /// Unreadable folders on the way to a rule's place, the first one per rule.
    pub unreadable: Vec<u32>,
    reported: Vec<bool>,
}

/// A node to visit: the partial matches of its parent, whether "anywhere" rules are off there,
/// and the matched item it lies in.
struct Visit {
    id: u32,
    state: State,
    zone: bool,
    inside: Option<usize>,
}

pub(crate) fn run(tree: &Tree, ctx: &Context, rules: &[Rule], spots: &[Spot]) -> Cleanup {
    let (os, known) = (ctx.os, &ctx.known);
    let mut patterns = Vec::new();
    let mut anywhere = Vec::new();
    for (i, rule) in rules.iter().enumerate() {
        let mask = target_mask(rule.target);
        match rule.place {
            Place::At(at, path) => add(
                &mut patterns,
                (os, known),
                (at, path, Some(mask)),
                Hit::Rule(i as u32),
            ),
            Place::Anywhere => anywhere.push((i, Names::new(&[mask], os.folds()))),
        }
    }
    if !anywhere_allowed(ctx) {
        anywhere.clear();
    }
    add_never(&mut patterns, os, known);
    add_zones(&mut patterns, os, known);
    add_spots(&mut patterns, os, known, spots);
    let mut walk = Walk {
        tree,
        ctx,
        rules,
        patterns,
        anywhere,
        found: Vec::new(),
        unreadable: Vec::new(),
        reported: vec![false; rules.len()],
    };
    walk.walk();
    walk.finish()
}

fn target_mask(target: Target) -> &'static str {
    match target {
        Target::Dir(m) | Target::File(m) | Target::Any(m) => m,
    }
}

impl Walk<'_> {
    fn walk(&mut self) {
        let root = self.tree.node(0);
        if root.has(flags::PENDING | flags::SCANNING) {
            return;
        }
        // The root's name is a whole path: feed it component by component. A never place, a
        // protected name or a match on the way means the whole tree lies inside one.
        let mut buf = String::new();
        let mut state = start(&self.patterns);
        let mut zone = false;
        for name in components(self.ctx.os, self.tree.name(0)) {
            state = step(&self.patterns, &state, name);
            let (here_zone, rules) = self.hits(&state);
            let low = lower(name, &mut buf);
            if is_never(&self.patterns, &state) || PROTECTED.has(low) || !rules.is_empty() {
                return;
            }
            zone |= here_zone || ZONE_NAMES.has(low);
        }
        zone |= root.has(flags::CLOUD);
        self.report_unreadable(0, &state);
        let mut stack: Vec<Visit> = Vec::new();
        self.push_children(&mut stack, 0, &state, zone, None);
        while let Some(visit) = stack.pop() {
            self.visit(visit, &mut stack, &mut buf);
        }
    }

    /// `buf` is reused for the lower-cased name of each node.
    fn visit(&mut self, visit: Visit, stack: &mut Vec<Visit>, buf: &mut String) {
        let (id, tree) = (visit.id, self.tree);
        let (node, name) = (tree.node(id), tree.name(id));
        let state = step(&self.patterns, &visit.state, name);
        let low = lower(name, buf);
        let never = is_never(&self.patterns, &state) || PROTECTED.has(low);
        if let Some(at) = visit.inside {
            self.note(at, id, low, never);
            self.push_children(stack, id, &state, true, Some(at));
            return;
        }
        if never || node.has(flags::PENDING | flags::SCANNING) {
            return;
        }
        let (here_zone, hits) = self.hits(&state);
        let zone = visit.zone || here_zone || ZONE_NAMES.has(low) || node.has(flags::CLOUD);
        let target = if self.ctx.os.folds() { low } else { name };
        if let Some(rule) = self.pick(id, target, hits, zone) {
            self.found.push(Found {
                id,
                rule,
                busy: false,
                unreadable: false,
                cloud: false,
                blocked: false,
                work: false,
            });
            self.note(self.found.len() - 1, id, low, false);
            self.push_children(stack, id, &state, true, Some(self.found.len() - 1));
            return;
        }
        self.report_unreadable(id, &state);
        self.push_children(stack, id, &state, zone, None);
    }

    /// Records what node `id`, lower-cased name `low`, adds to the matched item `at`.
    fn note(&mut self, at: usize, id: u32, low: &str, never: bool) {
        let node = self.tree.node(id);
        let found = &mut self.found[at];
        found.blocked |= never;
        found.busy |= node.has(flags::PENDING | flags::SCANNING);
        found.unreadable |= node.has(flags::ACCESS_ERROR);
        found.cloud |= node.has(flags::CLOUD);
        found.work |= WORK_NAMES.has(low);
    }

    fn push_children(
        &self,
        stack: &mut Vec<Visit>,
        id: u32,
        state: &State,
        zone: bool,
        inside: Option<usize>,
    ) {
        // Patterns that ended here can go no deeper.
        let state: State = state
            .iter()
            .copied()
            .filter(|&(p, m)| self.patterns[p as usize].comps.len() > m as usize)
            .collect();
        for child in self.tree.children(id) {
            stack.push(Visit {
                id: child,
                state: state.clone(),
                zone,
                inside,
            });
        }
    }

    /// Whether a zone starts at the node of `state`, and the rules whose place ends there.
    fn hits(&self, state: &State) -> (bool, Vec<usize>) {
        let (mut zone, mut open, mut rules) = (false, false, Vec::new());
        for hit in ended(&self.patterns, state) {
            match hit {
                Hit::Zone => zone = true,
                Hit::ZoneOpen => open = true,
                Hit::Rule(i) => rules.push(i as usize),
                Hit::Never | Hit::Open => {}
            }
        }
        (zone && !open, rules)
    }

    /// The first rule, in table order, that node `id` fits with its marker. `name` is compared
    /// with the targets of "anywhere" rules (lower-cased where the OS folds case).
    fn pick(&self, id: u32, name: &str, mut rules: Vec<usize>, zone: bool) -> Option<usize> {
        if !zone {
            let fit = self.anywhere.iter().filter(|(_, target)| target.has(name));
            rules.extend(fit.map(|&(i, _)| i));
        }
        rules.sort_unstable();
        rules.dedup();
        rules
            .into_iter()
            .find(|&i| self.fits_rule(id, &self.rules[i]))
    }

    fn fits_rule(&self, id: u32, rule: &Rule) -> bool {
        let (tree, fold) = (self.tree, self.ctx.os.folds());
        let is_dir = tree.node(id).is_dir();
        let kind = match rule.target {
            Target::Dir(_) => is_dir,
            Target::File(_) => !is_dir,
            Target::Any(_) => true,
        };
        let has = |at: u32, name: &str| tree.children(at).any(|c| fits(name, tree.name(c), fold));
        kind && match rule.marker {
            None => true,
            Some(Marker::Sibling(name)) => has(tree.node(id).parent, name),
            Some(Marker::Inside(name)) => is_dir && has(id, name),
            Some(Marker::Only(masks)) => {
                is_dir
                    && tree.children(id).all(|c| {
                        !tree.node(c).is_dir() && masks.iter().any(|m| fits(m, tree.name(c), fold))
                    })
            }
        }
    }

    /// An unreadable folder on the way to a rule's place, which may be missing because of it.
    /// Reported once per rule, at the first such folder.
    fn report_unreadable(&mut self, id: u32, state: &State) {
        if !self.tree.node(id).has(flags::ACCESS_ERROR) {
            return;
        }
        let mut new = false;
        for &(p, m) in state {
            let pattern = &self.patterns[p as usize];
            if let Hit::Rule(i) = pattern.hit
                && pattern.comps.len() > m as usize
                && !self.reported[i as usize]
            {
                self.reported[i as usize] = true;
                new = true;
            }
        }
        if new {
            self.unreadable.push(id);
        }
    }
}
