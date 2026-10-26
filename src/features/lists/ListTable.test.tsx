import type { ReactElement } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "../../api/client";
import type { List, ListItem } from "../../api/types";
import {
  answer,
  grid,
  onEnter,
  onMarks,
  onOpenFolder,
  onTrash,
  press,
  render,
  resetTable,
  row,
  settle,
  shown,
  summary,
  textOf,
} from "./ListTable.harness";

vi.mock("react", async (original) => ({
  ...(await original<typeof import("react")>()),
  ...(await import("./hookRuntime")).rt.hooks,
}));
vi.mock("../../api/client", () => ({ api: { getList: vi.fn() } }));
// The mocked `useContext` answers every context with a function: nothing is being removed.
vi.mock("../trash/moving", () => ({ useMoving: () => () => undefined }));
vi.mock("../../i18n/react", () => ({
  useT: () => ({
    t: (key: string, params?: Record<string, unknown>) =>
      params ? `${key} ${JSON.stringify(params)}` : key,
    lang: "en",
  }),
}));

beforeEach(resetTable);

describe("ListTable for a search", () => {
  it("asks for the query and again when it changes", async () => {
    vi.mocked(api.getList).mockResolvedValue(answer({ count: 0, size: 0 }));
    await settle("backup");
    expect(api.getList).toHaveBeenLastCalledWith(1, 1, "search", 1000, "backup");
    await settle("*.mp4");
    expect(api.getList).toHaveBeenCalledTimes(2);
    expect(api.getList).toHaveBeenLastCalledWith(1, 1, "search", 1000, "*.mp4");
  });

  it("shows the totals of all matches above the rows", async () => {
    vi.mocked(api.getList).mockResolvedValue(answer({ count: 1234, size: 2048 }));
    await settle("backup");
    expect(textOf("found")).toEqual([
      'search.found {"count":1234,"items":"1,234","size":"2.00 KB"}',
    ]);
  });

  it("says nothing was found and shows no totals", async () => {
    vi.mocked(api.getList).mockResolvedValue(answer({ count: 0, size: 0 }));
    await settle("zzz");
    expect(textOf("found")).toEqual([]);
    expect(JSON.stringify(shown)).toContain("search.none");
  });

  it("drops the answer to an older query that arrives late", async () => {
    const pending = new Map<string, (list: List) => void>();
    vi.mocked(api.getList).mockImplementation(
      (...args) => new Promise((resolve) => pending.set(args[4]!, resolve)),
    );
    render("ab");
    render("abc");
    pending.get("abc")!(answer({ count: 3, size: 2048 }));
    await Promise.resolve();
    pending.get("ab")!(answer({ count: 9, size: 4096 }));
    await Promise.resolve();
    render("abc");
    expect(textOf("found")).toEqual([expect.stringContaining('"count":3')]);
  });

  it("keeps no marks of one query on the results of another", async () => {
    const pending = new Map<string, (list: List) => void>();
    vi.mocked(api.getList).mockImplementation(
      (...args) => new Promise((resolve) => pending.set(args[4]!, resolve)),
    );
    render("a");
    pending.get("a")!(answer({ count: 2, size: 2 }, [row(1), row(2)]));
    await Promise.resolve();
    render("a");
    press({ ctrlKey: true, code: "KeyA" });
    render("a");
    expect(onMarks).toHaveBeenLastCalledWith([1, 2], false, null);

    expect(textOf("crows")).toHaveLength(1);
    expect(textOf("stale")).toEqual([]);

    // The new query is loading: the old rows and their marks are still on screen, dimmed.
    render("ab");
    expect(onMarks).toHaveBeenLastCalledWith([1, 2], false, null);
    expect(textOf("stale")).toHaveLength(1);
    pending.get("ab")!(answer({ count: 1, size: 1 }, [row(1)]));
    await Promise.resolve();
    render("ab");
    expect(textOf("stale")).toEqual([]);
    expect(onMarks).toHaveBeenLastCalledWith([], false, null);
    press({ key: "Delete", repeat: false });
    expect(onTrash).not.toHaveBeenCalled();
  });

  it("scrolls to the top when the results of another query arrive", async () => {
    vi.mocked(api.getList).mockResolvedValue(answer({ count: 1, size: 1 }, [row(1)]));
    await settle("a");
    const scrolled = { scrollTop: 800, querySelector: () => null };
    (grid().props as { ref: { current: unknown } }).ref.current = scrolled;
    await settle("a");
    expect(scrolled.scrollTop).toBe(800);
    await settle("ab");
    expect(scrolled.scrollTop).toBe(0);
  });

  it("lists again with the same query after a change of the tree", async () => {
    vi.mocked(api.getList).mockResolvedValue(answer({ count: 1, size: 1 }));
    await settle("backup");
    expect(api.getList).toHaveBeenCalledTimes(1);
    render("backup", true, { ...summary, rev: summary.rev + 1 });
    expect(api.getList).toHaveBeenCalledTimes(2);
    expect(api.getList).toHaveBeenLastCalledWith(1, 1, "search", 1000, "backup");
  });

  it("does not announce the totals again on every refresh of a live scan", async () => {
    vi.mocked(api.getList).mockResolvedValue(answer({ count: 2, size: 2 }));
    const scanning = { ...summary, scanning: true };
    render("a", true, scanning);
    await Promise.resolve();
    render("a", true, scanning);
    const line = (shown!.props as { children: ReactElement[] }).children[0];
    expect(textOf("found")).toHaveLength(1);
    expect((line.props as { role?: string }).role).toBeUndefined();
  });

  it("announces the totals", async () => {
    vi.mocked(api.getList).mockResolvedValue(answer({ count: 2, size: 2 }));
    await settle("a");
    const line = (shown!.props as { children: ReactElement[] }).children[0];
    expect((line.props as { role?: string }).role).toBe("status");
  });

  describe("opening a folder of the results", () => {
    const folder = { id: 7, name: "backup", isDir: true, parent: 3, deleted: false } as ListItem;
    const rows = [folder];

    async function onFolder(leaves = true) {
      vi.mocked(api.getList).mockResolvedValue(answer({ count: 1, size: 1 }, rows));
      await settle("backup");
      render("backup", leaves);
      press({ key: "ArrowDown" });
      render("backup", leaves);
    }

    it("leaves the search for the folder on Enter", async () => {
      await onFolder();
      press({ key: "Enter", repeat: false });
      expect(onOpenFolder).toHaveBeenCalledWith(7, 3);
      expect(onEnter).not.toHaveBeenCalled();
    });

    it("keeps Backspace in the search: the list of the parent", async () => {
      await onFolder();
      press({ key: "Backspace" });
      expect(onOpenFolder).not.toHaveBeenCalled();
      expect(onEnter).toHaveBeenCalledWith(3);
    });

    it("enters the folder as other lists do when nothing is said about leaving", async () => {
      await onFolder(false);
      press({ key: "Enter", repeat: false });
      expect(onEnter).toHaveBeenCalledWith(7, 3);
    });
  });
});
