import type { ReactElement, ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "../../api/client";
import type { List, ListItem, ListKind, Summary } from "../../api/types";
import { CleanupNotes } from "../cleanup/CleanupNotes";
import { COLUMNS, type Column, type ColumnId } from "../contents/columns";
import { TableHeader } from "../contents/TableHeader";
import { rt } from "./hookRuntime";
import {
  answer,
  onMarks,
  onMenu,
  onPurge,
  onTrash,
  press,
  render,
  resetTable,
  shown,
  summary,
  textOf,
} from "./ListTable.harness";

vi.mock("react", async (original) => ({
  ...(await original<typeof import("react")>()),
  ...(await import("./hookRuntime")).rt.hooks,
}));
vi.mock("../../api/client", () => ({ api: { getList: vi.fn() } }));
vi.mock("../../i18n/react", () => ({
  useT: () => ({
    t: (key: string, params?: Record<string, unknown>) =>
      params ? `${key} ${JSON.stringify(params)}` : key,
    lang: "en",
  }),
}));

beforeEach(resetTable);

type MenuAt = (index: number, x: number, y: number) => void;

describe("ListTable for the clean-up lists", () => {
  const cache = {
    id: 5,
    name: "_cacache",
    isDir: true,
    deleted: false,
    reason: { reason: "packageCache", command: "npm cache clean --force", restorable: null },
  } as ListItem;
  const plain = { ...cache, id: 6, reason: { ...cache.reason!, command: null } } as ListItem;
  const withCleanup = (items: ListItem[] = []): List => ({
    ...answer({ count: items.length, size: 9 }, items),
    cleanup: { info: [], approximate: false },
  });

  /** The elements of the shown tree that `match`. */
  const find = (match: (e: ReactElement) => boolean): ReactElement[] => {
    const hits: ReactElement[] = [];
    const visit = (node: ReactNode) => {
      if (Array.isArray(node)) node.forEach(visit);
      else if (node && typeof node === "object" && "props" in node) {
        if (match(node as ReactElement)) hits.push(node as ReactElement);
        visit((node.props as { children?: ReactNode }).children);
      }
    };
    visit(shown);
    return hits;
  };
  const rowsOf = () =>
    find((e) => "item" in (e.props as object) && "onMenu" in (e.props as object));
  const menuOf = (row: ReactElement) => (row.props as { onMenu: MenuAt }).onMenu;

  async function settleKind(kind: ListKind, query = "") {
    render(query, true, summary, kind);
    await Promise.resolve();
    render(query, true, summary, kind);
  }

  it.each(["cleanup", "review"] as const)(
    "asks for the %s list of the folder, without a query",
    async (kind) => {
      vi.mocked(api.getList).mockResolvedValue(withCleanup());
      await settleKind(kind);
      expect(api.getList).toHaveBeenLastCalledWith(1, 1, kind, 1000, "");
    },
  );

  it("shows the notes of the list instead of the totals of a search", async () => {
    vi.mocked(api.getList).mockResolvedValue(withCleanup([cache]));
    await settleKind("cleanup");
    expect(find((e) => e.type === CleanupNotes)).toHaveLength(1);
    expect(textOf("found")).toEqual([]);
    expect(JSON.stringify(shown)).not.toContain("search.found");
  });

  it("shows no notes in a search or another list", async () => {
    vi.mocked(api.getList).mockResolvedValue(answer({ count: 1, size: 1 }, [cache]));
    await settleKind("search", "a");
    expect(find((e) => e.type === CleanupNotes)).toHaveLength(0);
    await settleKind("largest");
    expect(find((e) => e.type === CleanupNotes)).toHaveLength(0);
  });

  it("says there is nothing to clean when the list is empty", async () => {
    vi.mocked(api.getList).mockResolvedValue(withCleanup());
    await settleKind("cleanup");
    expect(JSON.stringify(shown)).toContain("cleanup.none");
  });

  it("asks once more when the answer was walked at an older revision, never twice", async () => {
    vi.mocked(api.getList).mockResolvedValue({ ...withCleanup([cache]), rev: summary.rev - 1 });
    await settleKind("cleanup");
    for (let tick = 0; tick < 5; tick++) await Promise.resolve();
    render("", true, summary, "cleanup");
    expect(api.getList).toHaveBeenCalledTimes(2);
    expect(rowsOf()).toHaveLength(1);
    // An answer of this revision, and any other list, is asked once.
    vi.mocked(api.getList).mockClear();
    vi.mocked(api.getList).mockResolvedValue(withCleanup([cache]));
    rt.state.slots = [];
    await settleKind("review");
    vi.mocked(api.getList).mockResolvedValue({ ...answer({ count: 0, size: 0 }), rev: 1 });
    await settleKind("largest");
    for (let tick = 0; tick < 5; tick++) await Promise.resolve();
    expect(api.getList).toHaveBeenCalledTimes(2);
  });

  it("tells the menu that a row is a clean-up row, with the command of its tool", async () => {
    vi.mocked(api.getList).mockResolvedValue(withCleanup([cache, plain]));
    await settleKind("review");
    const [first, second] = rowsOf();
    menuOf(first)(0, 3, 4);
    expect(onMenu).toHaveBeenLastCalledWith(
      expect.objectContaining({
        id: 5,
        cleanup: true,
        command: "npm cache clean --force",
        x: 3,
        y: 4,
      }),
    );
    menuOf(second)(1, 1, 2);
    const target = onMenu.mock.calls.at(-1)![0] as object;
    expect(target).toMatchObject({ id: 6, cleanup: true });
    expect(target).not.toHaveProperty("command");
  });

  describe("deleting", () => {
    /** The list of `kind`, mounted afresh as the viewer does, with its cursor on its first row. */
    async function onFirstRow(kind: ListKind) {
      rt.state.slots = [];
      vi.mocked(api.getList).mockResolvedValue(withCleanup([cache, plain]));
      await settleKind(kind);
      press({ key: "ArrowDown" });
      render("", true, summary, kind);
    }

    it.each(["cleanup", "review"] as const)(
      "deletes the %s rows for good with Shift+Delete, after the dialog's questions",
      async (kind) => {
        await onFirstRow(kind);
        press({ key: "Delete", shiftKey: true, repeat: false });
        expect(onPurge).toHaveBeenCalledWith([5]);
        expect(onTrash).not.toHaveBeenCalled();
      },
    );

    it.each(["largest", "search"] as const)(
      "does nothing with Shift+Delete in the %s list",
      async (kind) => {
        await onFirstRow(kind);
        press({ key: "Delete", shiftKey: true, repeat: false });
        expect(onPurge).not.toHaveBeenCalled();
        expect(onTrash).not.toHaveBeenCalled();
      },
    );

    it("moves clean-up rows to the trash as clean-up rows, other rows as before", async () => {
      await onFirstRow("cleanup");
      press({ key: "Delete", repeat: false });
      await onFirstRow("largest");
      press({ key: "Delete", repeat: false });
      expect(onTrash.mock.calls).toEqual([
        [[5], true],
        [[5], false],
      ]);
    });

    it("says that the marks are clean-up rows, for Scan › Move to the trash", async () => {
      await onFirstRow("review");
      press({ ctrlKey: true, code: "KeyA" });
      render("", true, summary, "review");
      expect(onMarks).toHaveBeenLastCalledWith([5, 6], true, null);
      await onFirstRow("largest");
      press({ ctrlKey: true, code: "KeyA" });
      render("", true, summary, "largest");
      expect(onMarks).toHaveBeenLastCalledWith([5, 6], false, null);
    });

    it("says when the selected item, marked or not, is a row of the clean-up list", async () => {
      vi.mocked(api.getList).mockResolvedValue(withCleanup([cache, plain]));
      const at = (kind: ListKind, selected: number) => {
        rt.state.slots = [];
        render("", true, summary, kind, selected);
        return Promise.resolve().then(() => render("", true, summary, kind, selected));
      };
      await at("cleanup", 6);
      expect(onMarks).toHaveBeenLastCalledWith([], true, 6);
      // The list's own folder (1) is no row; nor is a row of another list.
      await at("cleanup", 1);
      expect(onMarks).toHaveBeenLastCalledWith([], true, null);
      await at("largest", 6);
      expect(onMarks).toHaveBeenLastCalledWith([], false, null);
    });
  });

  it("gives the menu of a search row no clean-up facts", async () => {
    vi.mocked(api.getList).mockResolvedValue(answer({ count: 1, size: 1 }, [cache]));
    await settleKind("search", "a");
    menuOf(rowsOf()[0])(0, 1, 1);
    expect(onMenu.mock.calls.at(-1)![0]).not.toHaveProperty("cleanup");
    expect(onMenu.mock.calls.at(-1)![0]).not.toHaveProperty("command");
  });
});

describe("the header of a clean-up list", () => {
  const header = () => {
    const found: ReactElement[] = [];
    const visit = (node: ReactNode) => {
      if (Array.isArray(node)) node.forEach(visit);
      else if (node && typeof node === "object" && "props" in node) {
        if ((node as ReactElement).type === TableHeader) found.push(node as ReactElement);
        visit((node.props as { children?: ReactNode }).children);
      }
    };
    visit(shown);
    return found[0].props as { canSort: (column: Column) => boolean };
  };
  const column = (id: ColumnId) => COLUMNS.find((c) => c.id === id)!;

  it("has no sort on Why: no arrow, no click, no reset of the marks", async () => {
    vi.mocked(api.getList).mockResolvedValue({
      ...answer({ count: 0, size: 0 }),
      cleanup: { info: [], approximate: false },
    });
    render("", true, summary, "cleanup");
    await Promise.resolve();
    render("", true, summary, "cleanup");
    expect(header().canSort(column("reason"))).toBe(false);
    // The columns of the rows still sort, and the details read from disk still do not.
    expect(header().canSort(column("size"))).toBe(true);
    expect(header().canSort(column("path"))).toBe(true);
    expect(header().canSort(column("created"))).toBe(false);
  });
});

describe("a clean-up list during a live scan", () => {
  const live = (rev: number): Summary => ({ ...summary, scanning: true, rev });
  const fresh: List = {
    ...answer({ count: 0, size: 0 }),
    cleanup: { info: [], approximate: false },
  };

  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("is listed once for several revisions inside the window of the charts", async () => {
    vi.mocked(api.getList).mockResolvedValue(fresh);
    render("", true, live(1), "cleanup");
    await vi.advanceTimersByTimeAsync(0);
    expect(api.getList).toHaveBeenCalledTimes(1);
    for (const rev of [2, 3, 4, 5]) {
      render("", true, live(rev), "cleanup");
      await vi.advanceTimersByTimeAsync(500);
    }
    expect(api.getList).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(5000);
    render("", true, live(5), "cleanup");
    expect(api.getList).toHaveBeenCalledTimes(2);
  });

  it("is listed at once for a tree that is not scanning", async () => {
    vi.mocked(api.getList).mockResolvedValue(fresh);
    render("", true, { ...summary, rev: 1 }, "cleanup");
    render("", true, { ...summary, rev: 2 }, "cleanup");
    expect(api.getList).toHaveBeenCalledTimes(2);
  });

  it("keeps a search on the cadence of the tree: its revision is not held back", async () => {
    vi.mocked(api.getList).mockResolvedValue(answer({ count: 0, size: 0 }));
    render("a", true, live(1), "search");
    render("a", true, live(2), "search");
    expect(api.getList).toHaveBeenCalledTimes(2);
  });
});
