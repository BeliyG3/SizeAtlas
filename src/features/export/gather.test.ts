import { describe, expect, it, vi } from "vitest";
import { api } from "../../api/client";
import { ATTEMPTS, PAGE, TreeChanged, gather } from "./gather";
import {
  folderWith,
  getChildren,
  getList,
  getSummary,
  row,
  source,
  summary,
} from "./gather.testSupport";

vi.mock("../../api/client", () => ({
  api: {
    getCrumbs: vi.fn(),
    getChildren: vi.fn(),
    getDetails: vi.fn(),
    getSummary: vi.fn(),
    getList: vi.fn(),
  },
}));

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

  it("reads no details of a deleted folder: its id is not a node", async () => {
    getSummary.mockResolvedValue(summary(4));
    const getDetails = vi.mocked(api.getDetails).mockResolvedValue({ generation: 1, items: [] });
    const gone = { ...row(4294967295, 0), deleted: true };
    const got = await gather({
      kind: "list",
      generation: 1,
      base: 0,
      list: "grewMost",
      rows: [row(1, 2), gone],
      rev: 4,
      size: 2,
      columns: ["name", "created"],
    });
    expect(got.items).toHaveLength(2);
    expect(getDetails).toHaveBeenCalledWith(1, [1]);
  });
});
