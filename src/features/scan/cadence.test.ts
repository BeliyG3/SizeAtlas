import { describe, expect, it } from "vitest";
import { measured, newCadence, waitForRefresh } from "./cadence";

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
});
