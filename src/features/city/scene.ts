/**
 * The three.js side of the city panel: the island's meshes on the stage, its moving life, the
 * focus outline, picking and the camera flights. The only module (with what it imports) that
 * loads three; CityView reaches it by `import()`.
 */
import {
  BoxGeometry,
  EdgesGeometry,
  Group,
  LineBasicMaterial,
  LineSegments,
  Raycaster,
  Vector2,
} from "three";
import { cameraMove, type Aim, type Box } from "./frame";
import type { Palette } from "../../palette";
import { createLife } from "./panel/life";
import { createStage } from "./panel/stage";
import { attachPointer, type Hover } from "./pointer";
import { groundMesh } from "./render/ground";
import { houseMesh, type Houses } from "./render/houses";
import { roadMesh } from "./render/roads";
import type { Building, World } from "./world/buildings";
import { buildRoads, type RoadGraph } from "./world/roads";
import { buildingBox, islandBox, overviewBox } from "./world/views";

export type { Hover } from "./pointer";

/** Colours from the app theme: the palette and its page background (`--bg`), the sky. */
export interface CityTheme {
  palette: Palette;
  background: string;
}

/** The view a reset gives: this far from straight down, looking along the map's rows. */
const START_POLAR = (55 * Math.PI) / 180;
/** The camera sees this far past its target, in island sizes: the whole sea of the ground. */
const REACH = 16;
const FLY_MS = 400;
/** The flight to the island of a newly selected root. */
const ISLAND_FLY_MS = 900;
/** The panel's frame rate cap while anything moves. */
const FPS = 30;
/** The outline sits this far outside the focus box, so its lines never sink into faces... */
const OUTLINE_MARGIN = 0.3;
/** ...and its base ring this far above the ground. */
const OUTLINE_LIFT = 0.2;

export interface SceneEvents {
  onHover: (hover: Hover | null) => void;
  onPick: (building: Building) => void;
  /** The WebGL context was lost (true) or restored (false). */
  onLost: (lost: boolean) => void;
}

export interface CityScene {
  /**
   * Shows `world` (null: nothing) with the selected root `generation`, which is the world's
   * island `island` (-1: none). The camera starts on that island, flies to the island of a newly
   * selected root and is left alone while the same root is rebuilt; a new root that is no island
   * resets it to the whole world. A world of the shown `map` (only the focus moved) is repainted
   * in place, keeping the meshes, the traffic and the hover; another map is built anew and the
   * old one freed.
   */
  setCity: (world: World | null, generation: number, island: number) => void;
  setTheme: (theme: CityTheme) => void;
  /** Shows the whole archipelago. */
  reset: () => void;
  dispose: () => void;
}

/** The island's still meshes. */
interface Island {
  group: Group;
  houses: Houses;
  dispose: () => void;
}

