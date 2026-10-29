import { describe, expect, it } from "vitest";
import { carsFor, peopleFor } from "./life";

describe("life on an archipelago", () => {
  it("has 60 cars an island, up to 200", () => {
    expect([1, 3, 8, 0].map(carsFor)).toEqual([60, 180, 200, 60]);
  });

  it("has 150 residents an island, up to 525", () => {
    expect([1, 3, 4, 8].map(peopleFor)).toEqual([150, 450, 525, 525]);
  });
});
