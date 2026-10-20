import { describe, expect, it } from "vitest";
import { MIN_PANE, SPLITTER, clampPane, keyStep, movePane } from "./split";

describe("split panes", () => {
  it("keep both panes at least the minimum size", () => {
    expect(clampPane(300, 1000)).toBe(300);
    expect(clampPane(5, 1000)).toBe(MIN_PANE);
    expect(clampPane(2000, 1000)).toBe(1000 - MIN_PANE - SPLITTER);
    expect(clampPane(300, 100)).toBe(MIN_PANE);
    expect(clampPane(Number.NaN, 1000)).toBe(MIN_PANE);
  });

  it("move with arrow keys along the split", () => {
    expect(keyStep("ArrowRight", false, true)).toBe(16);
    expect(keyStep("ArrowLeft", true, true)).toBe(-64);
    expect(keyStep("ArrowDown", false, false)).toBe(16);
    expect(keyStep("ArrowDown", false, true)).toBeNull();
    expect(keyStep("Enter", false, false)).toBeNull();
  });

  it("follow the border on screen, mirrored side by side in right-to-left layouts", () => {
    // The first pane is the start one: on the left, or on the right in right-to-left layouts.
    expect(movePane(300, 50, "first", true, false)).toBe(350);
    expect(movePane(300, 50, "first", true, true)).toBe(250);
    expect(movePane(300, 50, "second", true, false)).toBe(250);
    expect(movePane(300, 50, "second", true, true)).toBe(350);
    // One above the other: nothing to mirror.
    expect(movePane(300, 50, "second", false, true)).toBe(250);
  });
});
