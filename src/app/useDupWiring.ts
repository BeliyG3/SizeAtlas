import { useState } from "react";
import type { DupMenuTrash, DupWiring } from "../features/duplicates/DuplicatesView";
import type { DupRuns } from "../features/duplicates/useDupTrash";
import { menuTrashFor } from "../features/duplicates/keep";
import type { Mode } from "../features/lists/modes";

/** What the usual trash (`useTrash`) offers the menu bar, Delete and the duplicates. */
interface Trash {
  runs: DupRuns;
  menuTrash: (() => void) | null;
  trashNote: string | null;
}

/**
 * What the duplicates mode gets from the app (`duplicates`, passed through the browser), and what
 * Delete outside the tables and Scan › Move to the trash do in `mode`: in the duplicates mode the
 * copies picked there (the tree's selection is hidden, and their own trash keeps one copy),
 * elsewhere the usual trash.
 */
export function useDupWiring(
  mode: Mode,
  trash: Trash,
  wiring: Omit<DupWiring, "runs" | "onMenuTrash">,
) {
  const [dupTrash, setDupTrash] = useState<DupMenuTrash>({ run: null, note: null });
  const duplicates: DupWiring = { ...wiring, runs: trash.runs, onMenuTrash: setDupTrash };
  return {
    duplicates,
    menuTrash: menuTrashFor(mode, trash.menuTrash, dupTrash.run),
    trashNote: menuTrashFor(mode, trash.trashNote, dupTrash.note),
  };
}
