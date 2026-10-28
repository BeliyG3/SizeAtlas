/** The flat island: the sea, the shore, the land, the open lots and the canal, and their outlines. */
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
import { POLY, type CityMap, type PolyKind } from "../world/map";
import { disposeAll } from "./dispose";
import { flat, outline, triangulate } from "./flat";

/** How far the sea reaches past the island on every side, in island sizes. */
const SEA = 10;
/** The shore lot is the open colour this much darker. */
const SHORE_SHADE = 0.45;
/** District outlines are the house edge colour this much darker. */
const DISTRICT_LINE = 0.18;
/** Height step between the layers, metres: they draw by `renderOrder`, this only keeps y in step. */
const STEP = 0.01;

const OPEN: PolyKind[] = [POLY.square, POLY.plaza, POLY.vacant];

export function groundMesh(map: CityMap): { group: Group; dispose(): void } {
  const group = new Group();
  const size = Math.max(map.width, map.height, 1) * SEA;
  const sea = new Float32Array([
    -size,
    -size,
    map.width + size,
    -size,
    map.width + size,
    map.height + size,
    -size,
    map.height + size,
  ]);
  const of = (kinds: PolyKind[]) =>
    map.polys.filter((p) => kinds.includes(p.kind)).map((p) => p.points);
  const layers: [string, Float32Array[], Color, number][] = [
    ["water", [sea], new Color(LOOK.water), ORDER.water],
    ["island", of([POLY.island]), new Color(LOOK.open).multiplyScalar(SHORE_SHADE), ORDER.island],
    ["land", of([POLY.land]), new Color(LOOK.ground), ORDER.land],
    ["open", of(OPEN), new Color(LOOK.open), ORDER.open],
    ["canal", of([POLY.water]), new Color(LOOK.water), ORDER.canal],
  ];
  layers.forEach(([name, polys, color, order], k) => {
    const mesh = new Mesh(fill(polys), flat(new MeshBasicMaterial({ color })));
    mesh.name = name;
    mesh.renderOrder = order;
    mesh.position.y = k * STEP;
    group.add(mesh);
  });

  const positions: number[] = [];
  const colors: number[] = [];
  const add = (kinds: PolyKind[], color: Color) => {
    const from = positions.length;
    for (const points of of(kinds)) outline(points, 0, positions);
    for (let i = from; i < positions.length; i += 3) colors.push(color.r, color.g, color.b);
  };
  add([POLY.district], new Color(LOOK.wire).multiplyScalar(DISTRICT_LINE));
  add([POLY.island, POLY.water], new Color(LOOK.shore));
  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new Float32BufferAttribute(positions, 3));
  geometry.setAttribute("color", new Float32BufferAttribute(colors, 3));
  const lines = new LineSegments(geometry, flat(new LineBasicMaterial({ vertexColors: true })));
  lines.name = "outlines";
  lines.renderOrder = ORDER.outline;
  lines.position.y = layers.length * STEP;
  group.add(lines);

  return { group, dispose: () => disposeAll(group) };
}

/** Every polygon of `polys` triangulated into one geometry on y = 0. */
function fill(polys: Float32Array[]): BufferGeometry {
  const positions: number[] = [];
  const index: number[] = [];
  for (const points of polys) {
    const base = positions.length / 3;
    for (let i = 0; i < points.length; i += 2) positions.push(points[i], 0, points[i + 1]);
    for (const k of triangulate(points)) index.push(base + k);
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new Float32BufferAttribute(positions, 3));
  geometry.setIndex(index);
  return geometry;
}
