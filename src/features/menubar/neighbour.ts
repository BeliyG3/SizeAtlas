/** The id `step` places after `id` in `ids` (before it for a negative step), wrapping at both ends. */
export function neighbour(ids: readonly string[], id: string, step: number): string {
  const at = ids.indexOf(id);
  return ids[(at + step + ids.length) % ids.length];
}
