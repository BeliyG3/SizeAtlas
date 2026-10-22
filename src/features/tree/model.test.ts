import { describe, expect, it } from "vitest";
import type { ChildrenPage, Crumb, Item } from "../../api/types";
import {
  buildRows,
  canExpand,
  keyTarget,
  mergePage,
  nodeKey,
  PAGE_SIZE,
  pagesOf,
  pagesToReveal,
  reloadPlan,
  rowKey,
  shouldReveal,
  withPage,
  withoutFolders,
  type Loaded,
  type LoadedRoots,
  type RootInfo,
  type Row,
} from "./model";

const item = (id: number, size: number, isDir = false): Item => ({
  id,
  name: `n${id}`,
  size,
  files: 1,
  isDir,
  category: isDir ? 255 : 7,
  len: size,
  dirs: isDir ? 1 : 0,
  folders: isDir ? 1 : 0,
  modified: 0,
  accessError: false,
  cloud: false,
  lossy: false,
  before: null,
  change: null,
  approxChange: false,
});

const page = (items: Item[], rest: number, rev = 0): ChildrenPage => ({
  generation: 1,
  rev,
  approximate: false,
  size: 100,
  total: items.length + rest,
  restCount: rest,
  restSize: rest * 10,
  items,
  baselineAt: null,
  baselineRev: 0,
  baselinePending: false,
});

const info = (root: string, generation: number | null, size = 120): RootInfo => ({
  root,
  label: root,
  generation,
  size,
  rev: 0,
  status: generation === null ? "queued" : "open",
  scanning: false,
  drive: false,
});

/** Pages of one root by folder id. */
const pages = (entries: [number, Loaded][]): ReadonlyMap<number, Loaded> => new Map(entries);
const first = (items: Item[], rest = 0) => mergePage(undefined, page(items, rest), 0);

describe("mergePage", () => {
  it("appends the next page", () => {
    const first = mergePage(undefined, page([item(1, 50), item(2, 40)], 1), 0);
    const second = mergePage(first, page([item(3, 30)], 0), 2);
    expect(second.items.map((i) => i.id)).toEqual([1, 2, 3]);
    expect(second.restCount).toBe(0);
  });

  it("keeps rows loaded beyond a late page", () => {
    const first = mergePage(undefined, page([item(1, 50), item(2, 40)], 3), 0);
    const all = mergePage(first, page([item(3, 30), item(4, 20)], 1), 2);
    const late = mergePage(all, page([item(1, 50), item(2, 40)], 3), 0);
    expect(late.items.map((i) => i.id)).toEqual([1, 2, 3, 4]);
    expect(late.restCount).toBe(1);
  });

  it("starts over when the page belongs to another revision", () => {
    const first = mergePage(undefined, page([item(1, 50)], 1, 0), 0);
    const other = mergePage(first, page([item(9, 99)], 0, 1), 1);
    expect(other.items.map((i) => i.id)).toEqual([9]);
  });
});

describe("pagesToReveal", () => {
  const crumb = (id: number, rank: number): Crumb => ({ id, name: `n${id}`, size: 1, rank });
  const rootWithTwo = () =>
    new Map<number, Loaded>([
      [0, mergePage(undefined, page([item(1, 50, true), item(2, 40)], 300), 0)],
    ]);

  it("loads whole pages up to the target in every folder on the path", () => {
    expect(pagesToReveal(rootWithTwo(), [crumb(0, 0), crumb(1, 0), crumb(7, 450)], 200)).toEqual([
      { id: 1, offset: 0, limit: 600 },
    ]);
    expect(pagesToReveal(rootWithTwo(), [crumb(0, 0), crumb(5, 250)], 200)).toEqual([
      { id: 0, offset: 2, limit: 400 },
    ]);
  });

  it("needs nothing when the target is already listed", () => {
    expect(pagesToReveal(rootWithTwo(), [crumb(0, 0), crumb(2, 1)], 200)).toEqual([]);
  });
});

