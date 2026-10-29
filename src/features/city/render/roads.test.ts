import type { Mesh } from "three";
import { describe, expect, it } from "vitest";
import { ROAD } from "../world/map";
import { mapOf } from "../world/map.fixture";
import { buildRoads, pointOn } from "../world/roads";
import { roadMesh } from "./roads";

describe("roadMesh", () => {
  it("a ramp's ribbon stands where the road's height says, its end pieces too", () => {
    // A highway ramp from 1 m to 8 m, on a slant.
    const map = mapOf([], {
      nodes: new Float32Array([10, 10, 38, 38]),
      edges: [{ a: 0, b: 1, cls: ROAD.highway, bridge: true, liftA: 1, liftB: 8 }],
    });
    const g = buildRoads(map);
    const { group, dispose } = roadMesh(map, g);
    const position = (group.getObjectByName("roads") as Mesh).geometry.getAttribute("position");
    const { len } = g.edges[0];
    const [ux, uz] = [28 / len, 28 / len];
    let ends = 0;
    for (let i = 0; i < position.count; i++) {
      const t = (position.getX(i) - 10) * ux + (position.getZ(i) - 10) * uz;
      if (t < 0 || t > len) ends++;
      const want = pointOn(g, 0, Math.min(len, Math.max(0, t)), true, 0).y;
      expect(Math.abs(position.getY(i) - want), `vertex ${i} at ${t.toFixed(2)} m`).toBeLessThan(
        0.05,
      );
    }
    expect(ends).toBeGreaterThan(0);
    dispose();
  });
});
