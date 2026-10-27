import { formatDate } from "../../format";
import { useT } from "../../i18n/react";
import { GridHeader } from "../columns/GridHeader";
import type { Column, HeaderSort } from "./columns";
import type { ColumnLayout } from "./useColumnLayout";

interface Props {
  layout: ColumnLayout;
  /** The column with the arrow; null for none (a flat list in its own order). */
  sort: HeaderSort | null;
  /** Columns whose header sorts. */
  canSort: (column: Column) => boolean;
  /** Tooltip of the size columns: how sizes on disk were measured. */
  sizeHint: string;
  /** When the scan the Change column compares with was made, in seconds; null without one. */
  baselineAt: number | null;
  /** A sortable header was clicked. */
  onSort: (column: Column) => void;
}

/** The header of the folder table and the flat lists: `GridHeader` with their tooltips. */
export function TableHeader({ layout, sort, canSort, sizeHint, baselineAt, onSort }: Props) {
  const { t, lang } = useT();
  const title = (c: Column, label: string) => {
    if (c.id === "size" || c.id === "percent") return sizeHint;
    if (c.id === "change" && baselineAt !== null)
      return t("col.changeHint", { date: formatDate(baselineAt * 1000, lang) });
    return label;
  };
  return <GridHeader layout={layout} sort={sort} canSort={canSort} onSort={onSort} title={title} />;
}
