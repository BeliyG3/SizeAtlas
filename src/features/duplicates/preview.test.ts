import { describe, expect, it } from "vitest";
import type { TrashPreview } from "../../api/types";
import { mergePreviews } from "./preview";

const preview = (more: Partial<TrashPreview>): TrashPreview => ({
  count: 1,
  size: 1,
  scannedAt: 100,
  paths: [],
  binFree: null,
  binSize: 1,
  ...more,
});

describe("mergePreviews", () => {
  it("sums the counts and sizes, keeps ten paths in order and the oldest scan", () => {
    const paths = (from: number, n: number) => Array.from({ length: n }, (_, i) => `/p${from + i}`);
    const merged = mergePreviews([
      preview({ count: 6, size: 10, binSize: 12, scannedAt: 300, paths: paths(0, 6) }),
      preview({ count: 6, size: 20, binSize: 22, scannedAt: 200, paths: paths(6, 6) }),
    ]);
    expect(merged).toMatchObject({ count: 12, size: 30, binSize: 34, scannedAt: 200 });
    expect(merged.paths).toEqual(paths(0, 10));
  });

  it("takes the smallest free space that is known", () => {
    const free = (...values: (number | null)[]) =>
      mergePreviews(values.map((binFree) => preview({ binFree }))).binFree;
    expect(free(null, 5, 3)).toBe(3);
    expect(free(null)).toBeNull();
  });
});
