import { describe, expect, it } from "vitest";
import type { TrashPreview, TrashResult } from "../../api/types";
import { translate, type Params } from "../../i18n";
import { itemName, trashMessage, trashProgressText, trashReport } from "./text";

const t = (key: string, params?: Params) => translate("en", key, params);
const size = (bytes: number) => `${bytes} B`;
const date = (seconds: number) => `day ${seconds}`;
const count = (n: number) => n.toLocaleString("en");
const errorText = (e: unknown) => `error ${JSON.stringify(e)}`;

describe("trashMessage", () => {
  it("lists the paths it got and counts the rest", () => {
    const paths = Array.from({ length: 10 }, (_, i) => `C:\\a\\${i}`);
    const preview: TrashPreview = { count: 1200, size: 300, scannedAt: 5, paths, binFree: null };
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
      binFree: null,
    };
    expect(trashMessage(preview, t, size, date, count).split("\n")).toEqual([
      "Move 1 item to the trash?",
      "/a/b",
      "Total size: 7 B. Scanned day 1.",
    ]);
  });

  it("speaks Russian", () => {
    const ru = (key: string, params?: Params) => translate("ru", key, params);
    const preview: TrashPreview = { count: 5, size: 1, scannedAt: 1, paths: ["/a"], binFree: null };
    const message = trashMessage(preview, ru, size, date, count);
    expect(message).toContain("Переместить в корзину 5 объектов?");
    expect(message).toContain("…и ещё 4");
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

  it("names an item by the last part of its path", () => {
    expect(itemName("C:\\a\\b.txt")).toBe("b.txt");
    expect(itemName("/a/b/")).toBe("b");
  });
});
