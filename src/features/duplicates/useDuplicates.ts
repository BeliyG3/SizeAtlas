import { useCallback, useEffect, useRef, useState } from "react";
import { api, onDuplicatesStatus } from "../../api/client";
import type { DupEstimate, DupScope, DupStatus, Duplicates } from "../../api/duplicates";
import { crumbsPath } from "../export/names";
import { applyAnswer, shouldFetch, type DupState } from "./groups";

interface Options {
  /** The words of the search field (committed). */
  query: string;
  /** "Include system folders". */
  system: boolean;
  /** The folder searched; null for every open root. */
  scope: DupScope | null;
  /** Changes whenever an open root does (opened, closed, rescanned, changed). */
  rootsKey: string;
  onFail: (e: unknown) => void;
}

/**
 * `next` over `shown`, or null when it is older. Within one version the stale mark only turns
 * on: answers read before a status may land after it.
 */
function merged(next: DupStatus, shown: DupStatus | null): DupStatus | null {
  if (!shown || next.job > shown.job) return next;
  if (next.job < shown.job || next.version < shown.version) return null;
  return next.version > shown.version ? next : { ...next, stale: next.stale || shown.stale };
}

/**
 * The duplicates result the backend keeps, read by cursor: on mount (a search never starts by
 * itself, so a result outlives leaving the mode), when the roots change (the stale mark follows
 * them) and when a status says there is more. The estimate of what a search would compare
 * follows the query, the switch, the folder and the roots; the path of the folder is read at once,
 * so the line naming it does not wait for the estimate.
 */
export function useDuplicates({ query, system, scope, rootsKey, onFail }: Options) {
  const [state, setState] = useState<DupState | null>(null);
  const [status, setStatus] = useState<DupStatus | null>(null);
  // The last estimate and what it was asked for: one of an older ask is not the current one.
  const ask = JSON.stringify([query, system, scope, rootsKey]);
  const [estimated, setEstimated] = useState<{ ask: string; estimate: DupEstimate } | null>(null);
  const [folder, setFolder] = useState<{ scope: DupScope; path: string } | null>(null);
  // A Find sent and not answered yet: a second one would start a job that cancels the first.
  const [finding, setFinding] = useState(false);
  const sending = useRef(false);
  // The answers land after renders: they read and update the state here, not in a closure.
  const shown = useRef<{ state: DupState | null; status: DupStatus | null }>({
    state: null,
    status: null,
  });
  const lifecycle = useRef({ live: false });
  const fail = useRef(onFail);
  useEffect(() => {
    fail.current = onFail;
  }, [onFail]);

  const showStatus = useCallback((next: DupStatus) => {
    const status = merged(next, shown.current.status);
    if (!status) return;
    shown.current.status = status;
    setStatus(status);
  }, []);
  const take = useCallback(
    (answer: Duplicates) => {
      const before = shown.current.state;
      const next = applyAnswer(before, answer);
      if (next === before) return;
      shown.current.state = next;
      setState(next);
      showStatus(answer.status);
    },
    [showStatus],
  );
  const fetch = useCallback(() => {
    const life = lifecycle.current;
    const at = shown.current.state;
    api.getDuplicates(at?.job ?? 0, at?.version ?? 0).then(
      (answer) => {
        if (life.live) take(answer);
      },
      (e: unknown) => {
        if (life.live) fail.current(e);
      },
    );
  }, [take]);

  useEffect(() => {
    const life = { live: true };
    lifecycle.current = life;
    const unlisten = onDuplicatesStatus((next) => {
      if (!life.live) return;
      showStatus(next);
      if (shouldFetch(shown.current.state, next)) fetch();
    });
    return () => {
      life.live = false;
      void unlisten.then((off) => off());
    };
  }, [fetch, showStatus]);

  // On mount too: the first read is the whole kept result.
  useEffect(fetch, [fetch, rootsKey]);

  useEffect(() => {
    let live = true;
    api.estimateDuplicates(query, system, scope).then(
      (estimate) => {
        if (live) setEstimated({ ask, estimate });
      },
      (e: unknown) => {
        if (live) fail.current(e);
      },
    );
    return () => {
      live = false;
    };
  }, [query, system, scope, rootsKey, ask]);

  // The same text the estimate names the folder with, without its walk of the folder.
  useEffect(() => {
    if (!scope) return;
    let live = true;
    api.getCrumbs(scope.generation, scope.folder).then(
      (crumbs) => {
        if (live) setFolder({ scope, path: crumbsPath(crumbs) });
      },
      // A folder out of date: its estimate tells.
      () => {},
    );
    return () => {
      live = false;
    };
  }, [scope]);
  const estimate = estimated?.estimate ?? null;
  const estimating = estimated?.ask !== ask;
  /** The folder Find searches now, by path; null for every open root. */
  let target = estimate?.scope ?? null;
  if (estimating && !scope) target = null;
  else if (estimating && folder?.scope === scope) target = folder.path;

  /** Searches for `words` (the text in the field, not the debounced query). */
  const find = useCallback(
    (words: string) => {
      if (sending.current) return;
      sending.current = true;
      setFinding(true);
      const life = lifecycle.current;
      const sent = () => {
        sending.current = false;
        if (life.live) setFinding(false);
      };
      api.findDuplicates(words, system, scope).then(
        () => {
          sent();
          // The job's own status asks for its result; this read covers a status sent before it.
          if (life.live) fetch();
        },
        (e: unknown) => {
          sent();
          if (life.live) fail.current(e);
        },
      );
    },
    [system, scope, fetch],
  );
  const cancel = useCallback(() => {
    api.cancelDuplicates().catch((e: unknown) => fail.current(e));
  }, []);

  return { state, status, estimate, estimating, target, finding, find, cancel, refresh: fetch };
}
