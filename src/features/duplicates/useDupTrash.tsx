import { useRef, useState, type ReactNode } from "react";
import { api, isCmdError } from "../../api/client";
import type { DupCopy, DupRef } from "../../api/duplicates";
import type { Summary, TrashPreview } from "../../api/types";
import { formatCount } from "../../format";
import { useT } from "../../i18n/react";
import { useSize } from "../../settings/react";
import type { TrashRun } from "../trash/runs";
import { trashReport } from "../trash/text";
import { TrashDialog } from "../trash/TrashDialog";
import { mergePreviews } from "./preview";

/** The requests the user sees (`useTrashRun`): a request of duplicates is one more of them. */
export interface DupRuns {
  start: (run: TrashRun) => number;
  end: (request: number) => void;
}

interface Args {
  /** The open roots: the revision of each tree for its preview. */
  entries: readonly { summary: Summary | null }[];
  runs: DupRuns;
  /** Whether a request, started or waiting, has one of `ids` of the tree with `generation`. */
  isRemoving: (generation: number, ids: readonly number[]) => boolean;
  push: (text: string) => void;
  errorText: (e: unknown) => string;
  onError: (e: unknown) => void;
  /** Reads the result again: the request changed it, or found it out of date. */
  refresh: () => void;
}

interface Asking {
  copies: readonly DupCopy[];
  preview: TrashPreview;
  /** One per question: a new one gets a new dialog. */
  serial: number;
}

const isCode = (e: unknown, code: string) => isCmdError(e) && e.code === code;

/** The paths of `refs` by tree, in the order of their first path. */
function byTree(refs: readonly DupRef[]) {
  const trees = new Map<number, { generation: number; root: string; ids: number[] }>();
  for (const { generation, root, id } of refs) {
    const known = trees.get(generation);
    if (known) known.ids.push(id);
    else trees.set(generation, { generation, root, ids: [id] });
  }
  return [...trees.values()];
}

/**
 * The trash of copies of one group: the preview of every tree they lie in, merged into the usual
 * dialog, then one request of all their paths (`trash_duplicates`, which keeps one copy and
 * never deletes for good), shown and stopped like any other. A request refused as out of date is
 * not sent again (the group changed): the result is read again and says "find again".
 * `trashing`: a request was sent and has no answer yet; Find waits for it (the backend refuses).
 */
export function useDupTrash({
  entries,
  runs,
  isRemoving,
  push,
  errorText,
  onError,
  refresh,
}: Args) {
  const { t, lang } = useT();
  const size = useSize();
  const [asking, setAsking] = useState<Asking | null>(null);
  const [trashing, setTrashing] = useState(0);
  const questions = useRef(0);
  const removing = (refs: readonly DupRef[]) => refs.some((r) => isRemoving(r.generation, [r.id]));

  /** The preview of `ids` of a tree at its current revision; a closed tree is out of date. */
  const preview = (generation: number, ids: number[]) => {
    const rev = entries.find((e) => e.summary?.generation === generation)?.summary?.rev;
    if (rev === undefined) return Promise.reject({ code: "StaleId" });
    return (
      api
        .trashPreview(generation, rev, ids)
        // A request of the tree ended after the view read it: preview at the revision it left.
        .catch((e: unknown) =>
          isCode(e, "StaleId")
            ? api.getSummary(generation).then((s) => api.trashPreview(generation, s.rev, ids))
            : Promise.reject(e),
        )
    );
  };

  const ask = (copies: readonly DupCopy[]) => {
    const refs = copies.flatMap((c) => c.refs);
    if (refs.length === 0) return;
    if (removing(refs)) {
      push(t("trash.already"));
      return;
    }
    Promise.all(byTree(refs).map((tree) => preview(tree.generation, tree.ids))).then(
      (previews) => {
        const serial = ++questions.current;
        // ponytail: one question at a time; a second one while the dialog is open is dropped.
        setAsking((open) => open ?? { copies, preview: mergePreviews(previews), serial });
      },
      (e: unknown) => {
        if (isCode(e, "Busy"))
          push(t(refs.length > 1 ? "trash.scanningItems" : "trash.scanningItem"));
        else if (isCode(e, "StaleId")) {
          push(t("trash.notRemoved"));
          refresh();
        } else onError(e);
      },
    );
  };

  const send = ({ copies, preview }: Asking) => {
    const refs = copies.flatMap((c) => c.refs);
    const [first, ...more] = byTree(refs);
    const request = runs.start({ ...first, preview, purge: false, more });
    setTrashing((n) => n + 1);
    api
      .trashDuplicates(request, refs)
      .then(
        (result) => {
          const count = (n: number) => formatCount(n, lang);
          for (const text of trashReport(result, preview, t, errorText, count, size, "trash"))
            push(text);
        },
        (e: unknown) => (isCode(e, "StaleId") ? push(t("trash.notRemoved")) : onError(e)),
      )
      .finally(() => {
        runs.end(request);
        setTrashing((n) => n - 1);
        refresh();
      });
  };

  const confirm = () => {
    if (!asking) return;
    setAsking(null);
    // Another request may have taken one of the copies while the dialog was open.
    if (removing(asking.copies.flatMap((c) => c.refs))) {
      push(t("trash.already"));
      return;
    }
    send(asking);
  };

  const dialog: ReactNode = asking && (
    <TrashDialog
      key={asking.serial}
      preview={asking.preview}
      cleanup={false}
      onConfirm={confirm}
      onClose={() => setAsking(null)}
    />
  );
  return { ask, trashing: trashing > 0, dialog };
}
