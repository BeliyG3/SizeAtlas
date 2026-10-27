import { describe, expect, it } from "vitest";
import { canTrash, copyMarksKey, copyTrashNote, menuTrashFor } from "./keep";
import { copy, group } from "./dup.testSupport";

const three = (more: Parameters<typeof copy>[1] = {}) =>
  group("a", 8192, { copies: [copy(1), copy(2), copy(3, more)] });

describe("canTrash", () => {
  it("never takes every copy", () => {
    expect(canTrash(three(), new Set([0, 1, 2]))).toBe(false);
  });

  it("never takes a copy that cannot go", () => {
    const g = group("a", 0, { copies: [copy(1, { protected: true, trashable: false }), copy(2)] });
    expect(canTrash(g, new Set([0]))).toBe(false);
  });

  it("takes copies while one ordinary copy stays", () => {
    expect(canTrash(three(), new Set([0, 1]))).toBe(true);
  });

  it.each([{ protected: true }, { noId: true }])(
    "refuses when the only copy left is one that cannot be kept (%o)",
    (mark) => {
      expect(canTrash(three({ ...mark, trashable: false }), new Set([0, 1]))).toBe(false);
    },
  );

  it("takes nothing for no marks", () => {
    expect(canTrash(three(), new Set())).toBe(false);
  });
});

describe("copyMarksKey", () => {
  it("differs between groups and after a copy left the group", () => {
    const a = three();
    expect(copyMarksKey(1, a)).not.toBe(copyMarksKey(1, { ...a, key: "b" }));
    expect(copyMarksKey(1, a)).not.toBe(copyMarksKey(2, a));
    const fewer = { ...a, copies: a.copies.slice(1) };
    expect(copyMarksKey(1, a)).not.toBe(copyMarksKey(1, fewer));
  });
});

describe("copyTrashNote", () => {
  const g = three();
  it("is null when the copies can go", () => {
    expect(copyTrashNote(g, new Set([0]), false, false)).toBeNull();
  });

  it("says why not: the search, a copy that cannot go, the last copy, a request", () => {
    expect(copyTrashNote(g, new Set([0]), true, false)).toBe("dup.searching");
    const held = three({ hardlink: true, trashable: false });
    expect(copyTrashNote(held, new Set([2]), false, false)).toBe("dup.hardlink");
    expect(copyTrashNote(g, new Set([0, 1, 2]), false, false)).toBe("dup.lastCopy");
    expect(copyTrashNote(g, new Set([0]), false, true)).toBe("trash.already");
  });
});

describe("menuTrashFor", () => {
  const f = () => {};
  const g = () => {};
  it("takes the trash of the duplicates in their mode, the usual one elsewhere", () => {
    expect(menuTrashFor("duplicates", f, null)).toBeNull();
    expect(menuTrashFor("duplicates", f, g)).toBe(g);
    expect(menuTrashFor("all", f, g)).toBe(f);
  });
});
