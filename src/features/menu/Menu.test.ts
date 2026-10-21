import { describe, expect, it } from "vitest";
import { arrowItem, openingItem } from "./Menu";

describe("openingItem", () => {
  const items = [{ checked: false }, { checked: true }, { checked: false }];
  const checked = (item: { checked: boolean }) => item.checked;

  it("is the checked item of a scrolling list (the languages)", () => {
    expect(openingItem(items, true, checked)).toBe(items[1]);
  });

  it("is the first item of any other menu, or of a list with nothing checked", () => {
    expect(openingItem(items, false, checked)).toBe(items[0]);
    expect(openingItem([items[0], items[2]], true, checked)).toBe(items[0]);
    expect(openingItem([], true, checked)).toBeUndefined();
  });
});

describe("arrowItem", () => {
  const items = ["a", "b", "c", "d"];
  const isC = (item: string) => item === "c";

  it("moves from the focused item, wrapping", () => {
    expect(arrowItem(items, "b", true, true, isC)).toBe("c");
    expect(arrowItem(items, "d", true, false, isC)).toBe("a");
    expect(arrowItem(items, "a", false, false, isC)).toBe("d");
  });

  it("with no item focused, starts from the checked item of a scrolling list", () => {
    expect(arrowItem(items, null, true, true, isC)).toBe("d");
    expect(arrowItem(items, null, false, true, isC)).toBe("b");
  });

  it("with no item focused elsewhere, goes to the first or the last", () => {
    expect(arrowItem(items, null, true, false, isC)).toBe("a");
    expect(arrowItem(items, null, false, false, isC)).toBe("d");
    expect(arrowItem(items, null, true, true, () => false)).toBe("a");
    expect(arrowItem([], null, true, true, isC)).toBeUndefined();
  });
});
