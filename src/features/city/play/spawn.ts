/**
 * Where the player starts: on a street's sidewalk by the selected folder (none: by the middle of
 * the first island), on the ground, clear of houses and water, with their own car parked at the
 * kerb beside them; pure, no three.js.
 */
import { walkOffset } from "../actors/residents";
import { CAR_DISCS, CAR_RADIUS, PERSON_RADIUS } from "../physics/bodies";
import type { Solids } from "../physics/solids";
import type { Focus, World } from "../world/buildings";
import { POLY, ROAD, type RoadKind } from "../world/map";
import { pointOn, type RoadGraph, type RoadPoint } from "../world/roads";
import { islandBox } from "../world/views";

export interface Spawn {
  x: number;
  z: number;
  /** The way the player faces, `atan2(x, z)`: along the street. */
  yaw: number;
  /** The player's car at the kerb, nose along the traffic; null where no road has room for it. */
  car: { x: number; z: number; yaw: number } | null;
}

/**
 * Where the car parks by the player, metres from the road's axis and ahead along the way: a
 * street's outer lane beside them, the middle of a narrow lane a little ahead.
 */
const PARK = {
  [ROAD.street]: { offset: 2.2, ahead: 0 },
  [ROAD.lane]: { offset: 0, ahead: 4.5 },
};
/** Spots along a street are tried this far apart, metres... */
const SPACING = 3;
/** ...and no nearer its ends than this: the junctions. */
const END = 4;
/** Points around a disc's rim that must be clear. */
const RIM = 8;

/** The middle of the selected folder's polygons, or of the first island; null if neither exists. */
function targetOf(world: World, selected: Focus | null): { x: number; z: number } | null {
  if (selected) {
    let x0 = Infinity;
    let z0 = Infinity;
    let x1 = -Infinity;
    let z1 = -Infinity;
    for (const p of world.map.polys) {
      const folder = p.kind === POLY.district || p.kind === POLY.block || p.kind === POLY.house;
      if (!folder || p.island !== selected.island || p.id !== selected.id) continue;
      for (let i = 0; i < p.points.length; i += 2) {
        x0 = Math.min(x0, p.points[i]);
        x1 = Math.max(x1, p.points[i]);
        z0 = Math.min(z0, p.points[i + 1]);
        z1 = Math.max(z1, p.points[i + 1]);
      }
    }
    if (x0 !== Infinity) return { x: (x0 + x1) / 2, z: (z0 + z1) / 2 };
  }
  const box = islandBox(world, 0);
  return box && { x: (box.min[0] + box.max[0]) / 2, z: (box.min[2] + box.max[2]) / 2 };
}

/** A disc of `radius` at (x, z) on the bare ground: no house, deck or water under any of it. */
function clear(s: Solids, x: number, z: number, radius: number): boolean {
  for (let i = 0; i <= RIM; i++) {
    const a = (i * 2 * Math.PI) / RIM;
    const r = i === RIM ? 0 : radius;
    const px = x + Math.cos(a) * r;
    const pz = z + Math.sin(a) * r;
    if (s.heightAt(px, pz) !== 0 || s.isWater(px, pz)) return false;
  }
  return true;
}

/** The car's discs at the kerb beside `at` (on the way of `at.heading`) are all clear. */
function carFits(s: Solids, at: RoadPoint): boolean {
  const sin = Math.sin(at.heading);
  const cos = Math.cos(at.heading);
  return CAR_DISCS.every((d) => clear(s, at.x + sin * d, at.z + cos * d, CAR_RADIUS));
}

/**
 * The clear spot nearest `target` on the roads of class `cls` (null: any road, on its axis, with
 * no car), its car parked beside it on a street or a lane.
 */
function onRoads(
  g: RoadGraph,
  s: Solids,
  target: { x: number; z: number },
  cls: RoadKind | null,
): Spawn | null {
  const walk: RoadPoint = { x: 0, y: 0, z: 0, heading: 0 };
  const kerb: RoadPoint = { x: 0, y: 0, z: 0, heading: 0 };
  const park = cls === null ? null : PARK[cls as keyof typeof PARK];
  const offset = cls === null ? 0 : walkOffset(cls);
  let best: Spawn | null = null;
  let bestD = Infinity;
  // ponytail: every road is tried every 3 m, some 100k spots on a big archipelago, once on entry;
  // bin the roads by area if the start ever stalls.
  g.edges.forEach((e, i) => {
    if ((cls !== null && e.cls !== cls) || e.bridge || e.liftA !== 0 || e.liftB !== 0) return;
    const n = Math.max(1, Math.floor((e.len - 2 * END) / SPACING) + 1);
    for (let k = 0; k < n; k++) {
      const along = n === 1 ? e.len / 2 : END + k * SPACING;
      // Each side of the street: its sidewalk is to the right of the way along it.
      for (const forward of [true, false]) {
        pointOn(g, i, along, forward, offset, walk);
        const d = Math.hypot(walk.x - target.x, walk.z - target.z);
        if (d >= bestD || !clear(s, walk.x, walk.z, PERSON_RADIUS + 0.15)) continue;
        if (park) {
          pointOn(g, i, along + park.ahead, forward, park.offset, kerb);
          if (!carFits(s, kerb)) continue;
        }
        bestD = d;
        best = {
          x: walk.x,
          z: walk.z,
          yaw: walk.heading,
          car: park && { x: kerb.x, z: kerb.z, yaw: kerb.heading },
        };
      }
    }
  });
  return best;
}

/**
 * The clear spot nearest `target` anywhere on land, searched in rings out to `reach` metres, each
 * a twentieth of its radius (at least 2 m) past the last; null if there is none.
 */
function onLand(
  s: Solids,
  target: { x: number; z: number },
  reach: number,
): { x: number; z: number } | null {
  // ponytail: some 125 spots a ring, about 15k out to a 14 km map's corner; a finer search if a
  // narrow strip of land is ever missed.
  for (let r = 0; r <= reach; r += Math.max(2, r / 20)) {
    const n = r === 0 ? 1 : Math.ceil((2 * Math.PI * r) / Math.max(2, r / 20));
    for (let k = 0; k < n; k++) {
      const x = target.x + Math.cos((k * 2 * Math.PI) / n) * r;
      const z = target.z + Math.sin((k * 2 * Math.PI) / n) * r;
      if (clear(s, x, z, PERSON_RADIUS + 0.15)) return { x, z };
    }
  }
  return null;
}

/**
 * Where to start, nearest the selected folder's middle (`selected` null: the first island's):
 * on a street's sidewalk with the car at the kerb beside it, else on a lane's with the car just
 * ahead, else on any road, else on bare land, all clear (see `clear`); the last two carless. Only
 * a map without a clear spot of land starts at the target itself.
 */
export function spawnPoint(world: World, g: RoadGraph, s: Solids, selected: Focus | null): Spawn {
  const { width, height } = world.map;
  const target = targetOf(world, selected) ?? { x: width / 2, z: height / 2 };
  for (const cls of [ROAD.street, ROAD.lane, null]) {
    const found = onRoads(g, s, target, cls);
    if (found) return found;
  }
  const land = onLand(s, target, Math.hypot(width, height)) ?? target;
  return { ...land, yaw: 0, car: null };
}
