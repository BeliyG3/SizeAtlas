import { describe, expect, it } from "vitest";
import { historyKey } from "./historyKey";

const key = (key: string, mods: Partial<KeyboardEvent> = {}) => ({
  key,
  altKey: false,
  ctrlKey: false,
  shiftKey: false,
  metaKey: false,
  ...mods,
});

describe("historyKey", () => {
  it("goes back on Alt+Left and forward on Alt+Right", () => {
    expect(historyKey(key("ArrowLeft", { altKey: true }))).toBe(-1);
    expect(historyKey(key("ArrowRight", { altKey: true }))).toBe(1);
  });

  it("leaves plain and other modified arrows to the controls", () => {
    expect(historyKey(key("ArrowLeft"))).toBeNull();
    expect(historyKey(key("ArrowLeft", { altKey: true, shiftKey: true }))).toBeNull();
    expect(historyKey(key("ArrowRight", { altKey: true, ctrlKey: true }))).toBeNull();
    expect(historyKey(key("ArrowUp", { altKey: true }))).toBeNull();
  });
});
