import { describe, expect, it, vi } from "vitest";
import { beginRefresh, measured, newCadence, refreshInterval, waitForRefresh } from "./cadence";

describe("live refresh cadence", () => {
  it.each([2000, 5000])("never updates faster than the %i ms minimum", (minimum) => {
    const cadence = { ...measured(newCadence(minimum), 5), last: 1000 };
    expect(waitForRefresh(cadence, 1001)).toBe(minimum - 1);
    expect(waitForRefresh(cadence, 1000 + minimum)).toBe(0);
  });
  it("uses measured cost and recovers gradually", () => {
    const costly = measured(newCadence(2000), 700);
    expect(costly.interval).toBe(7000);
    const cheap = measured(costly, 10);
    expect(cheap.interval).toBe(5600);
    expect(waitForRefresh({ ...cheap, last: 100 }, 4000)).toBe(1700);
  });
  it("records one wall-time cost for a completed batch", () => {
    const clock = vi.spyOn(performance, "now").mockReturnValue(100);
    const finish = beginRefresh("tree");
    clock.mockReturnValue(900);
    finish();
    expect(refreshInterval("tree")).toBe(8000);
    clock.mockReturnValue(1000);
    finish();
    expect(refreshInterval("tree")).toBe(8000);
    clock.mockRestore();
  });
  it("keeps the groups apart: a slow city does not slow the charts", () => {
    const clock = vi.spyOn(performance, "now").mockReturnValue(0);
    const finish = beginRefresh("city");
    clock.mockReturnValue(2000);
    finish();
    expect(refreshInterval("city")).toBe(20_000);
    expect(refreshInterval("charts")).toBe(5000);
    clock.mockRestore();
  });
});
