/** The city's instanced meshes: one box per block, coloured by the theme. */
import {
  Color,
  InstancedMesh,
  Matrix4,
  Quaternion,
  Vector3,
  type BufferGeometry,
  type Material,
} from "three";
import type { Palette } from "../../palette";
import type { Block } from "./model";

/** Colours of the city: the palette of the theme and its page background (`--bg`). */
export interface CityTheme {
  palette: Palette;
  background: string;
}

/** How far a dimmed block moves toward the background. */
const DIM = 0.7;
/** How far odd-depth plates move toward the plate border colour, so nested plates part. */
const PLATE_SHADE = 0.5;

/** One instanced mesh and, by `instanceId`, the index of each instance's block in `blocks`. */
export interface Layer {
  mesh: InstancedMesh;
  blocks: Int32Array;
}

/**
 * Plates and buildings as two meshes, coloured before they are drawn. `geometry` is a unit box
 * standing on its base, so an instance at `(x, y, z)` scaled `(w, h, d)` spans `y … y + h`.
 */
export function buildLayers(
  blocks: readonly Block[],
  geometry: BufferGeometry,
  material: Material,
  theme: CityTheme,
): Layer[] {
  const plates: number[] = [];
  const buildings: number[] = [];
  blocks.forEach((b, i) => (b.kind === "plate" ? plates : buildings).push(i));
  const matrix = new Matrix4();
  const at = new Vector3();
  const scale = new Vector3();
  const turn = new Quaternion();
  return [plates, buildings]
    .filter((list) => list.length > 0)
    .map((list) => {
      const mesh = new InstancedMesh(geometry, material, list.length);
      list.forEach((index, k) => {
        const b = blocks[index];
        mesh.setMatrixAt(k, matrix.compose(at.set(b.x, b.y, b.z), turn, scale.set(b.w, b.h, b.d)));
      });
      const layer = { mesh, blocks: Int32Array.from(list) };
      paint(layer, blocks, theme);
      return layer;
    });
}

/** Colours every instance of `layer` for `theme`; dimmed blocks fade toward the background. */
export function paint(layer: Layer, blocks: readonly Block[], theme: CityTheme) {
  const { palette } = theme;
  const background = new Color(theme.background);
  const categories = palette.categories.map((c) => new Color(c));
  const plate = new Color(palette.dirFill);
  const plateAlt = plate.clone().lerp(new Color(palette.dirBorder), PLATE_SHADE);
  const folder = new Color(palette.dirBorder);
  const color = new Color();
  layer.blocks.forEach((index, k) => {
    const b = blocks[index];
    if (b.kind === "plate") color.copy(b.depth % 2 ? plateAlt : plate);
    else if (b.kind === "dirBuilding") color.copy(folder);
    // Folders have category 255: never an index into the palette.
    else color.copy(categories[b.category] ?? categories[categories.length - 1]);
    if (b.dim) color.lerp(background, DIM);
    layer.mesh.setColorAt(k, color);
  });
  if (layer.mesh.instanceColor) layer.mesh.instanceColor.needsUpdate = true;
}
