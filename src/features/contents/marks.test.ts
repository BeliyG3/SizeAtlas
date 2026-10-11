import { describe, expect, it } from "vitest";
import { mark, markAll, markHow, marksFor, marksKey, noMarks, targets, type Marks } from "./marks";

// Rows 0..9 hold items 100..109; rows 4 and 5 are not loaded yet.
const idAt = (i: number) => (i < 0 || i > 9 || i === 4 || i === 5 ? undefined : 100 + i);
const ids = (m: Marks) => [...m.ids].sort((a, b) => a - b);
const start = noMarks("list");

describe("marks", () => {
  it("a plain click marks one row and anchors there", () => {
    const m = mark(mark(start, "one", 2, idAt), "one", 7, idAt);
    expect(ids(m)).toEqual([107]);
    expect(m.anchor).toBe(7);
    expect(m.anchorId).toBe(107);
  });

  it("Ctrl+click adds and removes rows", () => {
    let m = mark(start, "one", 1, idAt);
    m = mark(m, "toggle", 3, idAt);
    m = mark(m, "toggle", 8, idAt);
    m = mark(m, "toggle", 3, idAt);
    expect(ids(m)).toEqual([101, 108]);
    expect(m.anchor).toBe(3);
    expect(m.anchorId).toBe(103);
  });

  it("Shift marks the loaded rows from the anchor, either way", () => {
    const anchored = mark(start, "one", 3, idAt);
    const down = mark(anchored, "range", 7, idAt);
    expect(ids(down)).toEqual([103, 106, 107]);
    const up = mark(down, "range", 1, idAt);
    expect(ids(up)).toEqual([101, 102, 103]);
    expect(up.anchor).toBe(3);
    expect(up.anchorId).toBe(103);
    expect(markAll(up, 10, idAt).anchorId).toBe(103);
  });

  it("Shift without an anchor starts at the cursor row", () => {
    // Shift+↓ from row 2 (the cursor), before any click.
    const m = mark(start, "range", 3, idAt, 2);
    expect(ids(m)).toEqual([102, 103]);
    expect(m.anchor).toBe(2);
    expect(ids(mark(start, "range", 2, idAt))).toEqual([102]);
  });

  it("Ctrl+A marks every loaded row", () => {
    expect(ids(markAll(start, 10, idAt))).toEqual([100, 101, 102, 103, 106, 107, 108, 109]);
  });

  it("marks of another listing or another selection count as none", () => {
    const key = marksKey("folder 3:rev 0", 5);
    const m = mark(noMarks(key), "one", 1, idAt);
    expect(marksFor(m, key)).toBe(m);
    // A node selected elsewhere (the tree, a chart): the marks must not stay and hide it.
    expect(marksFor(m, marksKey("folder 3:rev 0", 7)).ids.size).toBe(0);
    expect(marksFor(m, marksKey("folder 3:rev 1", 5)).ids.size).toBe(0);
    expect(marksFor(start, "other").ids).toBe(start.ids);
  });

  it("marks dropped on a selection change do not come back with the same selection", () => {
    const a = marksKey("list", 1);
    // What the table keeps in state: replaced as soon as the key differs (A, then B, then A).
    let stored = mark(noMarks(a), "toggle", 3, idAt);
    stored = mark(stored, "toggle", 7, idAt);
    const atB = marksFor(stored, marksKey("list", 2));
    expect(atB).not.toBe(stored);
    expect(marksFor(atB, a).ids.size).toBe(0);
    expect(marksFor(atB, marksKey("list", 2))).toBe(atB);
  });

  it("an action takes the marks, else the cursor row", () => {
    expect(targets(mark(start, "one", 2, idAt), 105)).toEqual([102]);
    expect(targets(start, 105)).toEqual([105]);
    expect(targets(start, undefined)).toEqual([]);
  });

  it("reads Ctrl, Cmd and Shift", () => {
    const keys = { ctrlKey: false, metaKey: false, shiftKey: false };
    expect(markHow(keys)).toBe("one");
    expect(markHow({ ...keys, ctrlKey: true })).toBe("toggle");
    expect(markHow({ ...keys, metaKey: true })).toBe("toggle");
    expect(markHow({ ...keys, shiftKey: true, ctrlKey: true })).toBe("range");
  });
});