describe("canExpand", () => {
  it("expands folders that have subfolders only", () => {
    expect(canExpand(item(1, 5, true))).toBe(true);
    expect(canExpand({ ...item(1, 5, true), folders: 0 })).toBe(false);
    expect(canExpand(item(2, 5))).toBe(false);
  });
});

describe("buildRows", () => {
  const label = (r: Row) =>
    r.kind === "more"
      ? `${r.depth}:more`
      : r.kind === "root"
        ? `${r.depth}:${r.info.root}`
        : `${r.depth}:${r.generation}/${r.item.id}`;

  it("lists each root, then its expanded folders depth-first with a show-more row", () => {
    const loaded: LoadedRoots = new Map([
      [
        1,
        pages([
          [0, first([item(1, 60, true), item(2, 40)], 2)],
          [1, first([item(3, 60)])],
        ]),
      ],
    ]);
    const rows = buildRows(
      [info("C:", 1), info("D:", null)],
      loaded,
      new Set([nodeKey(1, 1)]),
      new Set(),
    );
    expect(rows.map(label)).toEqual(["0:C:", "1:1/1", "2:1/3", "1:1/2", "1:more", "0:D:"]);
    expect(rows[0]).toMatchObject({ kind: "root", expanded: true, expandable: true });
    expect(rows[5]).toMatchObject({ kind: "root", expanded: false, expandable: false });
    const firstItem = rows[1];
    expect(firstItem.kind === "item" && firstItem.parentSize).toBe(120);
  });

  it("keeps the folders of each root apart, even with equal ids", () => {
    const loaded: LoadedRoots = new Map([
      [
        1,
        pages([
          [0, first([item(5, 60, true)])],
          [5, first([item(6, 10, true)])],
        ]),
      ],
      [
        2,
        pages([
          [0, first([item(5, 30, true)])],
          [5, first([item(7, 10, true)])],
        ]),
      ],
    ]);
    const rows = buildRows(
      [info("A", 1), info("B", 2)],
      loaded,
      new Set([nodeKey(2, 5)]),
      new Set(),
    );
    expect(rows.map(label)).toEqual(["0:A", "1:1/5", "0:B", "1:2/5", "2:2/7"]);
    expect(new Set(rows.map(rowKey)).size).toBe(rows.length);
  });

  it("hides the folders of a collapsed root only", () => {
    const loaded: LoadedRoots = new Map([
      [1, pages([[0, first([item(1, 60, true)])]])],
      [2, pages([[0, first([item(1, 60, true)])]])],
    ]);
    const rows = buildRows([info("A", 1), info("B", 2)], loaded, new Set(), new Set(["A"]));
    expect(rows.map(label)).toEqual(["0:A", "0:B", "1:2/1"]);
    expect(rows[0]).toMatchObject({ expanded: false, expandable: true });
  });

  it("shows a root alone until its folders are loaded, and no expander without folders", () => {
    expect(buildRows([info("A", 1)], new Map(), new Set(), new Set()).map(label)).toEqual(["0:A"]);
    const empty: LoadedRoots = new Map([[1, pages([[0, first([])]])]]);
    const [only] = buildRows([info("A", 1)], empty, new Set(), new Set());
    expect(only.kind === "root" && only.expandable).toBe(false);
  });
});

describe("rowKey", () => {
  it("names a root by its path, safe for DOM ids, and folders by generation and id", () => {
    const loaded: LoadedRoots = new Map([[3, pages([[0, first([item(1, 60)], 5)]])]]);
    const rows = buildRows([info('C:\\My "Files"', 3, 60)], loaded, new Set(), new Set());
    expect(rows.map(rowKey)).toEqual(["root:C%3A%5CMy%20%22Files%22", "3:1", "more-3:0"]);
  });
});

