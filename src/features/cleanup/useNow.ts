import { useEffect, useState } from "react";

/** The time in ms, read again every `periodMs` and when the window gets the focus. */
export function useNow(periodMs: number): number {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    const tick = () => setNow(Date.now());
    const timer = setInterval(tick, periodMs);
    // A sleeping laptop wakes up with the timer still waiting for its period.
    window.addEventListener("focus", tick);
    return () => {
      clearInterval(timer);
      window.removeEventListener("focus", tick);
    };
  }, [periodMs]);
  return now;
}
