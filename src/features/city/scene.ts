/**
 * The three.js side of the city: renderer, camera, controls, lights and the selection outline.
 * The only module (with what it imports) that loads three; CityView reaches it by `import()`.
 */
import {
  AmbientLight,
  BoxGeometry,
  DirectionalLight,
  EdgesGeometry,
  LineBasicMaterial,
  LineSegments,
  MeshLambertMaterial,
  MOUSE,
  PerspectiveCamera,
  Raycaster,
  Scene,
  Vector2,
  Vector3,
  WebGLRenderer,
} from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { frame, MAX_DISTANCE, MIN_DISTANCE, type Box } from "./frame";
import { buildLayers, paint, type CityTheme, type Layer } from "./meshes";
import type { Block, City } from "./model";
import { attachPointer, type Hover } from "./pointer";
import { createScheduler } from "./scheduler";

export type { CityTheme } from "./meshes";
export type { Hover } from "./pointer";

const FOV = 45;
/** The view a reset gives: this far from straight down, looking along the layout's rows. */
const START_POLAR = (55 * Math.PI) / 180;
const MAX_POLAR = (85 * Math.PI) / 180;
const FLY_MS = 400;
/** The outline sits this far outside the focus box, so its lines never sink into faces... */
const OUTLINE_MARGIN = 0.01;
/** ...and its base ring this far above the focus bottom, on the parent plate, not inside it. */
const OUTLINE_LIFT = 0.002;

export interface SceneEvents {
  onHover: (hover: Hover | null) => void;
  onPick: (block: Block) => void;
  /** The WebGL context was lost (true) or restored (false). */
  onLost: (lost: boolean) => void;
}

export interface CityScene {
  /**
   * Shows `city` (null: nothing); a new `generation` also resets the camera. A city of the
   * shown `data` (only the focus moved) is repainted in place, keeping the meshes and the hover.
   */
  setCity: (city: City | null, generation: number) => void;
  setTheme: (theme: CityTheme) => void;
  reset: () => void;
  dispose: () => void;
}

/** Throws when WebGL 2 is not available. */
export function createScene(
  canvas: HTMLCanvasElement,
  theme: CityTheme,
  events: SceneEvents,
): CityScene {
  const renderer = new WebGLRenderer({ canvas, antialias: true });
  // What a failing set-up has attached so far, released in reverse.
  const undo: (() => void)[] = [];
  try {
    return setUp(renderer, canvas, theme, events, undo);
  } catch (e) {
    for (const release of undo.reverse()) release();
    renderer.dispose();
    renderer.forceContextLoss();
    throw e;
  }
}

