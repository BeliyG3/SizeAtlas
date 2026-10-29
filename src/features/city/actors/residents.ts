/** Residents walking the sidewalks of streets and the lanes between blocks; pure, no three.js. */
import { ROAD, type RoadKind } from "../world/map";
import { pointOn, roadHalf, type RoadEdge, type RoadGraph } from "../world/roads";
import { advance, place, rng, type Track } from "./nav";

/** What a figure is; stage 1 has only residents. */
export const ROLE = { resident: 0, police: 1, virus: 2 } as const;

/** Walking speed and its spread over the residents, m/s. */
export const WALK = 1.4;
export const WALK_SPREAD = 0.3;
/** Metres per walk cycle: the phase goes round once for this much distance. */
export const STRIDE = 1.6;
/** Residents within this many metres of the camera are drawn as models, the rest as dots. */
export const NEAR = 80;

// Sideways distance of a walker on a lane from its axis, metres.
const LANE_WALK = 1.2;

/** Distance from the axis at which people walk on a road class; 0 where nobody walks. */
export function walkOffset(cls: RoadKind): number {
  if (cls === ROAD.street) return roadHalf(cls) - 1; // the middle of the 2 m sidewalk
  return cls === ROAD.lane ? LANE_WALK : 0;
}

export interface Residents {
  count: number;
  x: Float32Array;
  /** Height of the feet: a bridge's deck, else the ground. */
  y: Float32Array;
  z: Float32Array;
  heading: Float32Array;
  /** Walk cycle, `0…1`. */
  phase: Float32Array;
  role: Uint8Array;
  update(dt: number): void;
}

const walks = (e: RoadEdge) => walkOffset(e.cls) > 0;

export function createResidents(g: RoadGraph, count: number, seed: number): Residents {
  const rand = rng(seed);
  const n = g.edges.some(walks) ? Math.max(0, Math.floor(count)) : 0;
  const t: Track = {
    edge: new Int32Array(n),
    s: new Float32Array(n),
    forward: new Uint8Array(n),
  };
  const speed = new Float32Array(n);
  const side = new Int8Array(n); // +1 walks on the right of the travel, -1 on the left
  const out: Residents = {
    count: n,
    x: new Float32Array(n),
    y: new Float32Array(n),
    z: new Float32Array(n),
    heading: new Float32Array(n),
    phase: new Float32Array(n),
    role: new Uint8Array(n).fill(ROLE.resident),
    update,
  };

  const chooseSide = (i: number) => {
    side[i] = rand() < 0.5 ? 1 : -1;
  };

  function put(i: number) {
    const e = g.edges[t.edge[i]];
    const p = pointOn(g, t.edge[i], t.s[i], t.forward[i] === 1, side[i] * walkOffset(e.cls));
    out.x[i] = p.x;
    out.y[i] = p.y; // on the deck of a bridge, as the cars
    out.z[i] = p.z;
    out.heading[i] = p.heading;
  }

  function update(dt: number) {
    for (let i = 0; i < n; i++) {
      const edge = t.edge[i];
      const forward = t.forward[i];
      const dist = speed[i] * dt;
      advance(g, t, i, dist, rand, walks);
      // The side is kept along an edge and chosen again on entering the next one (or turning back).
      if (t.edge[i] !== edge || t.forward[i] !== forward) chooseSide(i);
      out.phase[i] = (out.phase[i] + dist / STRIDE) % 1;
      if (out.phase[i] >= 1) out.phase[i] = 0; // a float32 can round up to exactly 1
      put(i);
    }
  }

  for (let i = 0; i < n; i++) {
    place(g, t, i, rand, walks);
    speed[i] = WALK + (rand() * 2 - 1) * WALK_SPREAD;
    out.phase[i] = rand();
    chooseSide(i);
    put(i);
  }
  return out;
}

/**
 * Splits the first `count` figures into those within `near` metres of the camera `c` and the
 * rest, writing their indices to `out.near` and `out.far`; returns how many went into each.
 */
export function splitNear(
  r: { x: ArrayLike<number>; y: ArrayLike<number>; z: ArrayLike<number> },
  count: number,
  c: { x: number; y: number; z: number },
  near: number,
  out: { near: Int32Array; far: Int32Array },
): { near: number; far: number } {
  let n = 0;
  let f = 0;
  const r2 = near * near;
  for (let i = 0; i < count; i++) {
    const dx = r.x[i] - c.x;
    const dy = r.y[i] - c.y;
    const dz = r.z[i] - c.z;
    if (dx * dx + dy * dy + dz * dz <= r2) out.near[n++] = i;
    else out.far[f++] = i;
  }
  return { near: n, far: f };
}
