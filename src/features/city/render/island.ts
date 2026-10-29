/** The archipelago's still meshes in one group: ground, roads and houses. Panel and game share them. */
import { Group } from "three";
import type { World } from "../world/buildings";
import type { RoadGraph } from "../world/roads";
import { groundMesh } from "./ground";
import { houseMesh, type Houses } from "./houses";
import { roadMesh } from "./roads";

export interface IslandMeshes {
  group: Group;
  houses: Houses;
  dispose: () => void;
}

export function islandMeshes(world: World, g: RoadGraph): IslandMeshes {
  const ground = groundMesh(world.map);
  const roads = roadMesh(world.map, g);
  const houses = houseMesh(world);
  const group = new Group();
  group.add(ground.group, roads.group, houses.mesh);
  return {
    group,
    houses,
    dispose() {
      ground.dispose();
      roads.dispose();
      houses.dispose();
    },
  };
}
