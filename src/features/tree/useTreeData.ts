import { useCallback, useEffect, useRef, useState } from "react";
import { api, isCmdError } from "../../api/client";
import { ROOT_ID, type ChildrenPage, type Crumb, type ListOrder } from "../../api/types";
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
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set());
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(new Set());

  /** Loads a page of a folder; resolves to the page, or to undefined after a failure. */
  const load = useCallback(
    (generation: number, id: number, offset: number) =>
      api.getChildren(generation, id, offset, PAGE_SIZE, order).then(
        (page) => {
          setLoaded((map) => withPage(map, generation, id, page, offset));
          return page;
        },
        (e: unknown) => {
          onFail(e);
          return undefined;
        },
      ),
    [order, onFail],
  );

  // The first page of every tree, once (StrictMode's second run finds it requested).
  const started = useRef(new Set<number>());
  useEffect(() => {
    for (const { generation } of roots) {
      if (generation === null || started.current.has(generation)) continue;
      started.current.add(generation);
      void load(generation, ROOT_ID, 0);
    }
  }, [roots, load]);

  // A change of a tree (a refresh, a trash): its root and open folders load again and keep their
  // rows until then; closed folders of the old revision and folders that are gone are dropped,
  // all in one update. Once per revision (StrictMode runs this twice).
  const revs = useRef(new Map<number, number>());
  useEffect(() => {
    for (const { generation, rev } of roots) {
      if (generation === null) continue;
      const seen = revs.current.get(generation);
      revs.current.set(generation, rev);
      if (seen === undefined || seen >= rev) continue;
      const open = (id: number) => expanded.has(nodeKey(generation, id));
      const { requests, drop } = reloadPlan(pagesOf(loaded, generation), rev, open);
      const answers = requests.map((r) =>
        api.getChildren(generation, r.id, r.offset, r.limit, order).then(
          (page) => ({ r, page, error: null }),
          (error: unknown) => ({ r, page: null, error }),
        ),
      );
      void Promise.all(answers).then((done) => {
        setLoaded((map) =>
          done.reduce(
            (m, { r, page }) =>
              page ? withPage(m, generation, r.id, page, 0) : withoutFolders(m, generation, [r.id]),
            withoutFolders(map, generation, drop),
          ),
        );
        for (const { error } of done) {
          if (error !== null && !(isCmdError(error) && error.code === "StaleId")) onFail(error);
        }
      });
    }
  }, [roots, loaded, expanded, order, onFail]);

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
