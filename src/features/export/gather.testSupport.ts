import { beforeEach, vi } from "vitest";
import { api } from "../../api/client";
import type { ChildrenPage, Item, ListItem, Summary } from "../../api/types";
import { PAGE } from "./gather";
import type { ExportSource } from "./source";

export const getChildren = vi.mocked(api.getChildren);
export const getSummary = vi.mocked(api.getSummary);
export const getList = vi.mocked(api.getList);

export const summary = (rev: number, scanning = false, total = 0): Summary =>
  ({ rev, scanning, total, rootId: 0 }) as Summary;
export const page = (rev: number, items: Item[], total = items.length): ChildrenPage =>
  ({ rev, items, total, size: items.reduce((sum, item) => sum + item.size, 0) }) as ChildrenPage;
export const row = (id: number, size: number): ListItem => ({
  ...item(id),
  size,
  parent: 0,
  folder: "",
  deleted: false,
});

export const item = (id: number): Item => ({
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
  before: null,
  change: null,
  approxChange: false,
});

/** A folder of PAGE + 1 items: two pages; `revs` gives the revision of each call in turn. */
export function folderWith(revs: number[]) {
  let call = 0;
  getChildren.mockImplementation(async (_g, _id, offset) => {
    const rev = revs[Math.min(call++, revs.length - 1)];
    const count = Math.min(PAGE, PAGE + 1 - offset);
    const items = Array.from({ length: count }, (_, i) => item(offset + i));
    return { rev, total: PAGE + 1, size: PAGE + 1, items } as ChildrenPage;
  });
}

export const source: Extract<ExportSource, { kind: "folder" }> = {
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
