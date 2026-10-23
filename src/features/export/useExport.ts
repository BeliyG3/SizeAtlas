import { useCallback, useRef } from "react";
import { api } from "../../api/client";
import type { ReasonDto } from "../../api/types";
import { formatCount } from "../../format";
import { useT } from "../../i18n/react";
import { useStored } from "../../settings/storage";
import { reasonText } from "../cleanup/reason";
import { parseSeparator, tableCsv, type Separator } from "./csv";
import { gather, TreeChanged } from "./gather";
import { exportFileName } from "./names";
import type { ExportSource, RegisterSource } from "./source";

/** The separator of the last export: Ctrl+E uses it again. */
const SEPARATOR_KEY = "sizeatlas.export.separator";

/**
 * File › Export table: the table on the right (offered through ExportContext) goes to a CSV file
 * that the native Save dialog names. `push` shows the result, `onError` a failure.
 */
export function useExport(push: (text: string) => void, onError: (e: unknown) => void) {
  const { t, lang } = useT();
  const [separator, setSeparator] = useStored(SEPARATOR_KEY, parseSeparator);
  const source = useRef<ExportSource | null>(null);
  const running = useRef(false);

  const register = useCallback<RegisterSource>((offered) => {
    source.current = offered;
    return () => {
      if (source.current === offered) source.current = null;
    };
  }, []);

  /** Event handlers only (reads the offered table). */
  const run = async (chosen: Separator) => {
    const shown = source.current;
    if (!shown) {
      // No root is open, or the table is still loading.
      push(t("export.nothing"));
      return;
    }
    if (running.current) return;
    setSeparator(chosen);
    running.current = true;
    try {
      const table = await gather(shown);
      const header = [t("export.fullPath"), ...shown.columns.map((id) => t(`col.${id}`))];
      // The command of a tool goes after the words, as in the table.
      const reasonWords = (r: ReasonDto) =>
        r.command ? `${reasonText(r, t)} — ${r.command}` : reasonText(r, t);
      const text = tableCsv({ ...table, header, columns: shown.columns, reasonWords }, chosen);
      const name = shown.kind === "folder" ? table.folderName : t(`mode.${shown.list}`);
      const saved = await api.exportTable(exportFileName(name, new Date()), text);
      if (saved !== null) {
        const count = table.items.length;
        push(t("export.done", { count, rows: formatCount(count, lang), file: saved }));
      }
    } catch (e) {
      if (e instanceof TreeChanged) push(t("export.changed"));
      else onError(e);
    } finally {
      running.current = false;
    }
  };

  return { register, separator, run };
}
