import { api } from "../../api/client";
import type { ListOrder } from "../../api/types";

const pending = new Map<string, Promise<number | null>>();

/** Share identical in-flight lookups; a later live tick still gets a fresh position. */
export function getRowPosition(generation: number, id: number, order: ListOrder) {
  const key = `${generation}:${id}:${order.key}:${order.descending}:${order.dirsOnly}`;
  const held = pending.get(key);
  if (held) return held;

  const request = api.getPosition(generation, id, order);
  pending.set(key, request);
  void request.then(
    () => pending.delete(key),
    () => pending.delete(key),
  );
  return request;
}
