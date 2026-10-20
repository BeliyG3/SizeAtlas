import { describe, expect, it } from "vitest";
import { historyKey } from "./historyKey";

const key = (key: string, mods: Partial<KeyboardEvent> = {}) => ({
  key,
  code: "",
  altKey: false,
  ctrlKey: false,
  shiftKey: false,
  metaKey: false,
  ...mods,
});

describe("historyKey", () => {
  it("goes back on Alt+Left and forward on Alt+Right", () => {
    expect(historyKey(key("ArrowLeft", { altKey: true }), false)).toBe(-1);
    expect(historyKey(key("ArrowRight", { altKey: true }), false)).toBe(1);
  });

  it("leaves plain and other modified arrows to the controls", () => {
    expect(historyKey(key("ArrowLeft"), false)).toBeNull();
    expect(historyKey(key("ArrowLeft", { altKey: true, shiftKey: true }), false)).toBeNull();
    expect(historyKey(key("ArrowRight", { altKey: true, ctrlKey: true }), false)).toBeNull();
    expect(historyKey(key("ArrowLeft", { altKey: true, metaKey: true }), false)).toBeNull();
    expect(historyKey(key("ArrowUp", { altKey: true }), false)).toBeNull();
  });

  it("goes back on Cmd+[ and forward on Cmd+] by physical key", () => {
    expect(historyKey(key("[", { code: "BracketLeft", metaKey: true }), false)).toBe(-1);
    expect(historyKey(key("]", { code: "BracketRight", metaKey: true }), false)).toBe(1);
  });

  it("leaves brackets without Cmd alone", () => {
    expect(historyKey(key("[", { code: "BracketLeft" }), false)).toBeNull();
    expect(historyKey(key("[", { code: "BracketLeft", ctrlKey: true }), false)).toBeNull();
    expect(
      historyKey(key("{", { code: "BracketLeft", metaKey: true, shiftKey: true }), false),
    ).toBeNull();
    expect(historyKey(key("ArrowLeft", { code: "ArrowLeft", metaKey: true }), false)).toBeNull();
  });

  it("mirrors Alt+arrows in right-to-left layouts, not Cmd+brackets", () => {
    expect(historyKey(key("ArrowRight", { altKey: true }), true)).toBe(-1);
    expect(historyKey(key("ArrowLeft", { altKey: true }), true)).toBe(1);
    expect(historyKey(key("[", { code: "BracketLeft", metaKey: true }), true)).toBe(-1);
    expect(historyKey(key("]", { code: "BracketRight", metaKey: true }), true)).toBe(1);
  });
});
