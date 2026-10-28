/**
 * The roads: dark ribbons as wide as each road, glowing axes on the highways, ramps and the ring,
 * bridges over the canal a little raised, and from every gate a bridge stub out over the sea.
 */
import {
  BufferGeometry,
  Color,
  Float32BufferAttribute,
  Group,
  LineBasicMaterial,
  LineSegments,
  Mesh,
  MeshBasicMaterial,
} from "three";
import { LOOK, ORDER } from "../look";
import { ROAD, type CityMap, type RoadKind } from "../world/map";
import { roadHalf, type RoadGraph } from "../world/roads";
import { disposeAll } from "./dispose";
import { flat } from "./flat";

/** A bridge's deck stands this high, metres. */
export const BRIDGE_RISE = 1;
/** A gate's bridge stub reaches this far out, metres. */
export const STUB = 400;
/** The ribbons lie this high over the ground layers, and the axes this high over the ribbons. */
const ROAD_Y = 0.08;
const AXIS_Y = 0.05;

/** Classes whose axis glows, with its colour. */
const AXIS: Partial<Record<RoadKind, string>> = {
  [ROAD.highway]: LOOK.lane,
  [ROAD.ramp]: LOOK.lane,
  [ROAD.ring]: LOOK.ring,
};

export function roadMesh(map: CityMap, g: RoadGraph): { group: Group; dispose(): void } {
  const ribbons: number[] = [];
  const axes: number[] = [];
  const axisColors: number[] = [];
  const at = (node: number) => [g.nodes[node * 2], g.nodes[node * 2 + 1]];

  const road = (x0: number, z0: number, x1: number, z1: number, cls: RoadKind, y: number) => {
    ribbon(ribbons, x0, z0, x1, z1, roadHalf(cls), y);
    const glow = AXIS[cls];
    if (!glow) return;
    const c = new Color(glow);
    axes.push(x0, y + AXIS_Y, z0, x1, y + AXIS_Y, z1);
    axisColors.push(c.r, c.g, c.b, c.r, c.g, c.b);
  };
  // Bridges go last, so their decks cover the road ends they meet.
  for (const bridges of [false, true]) {
    for (const e of g.edges) {
      if (e.bridge !== bridges) continue;
      const [x0, z0] = at(e.a);
      const [x1, z1] = at(e.b);
      road(x0, z0, x1, z1, e.cls, bridges ? BRIDGE_RISE : 0);
    }
  }
  for (const gate of map.gates) {
    const [x, z] = at(gate.node);
    const len = Math.hypot(gate.dx, gate.dz) || 1;
    const [dx, dz] = [(gate.dx / len) * STUB, (gate.dz / len) * STUB];
    road(x, z, x + dx, z + dz, ROAD.highway, BRIDGE_RISE);
  }

  const group = new Group();
  const deck = new BufferGeometry();
  deck.setAttribute("position", new Float32BufferAttribute(ribbons, 3));
  const mesh = new Mesh(deck, flat(new MeshBasicMaterial({ color: LOOK.road })));
  mesh.name = "roads";
  mesh.renderOrder = ORDER.road;
  mesh.position.y = ROAD_Y;
  const lines = new BufferGeometry();
  lines.setAttribute("position", new Float32BufferAttribute(axes, 3));
  lines.setAttribute("color", new Float32BufferAttribute(axisColors, 3));
  const glow = new LineSegments(lines, flat(new LineBasicMaterial({ vertexColors: true })));
  glow.name = "axes";
  glow.renderOrder = ORDER.axis;
  glow.position.y = ROAD_Y;
  group.add(mesh, glow);
  return { group, dispose: () => disposeAll(group) };
}

/**
 * Two triangles facing up: the road from (x0, z0) to (x1, z1), `half` to each side, its ends
 * carried `half` past the nodes so the ribbons of a junction close up.
 */
function ribbon(
  out: number[],
  x0: number,
  z0: number,
  x1: number,
  z1: number,
  half: number,
  y: number,
) {
  const len = Math.hypot(x1 - x0, z1 - z0);
  if (!(len > 0)) return;
  const ux = ((x1 - x0) / len) * half;
  const uz = ((z1 - z0) / len) * half;
  // a, b: the start's left and right; c, d: the end's. Left of the way is (−uz, ux).
  const ax = x0 - ux - uz;
  const az = z0 - uz + ux;
  const bx = x0 - ux + uz;
  const bz = z0 - uz - ux;
  const cx = x1 + ux - uz;
  const cz = z1 + uz + ux;
  const dx = x1 + ux + uz;
  const dz = z1 + uz - ux;
  out.push(ax, y, az, cx, y, cz, bx, y, bz, bx, y, bz, cx, y, cz, dx, y, dz);
}
