import { ROUTE_POINTS, ROUTE_STEP, type Routes } from "../world/routes";

/** One route east along z = 0 from x = 0 to 200 m, 1 m up, 3 m to the side, and back: 400 m. */
export function line(): Routes {
  const steps = 200 / ROUTE_STEP;
  const points = new Float32Array(ROUTE_POINTS * 4);
  for (let k = 0; k <= 2 * steps; k++) {
    const x = (k <= steps ? k : 2 * steps - k) * ROUTE_STEP;
    points.set([x, 1, 0, 3], k * 4);
  }
  return { count: 1, points, length: new Float32Array([400]) };
}
