//! One iterative walk over the tree: known places and zones are tracked as partial matches of
//! component patterns, a matched item is walked as a whole to check what it holds, and its
//! subtree is closed for every other rule.

use super::markers::WORK_NAMES;
use super::names::{Names, lower};
use super::never::{PROTECTED, add_never};
use super::paths::{Hit, Pattern, State, add, components, ended, fits, is_never, step};
use super::zones::{ZONE_NAMES, add_zones};
use super::{Cleanup, Context, Marker, Os, Place, Rule, Target};
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
    /// The "anywhere" rules with their target masks.
    anywhere: Vec<(usize, Names)>,
    pub fold: bool,
    pub found: Vec<Found>,
    /// Unreadable folders on the way to a rule's place.
    pub unreadable: Vec<u32>,
    /// The lower-cased name of the node being visited.
    buf: String,
}

/// A node to visit: the partial matches of its parent, whether "anywhere" rules are off there,
/// and the matched item it lies in.
struct Visit {
    id: u32,
    state: State,
    zone: bool,
    inside: Option<usize>,
}

pub(crate) fn run(tree: &Tree, ctx: &Context, rules: &[Rule]) -> Cleanup {
    let mut patterns = Vec::new();
    let mut anywhere = Vec::new();
    for (i, rule) in rules.iter().enumerate() {
        match rule.place {
            Place::At(at, path) => add(
                &mut patterns,
                (ctx.os, &ctx.known),
                (at, path, Some(target_mask(rule.target))),
                Hit::Rule(i as u32),
            ),
            Place::Anywhere => {
                let fold = ctx.os == Os::Windows;
                anywhere.push((i, Names::new(&[target_mask(rule.target)], fold)));
            }
        }
    }
    add_never(&mut patterns, ctx.os, &ctx.known);
    add_zones(&mut patterns, ctx.os, &ctx.known);
    let mut walk = Walk {
        tree,
        ctx,
        rules,
        patterns,
        anywhere,
        fold: ctx.os == Os::Windows,
        found: Vec::new(),
        unreadable: Vec::new(),
        buf: String::new(),
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
        let mut state: State = (0..self.patterns.len() as u32).map(|p| (p, 0)).collect();
        let mut zone = false;
        for name in components(self.ctx.os, self.tree.name(0)) {
            state = step(&self.patterns, &state, name, self.fold);
            let (here_zone, rules) = self.hits(&state);
            let low = lower(name, &mut self.buf);
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
            self.visit(visit, &mut stack);
        }
    }

    fn visit(&mut self, visit: Visit, stack: &mut Vec<Visit>) {
        let (id, tree) = (visit.id, self.tree);
        let (node, name) = (tree.node(id), tree.name(id));
        let state = step(&self.patterns, &visit.state, name, self.fold);
        let low = lower(name, &mut self.buf);
        let (protected, zone_name) = (PROTECTED.has(low), ZONE_NAMES.has(low));
        let never = is_never(&self.patterns, &state) || protected;
        if let Some(at) = visit.inside {
            self.note(at, id, never);
            self.push_children(stack, id, &state, true, Some(at));
            return;
        }
        if never || node.has(flags::PENDING | flags::SCANNING) {
            return;
        }
        let (here_zone, hits) = self.hits(&state);
        let zone = visit.zone || here_zone || zone_name || node.has(flags::CLOUD);
        if let Some(rule) = self.pick(id, hits, zone) {
            self.found.push(Found {
                id,
                rule,
                busy: false,
                unreadable: false,
                cloud: false,
                blocked: false,
                work: false,
            });
            let at = self.found.len() - 1;
            self.note(at, id, false);
            self.push_children(stack, id, &state, true, Some(at));
            return;
        }
        self.report_unreadable(id, &state);
        self.push_children(stack, id, &state, zone, None);
    }

    /// Records what node `id` adds to the matched item `at`; `self.buf` holds its lower name.
    fn note(&mut self, at: usize, id: u32, never: bool) {
        let node = self.tree.node(id);
        let found = &mut self.found[at];
        found.blocked |= never;
        found.busy |= node.has(flags::PENDING | flags::SCANNING);
        found.unreadable |= node.has(flags::ACCESS_ERROR);
        found.cloud |= node.has(flags::CLOUD);
        found.work |= WORK_NAMES.has(&self.buf);
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

    /// The first rule, in table order, that node `id` fits with its marker; `self.buf` holds
    /// its lower name.
    fn pick(&self, id: u32, hits: Vec<usize>, zone: bool) -> Option<usize> {
        let name = if self.fold {
            &self.buf
        } else {
            self.tree.name(id)
        };
        let mut rules = hits;
        if !zone && self.ctx.recyclable {
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
        let tree = self.tree;
        let is_dir = tree.node(id).is_dir();
        let kind = match rule.target {
            Target::Dir(_) => is_dir,
            Target::File(_) => !is_dir,
            Target::Any(_) => true,
        };
        let has = |at: u32, name: &str| {
            tree.children(at)
                .any(|c| fits(name, tree.name(c), self.fold))
        };
        kind && match rule.marker {
            None => true,
            Some(Marker::Sibling(name)) => has(tree.node(id).parent, name),
            Some(Marker::Inside(name)) => is_dir && has(id, name),
            Some(Marker::Only(masks)) => {
                is_dir
                    && tree.children(id).all(|c| {
                        !tree.node(c).is_dir()
                            && masks.iter().any(|m| fits(m, tree.name(c), self.fold))
                    })
            }
        }
    }

    /// An unreadable folder on the way to a rule's place: the place itself may be missing.
    fn report_unreadable(&mut self, id: u32, state: &State) {
        let on_way = state.iter().any(|&(p, m)| {
            let pattern = &self.patterns[p as usize];
            matches!(pattern.hit, Hit::Rule(_)) && pattern.comps.len() > m as usize
        });
        if on_way && self.tree.node(id).has(flags::ACCESS_ERROR) {
            self.unreadable.push(id);
        }
    }
}
