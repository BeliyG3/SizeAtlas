export interface Version {
  generation: number;
  rev: number;
}

/** True when `response` describes an older tree than `latest` and must be ignored. */
export function isStale(latest: Version, response: Version): boolean {
  return (
    response.generation < latest.generation ||
    (response.generation === latest.generation && response.rev < latest.rev)
  );
}
