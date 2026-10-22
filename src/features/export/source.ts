import { createContext, useContext, useEffect } from "react";
import type { ListItem, ListKind, ListOrder } from "../../api/types";
import type { ColumnId } from "../contents/columns";

/** What the table on the right shows now: File › Export table writes it. */
export type ExportSource =
  | {
      kind: "folder";
      generation: number;
      folder: number;
      /** The table's sort and filter. */
      order: ListOrder;
      /** The visible columns in their order. */
      columns: readonly ColumnId[];
    }
  | {
      kind: "list";
      generation: number;
      /** The folder whose subtree is listed. */
      base: number;
      list: ListKind;
      /** The words of a "search" list; read again with them while a scan runs. */
      query?: string;
      /** The rows in the table's order. */
      rows: readonly ListItem[];
      /** Revision of the tree the list was made from. */
      rev: number;
      /** Size on disk of `base`: the base of the percentages. */
      size: number;
      columns: readonly ColumnId[];
    };

/** Makes `source` the one to export; the returned function withdraws it. */
export type RegisterSource = (source: ExportSource) => () => void;

export const ExportContext = createContext<RegisterSource>(() => () => {});

/** Offers what a table shows to the export while it is mounted. `source`: memoized, null while loading. */
export function useExportSource(source: ExportSource | null) {
  const register = useContext(ExportContext);
  useEffect(() => (source ? register(source) : undefined), [register, source]);
}
