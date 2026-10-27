import { useCallback, useEffect, useRef, useState } from "react";
import { api, onDuplicatesStatus } from "../../api/client";
import type { DupEstimate, DupStatus, Duplicates } from "../../api/duplicates";
import { applyAnswer, shouldFetch, type DupState } from "./groups";

interface Options {
  /** The words of the search field (committed). */
  query: string;
  /** "Include system folders". */
  system: boolean;
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
 * follows the query, the switch and the roots.
 */
export function useDuplicates({ query, system, rootsKey, onFail }: Options) {
  const [state, setState] = useState<DupState | null>(null);
  const [status, setStatus] = useState<DupStatus | null>(null);
  const [estimate, setEstimate] = useState<DupEstimate | null>(null);
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
    api.estimateDuplicates(query, system).then(
      (next) => {
        if (live) setEstimate(next);
      },
      (e: unknown) => {
        if (live) fail.current(e);
      },
    );
    return () => {
      live = false;
    };
  }, [query, system, rootsKey]);

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
      api.findDuplicates(words, system).then(
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
    [system, fetch],
  );
  const cancel = useCallback(() => {
    api.cancelDuplicates().catch((e: unknown) => fail.current(e));
  }, []);

  return { state, status, estimate, finding, find, cancel, refresh: fetch };
}
