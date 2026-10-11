import { describe, expect, it } from "vitest";
import type { Disk } from "../../api/types";
import {
  DEFAULT_DRIVE_SORT,
  nextDriveSort,
  parseDriveSort,
  serializeDriveSort,
  sortDisks,
} from "./sort";

const disk = (mount: string, total: number, available: number): Disk => ({
  name: "",
  mount,
  total,
  available,
  removable: false,
  network: false,
  connected: true,
});
const DISKS = [disk("d:", 100, 90), disk("C:", 300, 50), disk("e:", 200, 120)];
const mounts = (disks: readonly Disk[]) => disks.map((d) => d.mount);

describe("drive sort", () => {
  it("sorts by name ignoring case, by default", () => {
    expect(DEFAULT_DRIVE_SORT).toEqual({ key: "name", descending: false });
    expect(mounts(sortDisks(DISKS, DEFAULT_DRIVE_SORT))).toEqual(["C:", "d:", "e:"]);
    expect(mounts(sortDisks(DISKS, { key: "name", descending: true }))).toEqual(["e:", "d:", "C:"]);
  });

  it("sorts by size, used and free space", () => {
    expect(mounts(sortDisks(DISKS, { key: "size", descending: true }))).toEqual(["C:", "e:", "d:"]);
    expect(mounts(sortDisks(DISKS, { key: "used", descending: true }))).toEqual(["C:", "e:", "d:"]);
    expect(mounts(sortDisks(DISKS, { key: "free", descending: false }))).toEqual([
      "C:",
      "d:",
      "e:",
    ]);
  });

  it("puts a disconnected drive last by size, in either direction, and by name among the rest", () => {
    const gone: Disk = { ...disk("A:", 0, 0), network: true, connected: false };
    const all = [gone, ...DISKS];
    for (const key of ["size", "used", "free"] as const) {
      for (const descending of [true, false]) {
        expect(mounts(sortDisks(all, { key, descending })).at(-1)).toBe("A:");
      }
    }
    expect(mounts(sortDisks(all, DEFAULT_DRIVE_SORT))).toEqual(["A:", "C:", "d:", "e:"]);
  });

  it("does not change the list it is given", () => {
    const before = mounts(DISKS);
    sortDisks(DISKS, { key: "size", descending: true });
    expect(mounts(DISKS)).toEqual(before);
  });

  it("reverses on the same column; others start descending, names ascending", () => {
    expect(nextDriveSort(DEFAULT_DRIVE_SORT, "name")).toEqual({ key: "name", descending: true });
    expect(nextDriveSort(DEFAULT_DRIVE_SORT, "free")).toEqual({ key: "free", descending: true });
    expect(nextDriveSort({ key: "free", descending: true }, "name")).toEqual(DEFAULT_DRIVE_SORT);
  });

  it("restores a stored sort and falls back to the default", () => {
    const sort = { key: "used", descending: true } as const;
    expect(parseDriveSort(serializeDriveSort(sort))).toEqual(sort);
    for (const raw of [null, "", "used", "ghost:asc", "free:up"]) {
      expect(parseDriveSort(raw)).toEqual(DEFAULT_DRIVE_SORT);
    }
  });
});
