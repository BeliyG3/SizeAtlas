import { describe, expect, it } from "vitest";
import { carsFor, peopleFor } from "./life";

describe("life on an archipelago", () => {
  it("has 100 cars an island, up to 400", () => {
    expect([1, 3, 8, 0].map(carsFor)).toEqual([100, 300, 400, 100]);
  });

  it("has 150 residents an island, up to 525", () => {
    expect([1, 3, 4, 8].map(peopleFor)).toEqual([150, 450, 525, 525]);
  });
});
