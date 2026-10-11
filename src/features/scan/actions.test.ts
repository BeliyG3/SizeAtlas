import { expect, it } from "vitest";
import { scanActions } from "./actions";

it("refuses all item mutations during a scan and only trash during another trash", () => {
  expect(scanActions(true, true, false)).toEqual({
    refresh: false,
    scanFolder: false,
    trash: false,
  });
  expect(scanActions(false, false, true)).toEqual({
    refresh: true,
    scanFolder: true,
    trash: false,
  });
  expect(scanActions(false, false, false)).toEqual({
    refresh: true,
    scanFolder: true,
    trash: true,
  });
  expect(scanActions(false, true, false)).toEqual({
    refresh: true,
    scanFolder: true,
    trash: false,
  });
});
