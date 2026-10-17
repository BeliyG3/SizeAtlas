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
    expect(historyKey(key("ArrowLeft", { altKey: true }))).toBe(-1);
    expect(historyKey(key("ArrowRight", { altKey: true }))).toBe(1);
  });

  it("leaves plain and other modified arrows to the controls", () => {
    expect(historyKey(key("ArrowLeft"))).toBeNull();
    expect(historyKey(key("ArrowLeft", { altKey: true, shiftKey: true }))).toBeNull();
    expect(historyKey(key("ArrowRight", { altKey: true, ctrlKey: true }))).toBeNull();
    expect(historyKey(key("ArrowLeft", { altKey: true, metaKey: true }))).toBeNull();
    expect(historyKey(key("ArrowUp", { altKey: true }))).toBeNull();
  });

  it("goes back on Cmd+[ and forward on Cmd+] by physical key", () => {
    expect(historyKey(key("[", { code: "BracketLeft", metaKey: true }))).toBe(-1);
    expect(historyKey(key("]", { code: "BracketRight", metaKey: true }))).toBe(1);
  });

  it("leaves brackets without Cmd alone", () => {
    expect(historyKey(key("[", { code: "BracketLeft" }))).toBeNull();
    expect(historyKey(key("[", { code: "BracketLeft", ctrlKey: true }))).toBeNull();
    expect(historyKey(key("{", { code: "BracketLeft", metaKey: true, shiftKey: true }))).toBeNull();
    expect(historyKey(key("ArrowLeft", { code: "ArrowLeft", metaKey: true }))).toBeNull();
  });
});
