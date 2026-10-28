/**
 * Flat layers on the ground: map polygons (`x0, z0, x1, z1, …`, positive shoelace) as triangles
 * and outlines, and the material setting that stacks the layers by `renderOrder`.
 */
import { ShapeUtils, Vector2, type Material } from "three";

/**
 * The triangles of `points` as index triples into its points, each wound to face +y (the map's
 * positive shoelace on (x, z) faces −y, so they come out reversed).
 */
export function triangulate(points: Float32Array): number[] {
  const contour: Vector2[] = [];
  for (let i = 0; i < points.length; i += 2) contour.push(new Vector2(points[i], points[i + 1]));
  const out: number[] = [];
  for (const [a, b, c] of ShapeUtils.triangulateShape(contour, [])) {
    const cross =
      (points[b * 2] - points[a * 2]) * (points[c * 2 + 1] - points[a * 2 + 1]) -
      (points[b * 2 + 1] - points[a * 2 + 1]) * (points[c * 2] - points[a * 2]);
    if (cross > 0) out.push(a, c, b);
    else out.push(a, b, c);
  }
  return out;
}

/** Pushes the closed outline of `points` at height `y` as line segments, `x, y, z` per end. */
export function outline(points: Float32Array, y: number, out: number[]) {
  for (let i = 0; i < points.length; i += 2) {
    const j = (i + 2) % points.length;
    out.push(points[i], y, points[i + 1], points[j], y, points[j + 1]);
  }
}

/**
 * A flat layer's material: it writes no depth, so each layer paints over the ones drawn before it
 * (by `renderOrder`) without fighting them, and whatever stands on the ground is drawn over all.
 */
export function flat<M extends Material>(material: M): M {
  material.depthWrite = false;
  return material;
}
