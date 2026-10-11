import { beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "../../api/client";
import type { ChildrenPage, Item } from "../../api/types";
import { ATTEMPTS, PAGE, TreeChanged, gather } from "./gather";
import type { ExportSource } from "./source";

vi.mock("../../api/client", () => ({
  api: {
    getCrumbs: vi.fn(),
    getChildren: vi.fn(),
    getDetails: vi.fn(),
    getSummary: vi.fn(),
  },
}));
const getChildren = vi.mocked(api.getChildren);
const getSummary = vi.mocked(api.getSummary);

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
      .mockResolvedValueOnce({ rev: 5 } as Awaited<ReturnType<typeof api.getSummary>>)
      .mockResolvedValue({ rev: 4 } as Awaited<ReturnType<typeof api.getSummary>>);
    await gather(source);
    expect(getSummary).toHaveBeenCalledTimes(2);
  });
});
