/**
 * The panel's stage: renderer, camera, orbit controls and lights, kept to the canvas size and
 * pixel ratio, with the WebGL context loss and drawing only while the canvas can be seen.
 */
import {
  AmbientLight,
  DirectionalLight,
  MOUSE,
  PerspectiveCamera,
  Scene,
  Vector3,
  WebGLRenderer,
} from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { frame, MAX_DISTANCE, MIN_DISTANCE, type Box } from "../frame";
import { createScheduler, type Scheduler } from "../scheduler";

const FOV = 45;
const MAX_POLAR = (85 * Math.PI) / 180;
/** The near plane is this share of the distance to the target (no nearer than 0.1 m). */
const NEAR_SHARE = 1 / 1000;

export interface Stage {
  renderer: WebGLRenderer;
  scene: Scene;
  camera: PerspectiveCamera;
  controls: OrbitControls;
  scheduler: Scheduler;
  /** The canvas in CSS pixels. */
  size: () => { w: number; h: number };
  lost: () => boolean;
  /** The camera target and position that show the whole `box` from `polar`, `azimuth`. */
  fit: (box: Box, polar: number, azimuth: number) => { to: Vector3; from: Vector3 };
  /** How far past the target the camera must see, metres: the far plane follows it. */
  setReach: (metres: number) => void;
  /** Something covers the canvas (the game): no frames until it is uncovered. */
  setCovered: (covered: boolean) => void;
  dispose: () => void;
}

export interface StageEvents {
  /** Runs before each drawn frame, once the camera has the canvas's aspect. */
  beforeDraw: () => void;
  /** The WebGL context was lost (true) or restored (false). */
  onLost: (lost: boolean) => void;
  /** After a restore: three rebuilt its GL state, so the clear colour is set again. */
  onRestored: () => void;
}

/** The city's light: a soft fill and one sun. The game lights its scene the same way. */
export function addLights(scene: Scene) {
  scene.add(new AmbientLight(0xffffff, 0.6 * Math.PI));
  const sun = new DirectionalLight(0xffffff, 0.5 * Math.PI);
  sun.position.set(40, 100, 25);
  scene.add(sun);
}

/** Throws when WebGL 2 is not available. */
export function createStage(canvas: HTMLCanvasElement, events: StageEvents): Stage {
  // What the set-up has attached so far, released in reverse by a failure or `dispose`.
  const undo: (() => void)[] = [];
  const release = () => {
    for (const step of undo.splice(0).reverse()) step();
  };
  try {
    return setUp(canvas, events, undo, release);
  } catch (e) {
    release();
    throw e;
  }
}

function setUp(
  canvas: HTMLCanvasElement,
  events: StageEvents,
  undo: (() => void)[],
  release: () => void,
): Stage {
  const renderer = new WebGLRenderer({ canvas, antialias: true });
  undo.push(() => {
    renderer.dispose();
    // dispose() keeps the context; browsers allow only a few live ones.
    renderer.forceContextLoss();
  });
  let lost = false;
  let size = { w: canvas.clientWidth, h: canvas.clientHeight };
  let ratio = Math.min(devicePixelRatio, 2);
  let applied = { w: 0, h: 0, ratio: 0 };
  let onScreen = true;
  let covered = false;
  let reach = 1000;

  const scene = new Scene();
  const camera = new PerspectiveCamera(FOV, 1, 0.1, 2000);
  addLights(scene);

  const controls = new OrbitControls(camera, canvas);
  controls.enableDamping = false;
  controls.mouseButtons = { LEFT: MOUSE.ROTATE, MIDDLE: MOUSE.PAN, RIGHT: MOUSE.PAN };
  controls.minDistance = MIN_DISTANCE;
  controls.maxDistance = MAX_DISTANCE;
  controls.maxPolarAngle = MAX_POLAR;
  undo.push(() => controls.dispose());

  const draw = () => {
    const { w, h } = size;
    if (lost || w === 0 || h === 0) return;
    if (applied.w !== w || applied.h !== h || applied.ratio !== ratio) {
      renderer.setPixelRatio(ratio);
      renderer.setSize(w, h, false);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      applied = { w, h, ratio };
    }
    events.beforeDraw();
    // The depth range follows the zoom, from a close look at a car to the whole island.
    const d = camera.position.distanceTo(controls.target);
    const near = Math.max(0.1, d * NEAR_SHARE);
    if (camera.near !== near || camera.far !== d + reach) {
      camera.near = near;
      camera.far = d + reach;
      camera.updateProjectionMatrix();
    }
    renderer.render(scene, camera);
  };
  const scheduler = createScheduler(draw);
  undo.push(() => scheduler.dispose());
  const invalidate = () => scheduler.invalidate();
  // Frames run only while the canvas is on screen, uncovered, has a size and a context.
  const showing = () =>
    scheduler.setVisible(onScreen && !covered && size.w > 0 && size.h > 0 && !lost);

  controls.addEventListener("change", invalidate);
  undo.push(() => controls.removeEventListener("change", invalidate));

  // Resizing redraws in the next frame, without waiting for the splitter to settle.
  const resized = new ResizeObserver(([entry]) => {
    size = { w: Math.floor(entry.contentRect.width), h: Math.floor(entry.contentRect.height) };
    showing();
    invalidate();
  });
  resized.observe(canvas);
  undo.push(() => resized.disconnect());
  const seen = new IntersectionObserver(([entry]) => {
    onScreen = entry.isIntersecting;
    showing();
  });
  seen.observe(canvas);
  undo.push(() => seen.disconnect());

  // Moving the window to a monitor with another scale changes the ratio but not the size.
  let ratioQuery: MediaQueryList | null = null;
  const onRatio = () => {
    ratioQuery?.removeEventListener("change", onRatio);
    ratio = Math.min(devicePixelRatio, 2);
    ratioQuery = matchMedia(`(resolution: ${devicePixelRatio}dppx)`);
    ratioQuery.addEventListener("change", onRatio);
    invalidate();
  };
  onRatio();
  undo.push(() => ratioQuery?.removeEventListener("change", onRatio));

  const onVisibility = () => scheduler.visibility();
  document.addEventListener("visibilitychange", onVisibility);
  undo.push(() => document.removeEventListener("visibilitychange", onVisibility));

  const onContextLost = (e: Event) => {
    e.preventDefault();
    lost = true;
    showing();
    events.onLost(true);
  };
  const onContextRestored = () => {
    lost = false;
    applied = { w: 0, h: 0, ratio: 0 };
    events.onRestored();
    events.onLost(false);
    showing();
    invalidate();
  };
  canvas.addEventListener("webglcontextlost", onContextLost);
  canvas.addEventListener("webglcontextrestored", onContextRestored);
  undo.push(() => {
    canvas.removeEventListener("webglcontextlost", onContextLost);
    canvas.removeEventListener("webglcontextrestored", onContextRestored);
  });

  return {
    renderer,
    scene,
    camera,
    controls,
    scheduler,
    size: () => size,
    lost: () => lost,
    fit(box, polar, azimuth) {
      const { target, distance } = frame(box, FOV, camera.aspect, polar, azimuth);
      // The camera can back off as far as a frame took it: the far plane follows the distance.
      controls.maxDistance = Math.max(controls.maxDistance, distance);
      const to = new Vector3(...target);
      return { to, from: new Vector3().setFromSphericalCoords(distance, polar, azimuth).add(to) };
    },
    setReach(metres) {
      reach = metres;
      invalidate();
    },
    setCovered(next) {
      covered = next;
      showing();
      invalidate();
    },
    dispose: release,
  };
}
