import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { api, isCmdError } from "../../api/client";
import { ROOT_ID, type ChildrenPage, type Crumb, type ListOrder } from "../../api/types";
import { useBatchCost } from "../scan/useBatchCost";
import {
  PAGE_SIZE,
  nodeKey,
  pagesOf,
  reloadPlan,
  withPage,
  withoutFolders,
  type LoadedRoots,
  type PageRequest,
  type RootInfo,
} from "./model";

function toggled<T>(set: ReadonlySet<T>, value: T, on: boolean): ReadonlySet<T> {
  const next = new Set(set);
  if (on) next.add(value);
  else next.delete(value);
  return next;
}

/**
 * Loaded pages, expanded folders and collapsed roots of the folder tree, for one sort order.
 * Each open root gets its first page once per tree; roots start expanded.
 */
export function useTreeData(
  roots: readonly RootInfo[],
  order: ListOrder,
  onFail: (e: unknown) => void,
) {
  // ponytail: pages of closed and replaced roots stay until the tree is remounted (another
  // sort); a few pages each. Drop the generations that left `roots` if that ever matters.
  const [loaded, setLoaded] = useState<LoadedRoots>(new Map());
  const measure = useBatchCost("tree", loaded);
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set());
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(new Set());

  const lifecycle = useRef({ live: false });
  const pending = useRef(
    new Map<number, { live: boolean; rev: number; life: { live: boolean } }>(),
  );
  const seen = useRef(new Map<number, number>());
  const active = useRef(new Set<number>());
  const expandedNow = useRef(expanded);
  useLayoutEffect(() => {
    expandedNow.current = expanded;
  }, [expanded]);
  useLayoutEffect(() => {
    active.current = new Set(roots.flatMap((r) => (r.generation === null ? [] : [r.generation])));
  }, [roots]);
  useEffect(() => {
    const life = { live: true };
    lifecycle.current = life;
    return () => {
      life.live = false;
    };
  }, []);

  /** Loads a page of a folder; resolves to the page, or to undefined after a failure. */
  const load = useCallback(
    (generation: number, id: number, offset: number) => {
      const life = lifecycle.current;
      return api.getChildren(generation, id, offset, PAGE_SIZE, order).then(
        (page) => {
          if (!life.live || !active.current.has(generation)) return undefined;
          setLoaded((map) => withPage(map, generation, id, page, offset));
          return page;
        },
        (e: unknown) => {
          if (life.live && active.current.has(generation)) onFail(e);
          return undefined;
        },
      );
    },
    [order, onFail],
  );

  // Let each root's active batch land before planning its next revision from fresh pages.
  // The lifetime flag lets StrictMode restart a batch invalidated by its effect cleanup.
  useEffect(() => {
    const life = lifecycle.current;
    for (const [generation, request] of pending.current) {
      if (!active.current.has(generation)) {
        request.live = false;
        pending.current.delete(generation);
      }
    }
    for (const { generation, rev } of roots) {
      if (generation === null) continue;
      const pages = pagesOf(loaded, generation);
      // A folder reopened during the last batch kept its rows, but still needs this
      // revision even when the root's batch has already been marked as seen.
      if (
        (seen.current.get(generation) ?? -1) >= rev &&
        ![...pages].some(
          ([id, page]) =>
            page.rev < rev && (id === ROOT_ID || expanded.has(nodeKey(generation, id))),
        )
      ) {
        continue;
      }
      const old = pending.current.get(generation);
      if (old?.live && old.life.live) continue;
      if (old) old.live = false;
      const signal = { live: true, rev, life };
      const applied = measure();
      pending.current.set(generation, signal);
      const { requests, drop } = reloadPlan(pages, rev, (id) =>
        expanded.has(nodeKey(generation, id)),
      );
      if (!pages.has(ROOT_ID)) requests.unshift({ id: ROOT_ID, offset: 0, limit: PAGE_SIZE });
      const answers = requests.map((r) =>
        api.getChildren(generation, r.id, r.offset, r.limit, order).then(
          (page) => ({ r, page, error: null }),
          (error: unknown) => ({ r, page: null, error }),
        ),
      );
      void Promise.all(answers).then((done) => {
        if (!life.live || !signal.live || !active.current.has(generation)) {
          signal.live = false;
          return;
        }
        seen.current.set(generation, rev);
        pending.current.delete(generation);
        applied();
        setLoaded((map) => {
          const stillClosed = drop.filter(
            (id) => !expandedNow.current.has(nodeKey(generation, id)),
          );
          const next = done.reduce(
            (m, { r, page }) =>
              page ? withPage(m, generation, r.id, page, 0) : withoutFolders(m, generation, [r.id]),
            withoutFolders(map, generation, stillClosed),
          );
          // Even an empty or failed batch must schedule a revision received while it ran.
          return next === map ? new Map(map) : next;
        });
        for (const { error } of done) {
          if (error !== null && !(isCmdError(error) && error.code === "StaleId")) onFail(error);
        }
      });
    }
  }, [roots, loaded, expanded, order, onFail, measure]);

  const toggleRoot = (root: string) => setCollapsed((set) => toggled(set, root, !set.has(root)));

  const toggleFolder = (generation: number, id: number) => {
    const key = nodeKey(generation, id);
    const opening = !expanded.has(key);
    setExpanded((set) => toggled(set, key, opening));
    if (opening && !pagesOf(loaded, generation).has(id)) void load(generation, id, 0);
  };

  /** Shows the end of `crumbs`: adds the pages fetched for it, expands its root and the folders on the way. */
  const showPath = useCallback(
    (
      root: string,
      generation: number,
      crumbs: readonly Crumb[],
      requests: readonly PageRequest[],
      pages: readonly ChildrenPage[],
    ) => {
      if (requests.length > 0) {
        setLoaded((map) =>
          requests.reduce((m, r, i) => withPage(m, generation, r.id, pages[i], r.offset), map),
        );
      }
      // crumbs[0] is the root itself: roots expand through `collapsed`.
      const folders = crumbs.slice(1, -1).map((c) => nodeKey(generation, c.id));
      setExpanded((set) => new Set([...set, ...folders]));
      setCollapsed((set) => toggled(set, root, false));
    },
    [],
  );

  return { loaded, expanded, collapsed, load, toggleRoot, toggleFolder, showPath };
}
