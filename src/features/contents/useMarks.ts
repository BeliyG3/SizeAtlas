import { useState } from "react";
import { marksFor, marksKey, noMarks, type Marks } from "./marks";

/**
 * The marks of a table. Marks of another listing or selection are dropped, not only hidden:
 * they must not come back when the same selection does (A, then B, then A again).
 */
export function useMarks(listKey: string, selectedId: number) {
  const key = marksKey(listKey, selectedId);
  const [stored, setStored] = useState<Marks>(() => noMarks(key));
  const marks = marksFor(stored, key);
  if (marks !== stored) setStored(marks);
  return [marks, setStored] as const;
}
