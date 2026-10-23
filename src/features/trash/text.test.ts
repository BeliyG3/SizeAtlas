import { describe, expect, it } from "vitest";
import type { TrashPreview, TrashResult } from "../../api/types";
import { translate, type Params } from "../../i18n";
import {
  itemName,
  purgeAgain,
  purgeMessage,
  trashMessage,
  trashProgressText,
  trashReport,
} from "./text";

const t = (key: string, params?: Params) => translate("en", key, params);
const size = (bytes: number) => `${bytes} B`;
const date = (seconds: number) => `day ${seconds}`;
const count = (n: number) => n.toLocaleString("en");
const errorText = (e: unknown) => `error ${JSON.stringify(e)}`;

describe("trashMessage", () => {
  it("lists the paths it got and counts the rest", () => {
    const paths = Array.from({ length: 10 }, (_, i) => `C:\\a\\${i}`);
    const preview: TrashPreview = {
      count: 1200,
      size: 300,
      scannedAt: 5,
      paths,
      binSize: 0,
      binFree: null,
    };
    expect(trashMessage(preview, t, size, date, count).split("\n")).toEqual([
      "Move 1,200 items to the trash?",
      ...paths,
      "…and 1,190 more",
      "Total size: 300 B. Scanned day 5.",
    ]);
  });

  it("asks about one item without counting the rest", () => {
    const preview: TrashPreview = {
      count: 1,
      size: 7,
      scannedAt: 1,
      paths: ["/a/b"],
      binSize: 0,
      binFree: null,
    };
    expect(trashMessage(preview, t, size, date, count).split("\n")).toEqual([
      "Move 1 item to the trash?",
      "/a/b",
      "Total size: 7 B. Scanned day 1.",
    ]);
  });

  it("says in the clean-up lists that the space comes back only with an empty bin", () => {
    const preview: TrashPreview = {
      count: 1,
      size: 7,
      scannedAt: 1,
      paths: ["/a"],
      binSize: 7,
      binFree: 100,
    };
    const lines = trashMessage(preview, t, size, date, count, true).split("\n");
    // In the words of every system: the Recycle Bin is named only where Windows is meant.
    expect(lines.at(-1)).toBe("Space is freed only when you empty the trash.");
    expect(trashMessage(preview, t, size, date, count)).not.toContain("empty the trash");
  });

  it("warns that the bin will drop its oldest files when the items do not fit in its free space", () => {
    const over: TrashPreview = {
      count: 2,
      size: 300,
      scannedAt: 1,
      paths: [],
      binSize: 300,
      binFree: 200,
    };
    const warning =
      "The Recycle Bin can take 200 B more. Windows will delete its oldest files for good.";
    expect(trashMessage(over, t, size, date, count, true).split("\n").at(-1)).toBe(warning);
    // It fits, or the free space is not known (macOS, Linux): no warning.
    for (const binFree of [300, null])
      expect(trashMessage({ ...over, binFree }, t, size, date, count, true)).not.toContain(
        "oldest",
      );
    // The bin counts the larger of the size on disk and the length (compressed files in full).
    const compressed = { ...over, size: 100, binSize: 300 };
    expect(trashMessage(compressed, t, size, date, count, true)).toContain("oldest");
    // Not outside the clean-up lists.
    expect(trashMessage(over, t, size, date, count)).not.toContain("oldest");
  });

  it("speaks Russian", () => {
    const ru = (key: string, params?: Params) => translate("ru", key, params);
    const preview: TrashPreview = {
      count: 5,
      size: 1,
      scannedAt: 1,
      paths: ["/a"],
      binSize: 0,
      binFree: null,
    };
    const message = trashMessage(preview, ru, size, date, count);
    expect(message).toContain("Переместить в корзину 5 объектов?");
    expect(message).toContain("…и ещё 4");
  });
});

describe("purgeMessage", () => {
  const paths = Array.from({ length: 10 }, (_, i) => `/a/${i}`);
  const preview: TrashPreview = {
    count: 12,
    size: 300,
    scannedAt: 5,
    paths,
    binSize: 0,
    binFree: 0,
  };

  it("asks first with the paths, the total and that it cannot be undone", () => {
    expect(purgeMessage(preview, t, size, date, count).split("\n")).toEqual([
      "Delete permanently?",
      ...paths,
      "…and 2 more",
      "Total size: 300 B. Scanned day 5.",
      "This cannot be undone: the files will not go to the trash.",
    ]);
  });

  it("asks again with the count and the size", () => {
    expect(purgeAgain(preview, t, size, count)).toBe("Delete 12 items, 300 B, permanently?");
    expect(purgeAgain({ ...preview, count: 1 }, t, size, count)).toBe(
      "Delete 1 item, 300 B, permanently?",
    );
  });
});

