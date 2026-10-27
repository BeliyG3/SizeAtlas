import { describe, expect, it } from "vitest";
import { HOVER_DELAY, HOVER_SIZE, placePopup, popupSize } from "./hover";

const view = { w: 1000, h: 800 };
const popup = { w: 320, h: 320 };

describe("hover zoom placement", () => {
  it("has the agreed delay and size", () => {
    expect([HOVER_DELAY, HOVER_SIZE]).toEqual([400, 320]);
  });

  it("puts the popup below-right of the pointer", () => {
    expect(placePopup({ x: 100, y: 100 }, popup, view)).toEqual({ x: 112, y: 112 });
  });

  it("flips on the axis where it would leave the view", () => {
    expect(placePopup({ x: 900, y: 700 }, popup, view)).toEqual({ x: 568, y: 368 });
    expect(placePopup({ x: 990, y: 10 }, popup, view)).toEqual({ x: 658, y: 22 });
  });

  it("is never larger than a small view, and stays inside it", () => {
    const small = { w: 200, h: 150 };
    expect(popupSize(small)).toEqual(small);
    expect(popupSize(view)).toEqual(popup);
    expect(placePopup({ x: 100, y: 100 }, popupSize(small), small)).toEqual({ x: 0, y: 0 });
  });
});
