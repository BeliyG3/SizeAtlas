import { useCallback, useState } from "react";

/** Storage is a convenience only: it can be unavailable or full. */
export function readStored(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

export function writeStored(key: string, value: string | null): void {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch {
    // Not remembering is acceptable.
  }
}

/**
 * State that survives restarts. `parse` must accept null and anything a user could have
 * stored; `serialize` must be a stable function (declared at module level).
 */
export function useStored<T>(
  key: string,
  parse: (raw: string | null) => T,
  serialize: (value: T) => string = String,
): [T, (value: T) => void] {
  const [value, setValue] = useState(() => parse(readStored(key)));
  const set = useCallback(
    (next: T) => {
      setValue(next);
      writeStored(key, serialize(next));
    },
    [key, serialize],
  );
  return [value, set];
}
