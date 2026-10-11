import { describe, expect, it } from "vitest";
import type { TrashPreview, TrashResult } from "../../api/types";
import { translate, type Params } from "../../i18n";
import { trashMessage, trashReport } from "./text";

const t = (key: string, params?: Params) => translate("en", key, params);
const size = (bytes: number) => `${bytes} B`;
const date = (seconds: number) => `day ${seconds}`;
const count = (n: number) => n.toLocaleString("en");
const errorText = (e: unknown) => `error ${JSON.stringify(e)}`;

describe("trashMessage", () => {
  it("lists the paths it got and counts the rest", () => {
    const paths = Array.from({ length: 10 }, (_, i) => `C:\\a\\${i}`);
    const preview: TrashPreview = { count: 1200, size: 300, scannedAt: 5, paths };
    expect(trashMessage(preview, t, size, date, count).split("\n")).toEqual([
      "Move 1,200 items to the trash?",
      ...paths,
      "…and 1,190 more",
      "Total size: 300 B. Scanned day 5.",
    ]);
  });

  it("asks about one item without counting the rest", () => {
    const preview: TrashPreview = { count: 1, size: 7, scannedAt: 1, paths: ["/a/b"] };
    expect(trashMessage(preview, t, size, date, count).split("\n")).toEqual([
      "Move 1 item to the trash?",
      "/a/b",
      "Total size: 7 B. Scanned day 1.",
    ]);
  });

  it("speaks Russian", () => {
    const ru = (key: string, params?: Params) => translate("ru", key, params);
    const preview: TrashPreview = { count: 5, size: 1, scannedAt: 1, paths: ["/a"] };
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

  it("names three items that stayed, with the system's words or the reason, and an unsaved scan", () => {
    const failed = [io("a"), { path: "b", error: { code: "NoTrash" as const } }, io("c"), io("d")];
    const result: TrashResult = { removed: 2, failed, warning: { code: "CacheNotSaved" } };
    expect(trashReport(result, t, errorText, count)).toEqual([
      'Moved 2 of 6 to the trash. Could not move: a: in use; b: error {"code":"NoTrash"}; c: in use; …',
      'error {"code":"CacheNotSaved"}',
    ]);
  });

  it("says that nothing moved", () => {
    const result: TrashResult = { removed: 0, failed: [io("a")], warning: null };
    expect(trashReport(result, t, errorText, count)).toEqual([
      "Could not move to the trash: a: in use",
    ]);
  });

  it("names the reason of an item that could not be reached or changed", () => {
    const denied = { path: "a", error: { code: "NoAccess" as const, path: "a" } };
    const changed = { path: "b", error: { code: "Changed" as const } };
    const result: TrashResult = { removed: 0, failed: [denied, changed], warning: null };
    expect(trashReport(result, t, errorText, count)).toEqual([
      'Could not move to the trash: a: no access; b: error {"code":"Changed"}',
    ]);
  });

  it("says nothing when everything went", () => {
    const result: TrashResult = { removed: 3, failed: [], warning: null };
    expect(trashReport(result, t, errorText, count)).toEqual([]);
  });
});