/** Throws when WebGL 2 is not available. */
export function createScene(
  canvas: HTMLCanvasElement,
  initialTheme: CityTheme,
  events: SceneEvents,
): CityScene {
  let theme = initialTheme;
  let world: World | null = null;
  let island: Island | null = null;
  // The root last shown with a world, and the island the next reset puts the camera on (-1: all).
  let shown: Aim | null = null;
  let needsReset = true;
  let resetTo = -1;

  const stage = createStage(canvas, {
    beforeDraw() {
      if (!needsReset || !world) return;
      needsReset = false;
      const box = (resetTo >= 0 && islandBox(world, resetTo)) || overviewBox(world);
      const { to, from } = stage.fit(box, START_POLAR, 0);
      stage.controls.target.copy(to);
      stage.camera.position.copy(from);
      stage.controls.update();
    },
    onLost(lost) {
      if (lost) events.onHover(null);
      events.onLost(lost);
    },
    onRestored: () => applyTheme(),
  });
  const { scene, camera, controls, scheduler } = stage;

  // A unit box on its base: scaled to the focus box, it spans y … y + h.
  const box = new BoxGeometry(1, 1, 1).translate(0, 0.5, 0);
  const outline = new LineSegments(new EdgesGeometry(box), new LineBasicMaterial());
  box.dispose();
  outline.visible = false;
  scene.add(outline);

  const life = createLife(scene, () => animate());
  const step = (dt: number) => life.step(dt, camera.position, controls.target);
  const animate = () => scheduler.animate(life.active() ? step : null, FPS);

  const applyTheme = () => {
    stage.renderer.setClearColor(theme.background);
    outline.material.color.set(theme.palette.selectedEdge);
  };
  applyTheme();

  const raycaster = new Raycaster();
  const ndc = new Vector2();
  const pick = (x: number, y: number): Building | null => {
    const { w, h } = stage.size();
    if (stage.lost() || !world || !island || w === 0 || h === 0) return null;
    ndc.set((x / w) * 2 - 1, 1 - (y / h) * 2);
    camera.updateMatrixWorld();
    raycaster.setFromCamera(ndc, camera);
    // Not recursive: the edge lines under the mesh have no faces.
    const hit = raycaster.intersectObject(island.houses.mesh, false)[0];
    if (hit?.faceIndex == null) return null;
    return world.buildings[island.houses.houseOfFace[hit.faceIndex]] ?? null;
  };

  /** Flies over `ms` to show `box`, keeping the camera's angles; false while the canvas has no size. */
  const flyToBox = (box: Box, ms: number): boolean => {
    const { w, h } = stage.size();
    if (w === 0 || h === 0) return false;
    const { to, from } = stage.fit(box, controls.getPolarAngle(), controls.getAzimuthalAngle());
    const startTarget = controls.target.clone();
    const startPosition = camera.position.clone();
    scheduler.fly((k) => {
      const eased = k * k * (3 - 2 * k);
      controls.target.lerpVectors(startTarget, to, eased);
      camera.position.lerpVectors(startPosition, from, eased);
      controls.update();
    }, ms);
    return true;
  };
  const flyTo = (building: Building) => void flyToBox(buildingBox(building), FLY_MS);

  /** Moves the camera, if it should, for the root `aim` of the world `on`. */
  const aimAt = (on: World, aim: Aim) => {
    const move = cameraMove(shown, aim);
    shown = aim;
    if (move === "stay") return;
    scheduler.stopFly();
    const box = aim.island >= 0 ? islandBox(on, aim.island) : null;
    if (move === "fly" && !needsReset && box && flyToBox(box, ISLAND_FLY_MS)) return;
    // The first look, a root that is no island, a camera not placed yet or no canvas to fly in:
    // straight there.
    resetTo = aim.island;
    needsReset = true;
  };

  const detachPointer = attachPointer(canvas, {
    pick,
    onHover: events.onHover,
    onPick: events.onPick,
    onFly: flyTo,
  });
  const onStart = () => {
    scheduler.stopFly();
    events.onHover(null);
  };
  controls.addEventListener("start", onStart);

  const clearIsland = () => {
    if (!island) return;
    scene.remove(island.group);
    island.dispose();
    island = null;
  };

  const placeOutline = (focus: Box | null) => {
    outline.visible = !!focus;
    if (!focus) return;
    const [x0, , z0] = focus.min;
    const [x1, y1, z1] = focus.max;
    const m = OUTLINE_MARGIN;
    outline.position.set((x0 + x1) / 2, OUTLINE_LIFT, (z0 + z1) / 2);
    outline.scale.set(x1 - x0 + 2 * m, y1 + m - OUTLINE_LIFT, z1 - z0 + 2 * m);
  };

  return {
    setCity(next, generation, at) {
      const sameMap = next !== null && next.map === world?.map;
      world = next;
      if (world && sameMap && island) {
        island.houses.paint(world);
      } else {
        clearIsland();
        const g = world && buildRoads(world.map);
        if (world && g) {
          island = buildIsland(world, g);
          scene.add(island.group);
          const { width, height } = world.map;
          stage.setReach(REACH * Math.max(width, height, 1));
        }
        const islands = world ? new Set(world.map.polys.map((p) => p.island)).size : 1;
        life.populate(g, generation, islands);
        animate();
        events.onHover(null);
      }
      placeOutline(world?.focusBox ?? null);
      // Without a world the camera waits: the root's island has not come yet.
      if (world) aimAt(world, { generation, island: at });
      scheduler.invalidate();
    },
    setTheme(next) {
      theme = next;
      applyTheme();
      scheduler.invalidate();
    },
    reset() {
      scheduler.stopFly();
      resetTo = -1;
      needsReset = true;
      scheduler.invalidate();
    },
    dispose() {
      detachPointer();
      controls.removeEventListener("start", onStart);
      life.dispose();
      clearIsland();
      outline.geometry.dispose();
      outline.material.dispose();
      stage.dispose();
    },
  };
}

function buildIsland(world: World, g: RoadGraph): Island {
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
