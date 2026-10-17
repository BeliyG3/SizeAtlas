import { expect, it } from "vitest";
import { scanActions } from "./actions";

it("refuses refresh and child scans during a full scan", () => {
  expect(scanActions(true)).toEqual({ refresh: false, scanFolder: false });
  expect(scanActions(false)).toEqual({ refresh: true, scanFolder: true });
});