describe("withPage", () => {
  it("adds a page to one root and keeps the others", () => {
    const one = withPage(new Map(), 1, 0, page([item(1, 50)], 0), 0);
    const two = withPage(one, 2, 0, page([item(9, 5)], 0), 0);
    expect(
      pagesOf(two, 1)
        .get(0)
        ?.items.map((i) => i.id),
    ).toEqual([1]);
    expect(
      pagesOf(two, 2)
        .get(0)
        ?.items.map((i) => i.id),
    ).toEqual([9]);
    expect(pagesOf(two, 3).size).toBe(0);
  });
});

describe("shouldReveal", () => {
  const loaded: LoadedRoots = new Map([
    [
      1,
      pages([
        [0, first([item(1, 60, true)])],
        [1, first([item(3, 60)])],
      ]),
    ],
  ]);
  const roots = [info("r", 1, 60)];

  it("skips a target that is focused and visible", () => {
    const rows = buildRows(roots, loaded, new Set([nodeKey(1, 1)]), new Set());
    expect(shouldReveal("1:3", rows, "1:3")).toBe(false);
  });

  it("reveals a focused target hidden by a collapsed ancestor", () => {
    expect(shouldReveal("1:3", buildRows(roots, loaded, new Set(), new Set()), "1:3")).toBe(true);
  });

  it("reveals a target that is not focused", () => {
    const rows = buildRows(roots, loaded, new Set([nodeKey(1, 1)]), new Set());
    expect(shouldReveal("1:1", rows, "1:3")).toBe(true);
    expect(shouldReveal(null, rows, "1:3")).toBe(true);
  });
});

describe("keyTarget", () => {
  it("moves by one, by a page and to the ends, staying in the list", () => {
    expect(keyTarget("ArrowDown", 3, 10)).toBe(4);
    expect(keyTarget("ArrowUp", 0, 10)).toBe(0);
    expect(keyTarget("PageDown", 3, 10)).toBe(9);
    expect(keyTarget("PageUp", 25, 30)).toBe(5);
    expect(keyTarget("Home", 7, 10)).toBe(0);
    expect(keyTarget("End", 2, 10)).toBe(9);
    expect(keyTarget("ArrowDown", -1, 10)).toBe(0);
  });

  it("ignores other keys", () => {
    expect(keyTarget("Enter", 3, 10)).toBeUndefined();
    expect(keyTarget("toString", 3, 10)).toBeUndefined();
  });
});

describe("loading again after a change", () => {
  it("asks again for the root and the open folders, as many rows as they show", () => {
    const many = Array.from({ length: 250 }, (_, i) => item(i + 10, 1));
    const loaded = pages([
      [0, first([item(1, 50, true)])],
      [1, first(many, 5)],
      [2, mergePage(undefined, page([item(3, 1)], 0, 4), 0)],
      [7, first([item(8, 1)])],
    ]);
    const open = (id: number) => id === 1;
    expect(reloadPlan(loaded, 4, open)).toEqual({
      requests: [
        { id: 0, offset: 0, limit: PAGE_SIZE },
        { id: 1, offset: 0, limit: 2 * PAGE_SIZE },
      ],
      // Closed folders of an older revision are dropped: they load when opened.
      drop: [7],
    });
  });

  it("forgets folders and keeps the others", () => {
    const loaded: LoadedRoots = new Map([
      [
        1,
        pages([
          [0, first([item(1, 5, true)])],
          [1, first([item(2, 5)])],
        ]),
      ],
    ]);
    expect([...pagesOf(withoutFolders(loaded, 1, [1]), 1).keys()]).toEqual([0]);
    expect(withoutFolders(loaded, 1, [9])).toBe(loaded);
    expect(withoutFolders(loaded, 7, [1])).toBe(loaded);
  });

  it("keeps a newer revision when an older page arrives late", () => {
    const newer = mergePage(undefined, page([item(1, 5)], 0, 3), 0);
    expect(mergePage(newer, page([item(2, 5)], 0, 2), 0)).toBe(newer);
    expect(mergePage(newer, page([item(2, 5)], 0, 4), 0).rev).toBe(4);
  });
});
