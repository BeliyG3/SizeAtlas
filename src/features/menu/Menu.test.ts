import { describe, expect, it } from "vitest";
import { openingItem } from "./Menu";

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