function setUp(
  renderer: WebGLRenderer,
  canvas: HTMLCanvasElement,
  initialTheme: CityTheme,
  events: SceneEvents,
  undo: (() => void)[],
): CityScene {
  let theme = initialTheme;
  let city: City | null = null;
  let layers: Layer[] = [];
  let shownGeneration: number | null = null;
  let needsReset = true;
  let lost = false;
  let size = { w: canvas.clientWidth, h: canvas.clientHeight };
  let ratio = Math.min(devicePixelRatio, 2);
  let applied = { w: 0, h: 0, ratio: 0 };

  const scene = new Scene();
  const camera = new PerspectiveCamera(FOV, 1, 0.1, 2000);
  scene.add(new AmbientLight(0xffffff, 0.6 * Math.PI));
  const sun = new DirectionalLight(0xffffff, 0.5 * Math.PI);
  sun.position.set(40, 100, 25);
  scene.add(sun);
  // A unit box on its base: an instance at y with height h spans y … y + h.
  const geometry = new BoxGeometry(1, 1, 1).translate(0, 0.5, 0);
  const material = new MeshLambertMaterial();
  const outline = new LineSegments(new EdgesGeometry(geometry), new LineBasicMaterial());
  outline.visible = false;
  scene.add(outline);

  const controls = new OrbitControls(camera, canvas);
  controls.enableDamping = false;
  controls.mouseButtons = { LEFT: MOUSE.ROTATE, MIDDLE: MOUSE.PAN, RIGHT: MOUSE.PAN };
  controls.minDistance = MIN_DISTANCE;
  controls.maxDistance = MAX_DISTANCE;
  controls.maxPolarAngle = MAX_POLAR;
  undo.push(() => controls.dispose());

  const fit = (box: Box, polar: number, azimuth: number) => {
    const { target, distance } = frame(box, FOV, camera.aspect, polar, azimuth);
    const to = new Vector3(...target);
    return { to, from: new Vector3().setFromSphericalCoords(distance, polar, azimuth).add(to) };
  };

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
    if (needsReset && city) {
      needsReset = false;
      const { to, from } = fit(city.bounds, START_POLAR, 0);
      controls.target.copy(to);
      camera.position.copy(from);
      controls.update();
    }
    renderer.render(scene, camera);
  };
  const scheduler = createScheduler(draw);
  undo.push(() => scheduler.dispose());
  const invalidate = () => scheduler.invalidate();

  const applyTheme = () => {
    renderer.setClearColor(theme.background);
    outline.material.color.set(theme.palette.selectedEdge);
    if (city) for (const layer of layers) paint(layer, city.blocks, theme);
  };
  applyTheme();

  const raycaster = new Raycaster();
  const ndc = new Vector2();
  const pick = (x: number, y: number): Block | null => {
    if (lost || !city || size.w === 0 || size.h === 0) return null;
    ndc.set((x / size.w) * 2 - 1, 1 - (y / size.h) * 2);
    camera.updateMatrixWorld();
    raycaster.setFromCamera(ndc, camera);
    // Nearest first, across both meshes; the outline is not a target.
    const hit = raycaster.intersectObjects(
      layers.map((l) => l.mesh),
      false,
    )[0];
    const layer = hit && layers.find((l) => l.mesh === hit.object);
    if (!layer || hit.instanceId === undefined) return null;
    return city.blocks[layer.blocks[hit.instanceId]];
  };

  const flyTo = (block: Block) => {
    if (size.w === 0 || size.h === 0 || !city) return;
    let top = block.y + block.h;
    // A plate: frame what stands on it too.
    if (block.kind === "plate")
      for (const b of city.blocks)
        if (Math.abs(b.x - block.x) <= block.w / 2 && Math.abs(b.z - block.z) <= block.d / 2)
          top = Math.max(top, b.y + b.h);
    const box: Box = {
      min: [block.x - block.w / 2, block.y, block.z - block.d / 2],
      max: [block.x + block.w / 2, top, block.z + block.d / 2],
    };
    const { to, from } = fit(box, controls.getPolarAngle(), controls.getAzimuthalAngle());
    const startTarget = controls.target.clone();
    const startPosition = camera.position.clone();
    scheduler.fly((k) => {
      const eased = k * k * (3 - 2 * k);
      controls.target.lerpVectors(startTarget, to, eased);
      camera.position.lerpVectors(startPosition, from, eased);
      controls.update();
    }, FLY_MS);
  };

  const detachPointer = attachPointer(canvas, {
    pick,
    onHover: events.onHover,
    onPick: events.onPick,
    onFly: flyTo,
  });
  undo.push(detachPointer);
  controls.addEventListener("change", invalidate);
  const onStart = () => {
    scheduler.stopFly();
    events.onHover(null);
  };
  controls.addEventListener("start", onStart);

  // Resizing redraws in the next frame, without waiting for the splitter to settle.
  const observer = new ResizeObserver(([entry]) => {
    size = { w: Math.floor(entry.contentRect.width), h: Math.floor(entry.contentRect.height) };
    invalidate();
  });
  observer.observe(canvas);
  undo.push(() => observer.disconnect());

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

  const onVisibility = () => scheduler.visibility();
  document.addEventListener("visibilitychange", onVisibility);

  const onContextLost = (e: Event) => {
    e.preventDefault();
    lost = true;
    scheduler.stopFly();
    events.onHover(null);
    events.onLost(true);
  };
  const onContextRestored = () => {
    lost = false;
    applied = { w: 0, h: 0, ratio: 0 };
    events.onLost(false);
    invalidate();
  };
  canvas.addEventListener("webglcontextlost", onContextLost);
  canvas.addEventListener("webglcontextrestored", onContextRestored);

  const clearLayers = () => {
    for (const layer of layers) {
      scene.remove(layer.mesh);
      layer.mesh.dispose();
    }
    layers = [];
  };

  return {
    setCity(next, generation) {
      const sameLayout = next !== null && next.data === city?.data;
      city = next;
      if (city && sameLayout) {
        for (const layer of layers) paint(layer, city.blocks, theme);
      } else {
        clearLayers();
        if (city) {
          layers = buildLayers(city.blocks, geometry, material, theme);
          for (const layer of layers) scene.add(layer.mesh);
        }
        events.onHover(null);
      }
      const focus = city?.focusBox;
      outline.visible = !!focus;
      if (focus) {
        const [x0, y0, z0] = focus.min;
        const [x1, y1, z1] = focus.max;
        const m = OUTLINE_MARGIN;
        const bottom = y0 + OUTLINE_LIFT;
        outline.position.set((x0 + x1) / 2, bottom, (z0 + z1) / 2);
        outline.scale.set(x1 - x0 + 2 * m, y1 + m - bottom, z1 - z0 + 2 * m);
      }
      if (generation !== shownGeneration) {
        shownGeneration = generation;
        needsReset = true;
        scheduler.stopFly();
      }
      invalidate();
    },
    setTheme(next) {
      theme = next;
      applyTheme();
      invalidate();
    },
    reset() {
      scheduler.stopFly();
      needsReset = true;
      invalidate();
    },
    dispose() {
      scheduler.dispose();
      detachPointer();
      observer.disconnect();
      ratioQuery?.removeEventListener("change", onRatio);
      document.removeEventListener("visibilitychange", onVisibility);
      canvas.removeEventListener("webglcontextlost", onContextLost);
      canvas.removeEventListener("webglcontextrestored", onContextRestored);
      controls.removeEventListener("change", invalidate);
      controls.removeEventListener("start", onStart);
      controls.dispose();
      clearLayers();
      geometry.dispose();
      material.dispose();
      outline.geometry.dispose();
      outline.material.dispose();
      renderer.dispose();
      // dispose() keeps the context; browsers allow only a few live ones.
      renderer.forceContextLoss();
    },
  };
}
