import { useEffect, useState } from "react";

/** The query reaches the table this long after the last keystroke. */
export const SEARCH_DELAY_MS = 250;

/** The words with single spaces: adding a space changes nothing, so it does not search again. */
const words = (query: string) => query.trim().replace(/\s+/g, " ");

/**
 * The query the table searches for: `query` once it has stayed the same for `SEARCH_DELAY_MS`,
 * at once after `commit` (Enter), and "" at once when `query` is blank (Esc, ×, a mode, leaving
 * the search), so the old words never come back while new ones are typed. Not `useDebounced`: its
 * value lags behind a clear and would show the old results again for a moment.
 */
export function useCommittedQuery(query: string) {
  const [committed, setCommitted] = useState("");
  const blank = query.trim() === "";
  // Adjusted while rendering, as React recommends for state that follows a prop.
  if (blank && committed !== "") setCommitted("");
  useEffect(() => {
    if (blank) return;
    const timer = setTimeout(() => setCommitted(words(query)), SEARCH_DELAY_MS);
    return () => clearTimeout(timer);
  }, [query, blank]);
  return { committed, commit: (query: string) => setCommitted(words(query)) };
}
