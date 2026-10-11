import { useStored } from "../../settings/storage";
import { moveColumn, parseOrder, serializeOrder } from "./order";

/**
 * Column order stored under `key` as a JSON array; `defaults` must be a module-level constant.
 * Returns the order and the move handler for useColumnDrag.
 */
export function useColumnOrder<K extends string>(key: string, defaults: readonly K[]) {
  const [order, setOrder] = useStored<readonly K[]>(
    key,
    (raw) => parseOrder(raw, defaults),
    serializeOrder,
  );
  const move = (id: K, before: K | null) => setOrder(moveColumn(order, id, before));
  return [order, move] as const;
}
