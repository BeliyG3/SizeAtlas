import { beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "../../api/client";
import type { ChildrenPage, Item, List, ListItem, Summary } from "../../api/types";
import { ATTEMPTS, LIVE_LIMIT, PAGE, TreeChanged, gather } from "./gather";
import type { ExportSource } from "./source";

vi.mock("../../api/client", () => ({
  api: {
    getCrumbs: vi.fn(),
    getChildren: vi.fn(),
    getDetails: vi.fn(),
    getSummary: vi.fn(),
    getList: vi.fn(),
  },
}));
const getChildren = vi.mocked(api.getChildren);
const getSummary = vi.mocked(api.getSummary);
const getList = vi.mocked(api.getList);

const summary = (rev: number, scanning = false, total = 0): Summary =>
  ({ rev, scanning, total, rootId: 0 }) as Summary;
const page = (rev: number, items: Item[], total = items.length): ChildrenPage =>
  ({ rev, items, total, size: items.reduce((sum, item) => sum + item.size, 0) }) as ChildrenPage;
const row = (id: number, size: number): ListItem => ({ ...item(id), size, parent: 0, folder: "" });

const item = (id: number): Item => ({
  id,
  name: `f${id}`,
  size: 1,
  len: 1,
  files: 0,
  dirs: 0,
  folders: 0,
  modified: 0,
  isDir: false,
  category: 0,
  accessError: false,
  cloud: false,
  lossy: false,
});

/** A folder of PAGE + 1 items: two pages; `revs` gives the revision of each call in turn. */
function folderWith(revs: number[]) {
  let call = 0;
  getChildren.mockImplementation(async (_g, _id, offset) => {
    const rev = revs[Math.min(call++, revs.length - 1)];
    const count = Math.min(PAGE, PAGE + 1 - offset);
    const items = Array.from({ length: count }, (_, i) => item(offset + i));
    return { rev, total: PAGE + 1, size: PAGE + 1, items } as ChildrenPage;
  });
}

const source: ExportSource = {
  kind: "folder",
  generation: 1,
  folder: 0,
  order: { key: "size", descending: true, dirsOnly: false },
  columns: ["name"],
};

beforeEach(() => {
  vi.mocked(api.getCrumbs).mockResolvedValue([{ id: 0, name: "C:\\", size: 0, rank: 0 }]);
  getChildren.mockReset();
  getSummary.mockReset();
  getList.mockReset();
});

describe("gather", () => {
  it("reads every page of the folder", async () => {
    folderWith([4]);
    getSummary.mockResolvedValue({ rev: 4 } as Awaited<ReturnType<typeof api.getSummary>>);
    const got = await gather(source);
    expect(got.items).toHaveLength(PAGE + 1);
    expect(got.pathOf(got.items[0])).toBe("C:\\f0");
  });

  it("starts again when a page comes from another revision", async () => {
    // First read: page 1 at rev 4, page 2 at rev 5; second read: both at rev 5.
    folderWith([4, 5, 5, 5]);
    getSummary.mockResolvedValue({ rev: 5 } as Awaited<ReturnType<typeof api.getSummary>>);
    const got = await gather(source);
    expect(getChildren).toHaveBeenCalledTimes(4);
    expect(getChildren.mock.calls[2][2]).toBe(0);
    expect(new Set(got.items.map((i) => i.id)).size).toBe(PAGE + 1);
  });

  it("gives up when the tree keeps changing", async () => {
    folderWith([1, 2, 3, 4, 5, 6, 7, 8]);
    getSummary.mockResolvedValue({ rev: 0 } as Awaited<ReturnType<typeof api.getSummary>>);
    await expect(gather(source)).rejects.toBeInstanceOf(TreeChanged);
    expect(getChildren).toHaveBeenCalledTimes(2 * ATTEMPTS);
  });

  it("starts again when the tree changed after the last page", async () => {
    folderWith([4]);
    getSummary
      .mockResolvedValueOnce(summary(4))
      .mockResolvedValueOnce(summary(5))
      .mockResolvedValue(summary(4));
    await gather(source);
    expect(getSummary).toHaveBeenCalledTimes(4);
  });

  it("accepts live revisions and reads current sizes in one sorted backend snapshot", async () => {
    getSummary
      .mockResolvedValueOnce(summary(4, true, 4))
      .mockResolvedValueOnce(summary(6, true, 13));
    getChildren.mockResolvedValueOnce(page(5, [row(3, 9), row(1, 3), row(2, 1)]));

    const got = await gather(source);

    expect(getChildren).toHaveBeenCalledExactlyOnceWith(1, 0, 0, LIVE_LIMIT, source.order);
    expect(got.items.map((item) => [item.id, item.size])).toEqual([
      [3, 9],
      [1, 3],
      [2, 1],
    ]);
    expect(got.folderSize).toBe(13);
  });

  it("preserves backend name and tie ordering instead of applying a locale comparator", async () => {
    getSummary.mockResolvedValue(summary(8, true, 20));
    const names = ["FILE10", "file10", "file2", "file20"];
    getChildren.mockResolvedValueOnce(
      page(
        7,
        names.map((name, id) => ({ ...item(id), name })),
      ),
    );

    const order = { ...source.order, key: "name" as const, descending: false };
    const got = await gather({ ...source, order });

    expect(got.items.map((item) => item.name)).toEqual(names);
    expect(getChildren).toHaveBeenCalledExactlyOnceWith(1, 0, 0, LIVE_LIMIT, order);
  });

  it("accepts a first scan finishing during export and uses the final folder size", async () => {
    getSummary
      .mockResolvedValueOnce(summary(4, true, 1))
      .mockResolvedValueOnce(summary(6, false, 10));
    getChildren.mockResolvedValue(page(6, [row(1, 8)]));
    vi.mocked(api.getCrumbs).mockResolvedValue([
      { id: 0, name: "C:\\", size: 1, rank: 0 },
      { id: 7, name: "folder", size: 1, rank: 0 },
    ]);

    const got = await gather({ ...source, folder: 7 });

    expect(got.folderSize).toBe(8);
    expect(got.pathOf(got.items[0])).toBe("C:\\folder\\f1");
    expect(getChildren).toHaveBeenCalledTimes(1);
  });

  it("retries when completion or a later edit invalidates the live snapshot", async () => {
    getSummary.mockResolvedValueOnce(summary(4, true)).mockResolvedValue(summary(6));
    getChildren
      .mockResolvedValueOnce(page(5, [row(1, 1)]))
      .mockResolvedValueOnce(page(6, [row(2, 8)]));

    const got = await gather(source);

    expect(got.items.map((item) => item.id)).toEqual([2]);
    expect(getChildren.mock.calls.map((call) => call[3])).toEqual([LIVE_LIMIT, PAGE]);
  });

  it("refreshes live list sizes while preserving the displayed row order", async () => {
    getSummary
      .mockResolvedValueOnce(summary(4, true, 3))
      .mockResolvedValueOnce(summary(6, true, 30));
    getList.mockResolvedValue({
      rev: 5,
      size: 20,
      items: [row(1, 12), row(2, 8)],
    } as List);
    const got = await gather({
      kind: "list",
      generation: 1,
      base: 0,
      list: "largest",
      rows: [row(2, 1), row(1, 2)],
      rev: 3,
      size: 3,
      columns: ["name"],
    });

    expect(got.items.map((item) => [item.id, item.size])).toEqual([
      [2, 8],
      [1, 12],
    ]);
    expect(got.folderSize).toBe(30);
    expect(getList).toHaveBeenCalledWith(1, 0, "largest", 2);
  });

  it("refreshes all counts for live rows displaced from a capped list", async () => {
    getSummary.mockResolvedValue(summary(4, true, 30));
    getList.mockResolvedValue({ rev: 4, size: 30, items: [row(3, 20)] } as List);
    getChildren.mockResolvedValue(
      page(4, [{ ...row(1, 8), isDir: true, len: 50, files: 3, dirs: 2 }]),
    );

    const got = await gather({
      kind: "list",
      generation: 1,
      base: 0,
      list: "largest",
      rows: [row(1, 2)],
      rev: 3,
      size: 3,
      columns: ["name"],
    });

    expect(got.items.map((item) => [item.id, item.size])).toEqual([[1, 8]]);
    expect(got.items[0]).toMatchObject({ len: 50, files: 3, dirs: 2 });
    expect(getChildren).toHaveBeenCalledExactlyOnceWith(1, 0, 0, LIVE_LIMIT, {
      key: "name",
      descending: false,
      dirsOnly: false,
    });
  });

  it("rejects a completed list assembled from different revisions", async () => {
    getSummary.mockResolvedValueOnce(summary(4, true)).mockResolvedValueOnce(summary(6));
    getList.mockResolvedValue({ rev: 5, size: 8, items: [row(2, 8)] } as List);
    getChildren.mockResolvedValue(page(6, [{ ...row(1, 3), files: 3 }]));

    await expect(
      gather({
        kind: "list",
        generation: 1,
        base: 0,
        list: "largest",
        rows: [row(1, 2)],
        rev: 3,
        size: 3,
        columns: ["name"],
      }),
    ).rejects.toBeInstanceOf(TreeChanged);
  });

  it("validates after reading the current live subfolder total", async () => {
    getSummary.mockResolvedValueOnce(summary(4, true)).mockResolvedValue(summary(6));
    getChildren
      .mockResolvedValueOnce(page(5, [row(1, 3)]))
      .mockResolvedValueOnce(page(6, [row(2, 8)]));
    vi.mocked(api.getCrumbs)
      .mockResolvedValueOnce([{ id: 7, name: "folder", size: 3, rank: 0 }])
      .mockImplementationOnce(async () => {
        expect(getSummary).toHaveBeenCalledTimes(1);
        return [{ id: 7, name: "folder", size: 8, rank: 0 }];
      });

    const got = await gather({ ...source, folder: 7 });

    expect(got.items.map((item) => item.id)).toEqual([2]);
    expect(got.folderSize).toBe(8);
    expect(getChildren).toHaveBeenCalledTimes(2);
  });

  it.each([false, true])(
    "checks the refreshed list revision after completion (changed: %s)",
    async (changed) => {
      getSummary
        .mockResolvedValueOnce(summary(4, true))
        .mockResolvedValueOnce(summary(changed ? 6 : 5));
      getList.mockResolvedValue({ rev: 5, size: 8, items: [row(1, 8)] } as List);
      const result = gather({
        kind: "list",
        generation: 1,
        base: 0,
        list: "largest",
        rows: [row(1, 2)],
        rev: 3,
        size: 3,
        columns: ["name"],
      });

      if (changed) await expect(result).rejects.toBeInstanceOf(TreeChanged);
      else expect((await result).items[0].size).toBe(8);
    },
  );

  it("still rejects a changed list when its tree is not scanning", async () => {
    getSummary.mockResolvedValue(summary(5));
    await expect(
      gather({
        kind: "list",
        generation: 1,
        base: 0,
        list: "largest",
        rows: [row(1, 2)],
        rev: 4,
        size: 2,
        columns: ["name"],
      }),
    ).rejects.toBeInstanceOf(TreeChanged);
    expect(getList).not.toHaveBeenCalled();
  });
});
