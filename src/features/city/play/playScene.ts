/**
 * The game's three.js side: its own renderer on the game canvas, the archipelago's meshes and life
 * from the snapshot taken on entry, and for now a free camera, drawn between physics steps.
 */
import { PerspectiveCamera, Scene, Vector3, WebGLRenderer } from "three";
import { createLife, type Limits } from "../panel/life";
import { addLights } from "../panel/stage";
import { islandMeshes } from "../render/island";
import type { CitySnapshot } from "../scene";
import { overviewBox } from "../world/views";
import { lerpFly, startFly, stepFly, turnFly } from "./flyCamera";
import type { Actions } from "./input";

/** The game's limits: cars (flying ones included) and residents near the player. */
const GAME: Limits = { cars: 150, people: 400 };
const FOV = 60;
const NEAR = 0.3;
/** The far plane, in archipelago sizes past its widest side. */
const REACH = 2;

export interface PlayScene {
  /** Turns the view by this frame's look, at once: the view never lags behind the mouse. */
  look: (look: { x: number; y: number }) => void;
  /** One fixed physics step of `dt` seconds. */
  step: (actions: Actions, dt: number) => void;
  /** Draws `alpha` of the way past the last step; life moves on by the frame's `dt`. */
  draw: (alpha: number, dt: number) => void;
  dispose: () => void;
}

/** Throws when WebGL 2 is not available. */
export function createPlayScene(
  canvas: HTMLCanvasElement,
  city: CitySnapshot,
  background: string,
): PlayScene {
  const renderer = new WebGLRenderer({ canvas, antialias: true });
  const release = () => {
    renderer.dispose();
    // dispose() keeps the context; browsers allow only a few live ones.
    renderer.forceContextLoss();
  };
  try {
    return setUp(renderer, canvas, city, background, release);
  } catch (e) {
    release();
    throw e;
  }
}

function setUp(
  renderer: WebGLRenderer,
  canvas: HTMLCanvasElement,
  city: CitySnapshot,
  background: string,
  release: () => void,
): PlayScene {
  renderer.setClearColor(background);
  const scene = new Scene();
  addLights(scene);
  const { width, height } = city.world.map;
  const camera = new PerspectiveCamera(FOV, 1, NEAR, (1 + REACH) * Math.max(width, height, 1000));
  camera.rotation.order = "YXZ";

  const island = islandMeshes(city.world, city.graph);
  scene.add(island.group);
  const life = createLife(scene, () => {}, GAME);
  life.populate(city.graph, city.seed, city.islands);

  // The pose before and after the last step; frames are drawn in between.
  const now = startFly(overviewBox(city.world));
  const before = { ...now };
  const drawn = { ...now };
  const below = new Vector3();

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

  return {
    look(look) {
      turnFly(now, look);
    },
    step(actions, dt) {
      Object.assign(before, now);
      stepFly(now, actions, dt);
    },
    draw(alpha, dt) {
      lerpFly(drawn, before, now, alpha);
      camera.position.set(drawn.x, drawn.y, drawn.z);
      camera.rotation.set(now.pitch, now.yaw, 0);
      // ponytail: life moves once per drawn frame, as in the panel; it joins the fixed steps when
      // the player meets it (Task 8).
      below.set(camera.position.x, 0, camera.position.z);
      life.step(dt, camera.position, below);
      render();
    },
    dispose() {
      resized.disconnect();
      life.dispose();
      scene.remove(island.group);
      island.dispose();
      release();
    },
  };
}
