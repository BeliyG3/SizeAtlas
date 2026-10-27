import type { TrashPreview } from "../../api/types";

/** Paths a preview lists, as `trash_preview` does. */
const SHOWN_PATHS = 10;

/**
 * One preview of copies in several trees (`trash_preview` per tree): counts and sizes summed,
 * the first paths, the oldest scan, and the smallest free space of the bins that is known.
 */
export function mergePreviews(previews: readonly TrashPreview[]): TrashPreview {
  const free = previews.map((p) => p.binFree).filter((f): f is number => f !== null);
  const sum = (pick: (p: TrashPreview) => number) => previews.reduce((n, p) => n + pick(p), 0);
  return {
    count: sum((p) => p.count),
    size: sum((p) => p.size),
    binSize: sum((p) => p.binSize),
    paths: previews.flatMap((p) => p.paths).slice(0, SHOWN_PATHS),
    scannedAt: Math.min(...previews.map((p) => p.scannedAt)),
    binFree: free.length === 0 ? null : Math.min(...free),
  };
}
