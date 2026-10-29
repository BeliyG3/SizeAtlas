/**
 * The game's three.js side: its own renderer on the game canvas, the archipelago's meshes and life
 * from the snapshot taken on entry, and the player, drawn between physics steps.
 */
import { PerspectiveCamera, Scene, WebGLRenderer } from "three";
import { LOOK } from "../look";
import { createLife, GAME_LIMITS } from "../panel/life";
import { createSolids } from "../physics/solids";
import { islandMeshes } from "../render/island";
import { addLights } from "../render/lighting";
import type { CitySnapshot } from "../scene";
import { CAM } from "./camera";
import type { HudState } from "./hints";
import type { Actions } from "./input";
import { createPlayerView } from "./playerView";

const NEAR = 0.3;
/** The far plane, in archipelago sizes past its widest side. */
const REACH = 2;

export interface PlayScene {
  /** This frame's actions, once, before its steps: the view turns at once with the mouse. */
  frame: (actions: Actions) => void;
  /** One fixed physics step of `dt` seconds. */
  step: (actions: Actions, dt: number) => void;
  /** Draws `alpha` of the way past the last step; the far crowd moves on by the frame's `dt`. */
  draw: (alpha: number, dt: number) => void;
  /** What the HUD shows now: the same object every call (`paused` is the game's). */
  hud: () => HudState;
  dispose: () => void;
}

/** Throws when WebGL 2 is not available. */
export function createPlayScene(canvas: HTMLCanvasElement, city: CitySnapshot): PlayScene {
  const renderer = new WebGLRenderer({ canvas, antialias: true });
  const release = () => {
    renderer.dispose();
    // dispose() keeps the context; browsers allow only a few live ones.
    renderer.forceContextLoss();
  };
  try {
    return setUp(renderer, canvas, city, release);
  } catch (e) {
    release();
    throw e;
  }
}

function setUp(
  renderer: WebGLRenderer,
  canvas: HTMLCanvasElement,
  city: CitySnapshot,
  release: () => void,
): PlayScene {
  renderer.setClearColor(LOOK.sky);
  const scene = new Scene();
  addLights(scene);
  const { width, height } = city.world.map;
  const camera = new PerspectiveCamera(
    CAM.fov,
    1,
    NEAR,
    (1 + REACH) * Math.max(width, height, 1000),
  );

  const island = islandMeshes(city.world, city.graph);
  scene.add(island.group);
  const life = createLife(scene, () => {}, GAME_LIMITS);
  life.populate(city.graph, city.seed, city.islands);

  // One physics world for all that moves in it.
  const solids = createSolids(city.world, city.graph);
  const player = createPlayerView(scene, city, solids, life);

  let applied = { w: 0, h: 0 };
  const render = () => {
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    if (w === 0 || h === 0) return;
    if (applied.w !== w || applied.h !== h) {
      renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
      renderer.setSize(w, h, false);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      applied = { w, h };
    }
    renderer.render(scene, camera);
  };
  // A resize redraws at once, so a paused game is never left blank.
  const resized = new ResizeObserver(render);
  resized.observe(canvas);
  // Moving the window to a monitor with another scale changes the ratio but not the size.
  let ratioQuery: MediaQueryList | null = null;
  const onRatio = () => {
    ratioQuery?.removeEventListener("change", onRatio);
    ratioQuery = matchMedia(`(resolution: ${devicePixelRatio}dppx)`);
    ratioQuery.addEventListener("change", onRatio);
    applied = { w: 0, h: 0 };
    render();
  };
  onRatio();

  return {
    frame: (actions) => player.frame(actions),
    hud: player.hud,
    step(actions, dt) {
      // The traffic moves first, stopping for the player as the last step left them; the player
      // then runs into it where it is now.
      life.move(dt, camera.position, player.at, player.obstacles());
      player.step(actions, dt);
    },
    draw(alpha, dt) {
      player.draw(camera, alpha, dt);
      life.draw(alpha, dt, camera.position, player.at);
      render();
    },
    dispose() {
      resized.disconnect();
      player.dispose();
      ratioQuery?.removeEventListener("change", onRatio);
      life.dispose();
      scene.remove(island.group);
      island.dispose();
      release();
    },
  };
}
