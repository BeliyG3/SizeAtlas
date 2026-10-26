import { useStored } from "../../settings/storage";

const KEY = "sizeatlas.access.dismissed";

/** Root -> the `scannedAt` of the scan whose banner was closed. */
type Dismissed = Record<string, number>;

/** Accepts null and anything a user could have stored. */
export function parseDismissed(raw: string | null): Dismissed {
  if (raw === null) return {};
  try {
    const value: unknown = JSON.parse(raw);
    if (typeof value !== "object" || value === null || Array.isArray(value)) return {};
    return Object.fromEntries(
      Object.entries(value).filter(
        (entry): entry is [string, number] => typeof entry[1] === "number",
      ),
    );
  } catch {
    return {};
  }
}

const serialize = (value: Dismissed) => JSON.stringify(value);

export const withDismissed = (
  dismissed: Dismissed,
  root: string,
  scannedAt: number,
): Dismissed => ({
  ...dismissed,
  [root]: scannedAt,
});

export const isScanDismissed = (dismissed: Dismissed, root: string, scannedAt: number) =>
  dismissed[root] === scannedAt;

/**
 * Which scans had their access banner closed. A new scan of a root has a new `scannedAt`, so the
 * banner comes back for it; other roots are independent.
 */
export function useAccessDismissed() {
  const [dismissed, setDismissed] = useStored(KEY, parseDismissed, serialize);
  const isDismissed = (root: string, scannedAt: number) =>
    isScanDismissed(dismissed, root, scannedAt);
  const dismiss = (root: string, scannedAt: number) =>
    setDismissed(withDismissed(dismissed, root, scannedAt));
  return { isDismissed, dismiss };
}