describe("trashReport", () => {
  const io = (path: string) => ({
    path,
    error: { code: "Io" as const, path, osMessage: "in use" },
  });
  const preview = (n: number): TrashPreview => ({
    count: n,
    size: 1200,
    scannedAt: 1,
    paths: Array.from({ length: Math.min(n, 10) }, (_, i) => `C:\\a\\f${i}`),
    binSize: 0,
    binFree: null,
  });
  const done = (removed: number, more: Partial<TrashResult> = {}): TrashResult => ({
    removed,
    failed: [],
    warning: null,
    stopped: false,
    ...more,
  });
  const report = (result: TrashResult, n: number, tr = t) =>
    trashReport(result, preview(n), tr, errorText, count, size);

  it("names three items that stayed, with the system's words or the reason, and an unsaved scan", () => {
    const failed = [io("a"), { path: "b", error: { code: "NoTrash" as const } }, io("c"), io("d")];
    expect(report(done(2, { failed, warning: { code: "CacheNotSaved" } }), 6)).toEqual([
      'Moved 2 of 6 to the trash. Could not move: a: in use; b: error {"code":"NoTrash"}; c: in use; …',
      'error {"code":"CacheNotSaved"}',
    ]);
  });

  it("says why a protected item stayed, in the words of the language", () => {
    const protectedRow = { path: "/data/a", error: { code: "Protected" as const } };
    const shown = (e: unknown) => t(`error.${(e as { code: string }).code}`);
    expect(
      trashReport(done(0, { failed: [protectedRow] }), preview(1), t, shown, count, size),
    ).toEqual([
      "Could not move to the trash: /data/a: Not deleted: this holds something SizeAtlas never deletes, or it is no longer a clean-up item. Refresh the list.",
    ]);
  });

  it("says that nothing moved", () => {
    expect(report(done(0, { failed: [io("a")] }), 1)).toEqual([
      "Could not move to the trash: a: in use",
    ]);
  });

  it("names the reason of an item that could not be reached or changed", () => {
    const denied = { path: "a", error: { code: "NoAccess" as const, path: "a" } };
    const changed = { path: "b", error: { code: "Changed" as const } };
    expect(report(done(0, { failed: [denied, changed] }), 2)).toEqual([
      'Could not move to the trash: a: no access; b: error {"code":"Changed"}',
    ]);
  });

  it("says what moved and its size, or names the one item", () => {
    expect(report(done(1200), 1200)).toEqual(["Moved 1,200 items to the trash (1200 B)."]);
    expect(report(done(1), 1)).toEqual(["Moved f0 to the trash."]);
  });

  it("says where a stop left the request, and what could not move before it", () => {
    expect(report(done(3, { stopped: true }), 120)).toEqual([
      "Stopped after moving 3 of 120 items.",
    ]);
    expect(report(done(1, { stopped: true, failed: [io("a")] }), 120)).toEqual([
      "Stopped after moving 1 of 120 items.",
      "Could not move to the trash: a: in use",
    ]);
  });

  it("says after the clean-up lists' trash that the bin must be emptied", () => {
    const cleanup = (result: TrashResult, n: number) =>
      trashReport(result, preview(n), t, errorText, count, size, "cleanup");
    const notice = "Moved to the trash: 1200 B. Empty the trash to free the space.";
    expect(cleanup(done(1), 1)).toEqual([notice]);
    expect(cleanup(done(3), 3)).toEqual([notice]);
    expect(cleanup(done(0, { failed: [io("a")] }), 1)).toEqual([
      "Could not move to the trash: a: in use",
    ]);
  });

  it("says after deleting for good that the space is free, and never speaks of the trash", () => {
    const purge = (result: TrashResult, n: number) =>
      trashReport(result, preview(n), t, errorText, count, size, "purge");
    expect(purge(done(1), 1)).toEqual(["Deleted permanently: 1200 B. The space is free."]);
    expect(purge(done(2, { failed: [io("a")] }), 3)).toEqual([
      "Deleted 2 of 3 permanently. Could not delete: a: in use",
    ]);
    expect(purge(done(0, { failed: [io("a")] }), 1)).toEqual(["Could not delete: a: in use"]);
    expect(purge(done(3, { stopped: true, failed: [io("a")] }), 120)).toEqual([
      "Stopped after deleting 3 of 120 items.",
      "Could not delete: a: in use",
    ]);
  });

  it("speaks Russian with its plural forms", () => {
    const ru = (key: string, params?: Params) => translate("ru", key, params);
    expect(report(done(5), 5, ru)).toEqual(["Перемещено в корзину: 5 объектов (1200 B)."]);
    expect(report(done(22), 22, ru)).toEqual(["Перемещено в корзину: 22 объекта (1200 B)."]);
    expect(report(done(3, { stopped: true }), 21, ru)).toEqual([
      "Остановлено: в корзину перемещено 3 из 21 объекта.",
    ]);
  });
});

describe("trashProgressText", () => {
  it("counts the item that moves now, and all of them at the end", () => {
    const at = (done: number, current: string | null) =>
      trashProgressText({ done, total: 1200, current }, t, count);
    expect(at(2, "C:\\a")).toBe("Moving to the trash: 3 of 1,200");
    expect(at(1200, null)).toBe("Moving to the trash: 1,200 of 1,200");
  });

  it("says that the items are deleted for good, not moved", () => {
    const at = trashProgressText({ done: 2, total: 1200, current: "/a" }, t, count, true);
    expect(at).toBe("Deleting permanently: 3 of 1,200");
  });

  it("names an item by the last part of its path", () => {
    expect(itemName("C:\\a\\b.txt")).toBe("b.txt");
    expect(itemName("/a/b/")).toBe("b");
  });
});
