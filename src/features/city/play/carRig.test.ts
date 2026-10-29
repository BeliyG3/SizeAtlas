import { Group, Vector3 } from "three";
import { GLTFLoader, type GLTF } from "three/addons/loaders/GLTFLoader.js";
import { describe, expect, it } from "vitest";
import carUrl from "../assets/skycar.glb?inline";
import walkerUrl from "../assets/walker.glb?inline";
import { carModel } from "../render/cars";
import { exitScript, makeScriptPose, poseAt, SEATED, type ScriptPose } from "./boardingScript";
import { holdYoke, rigCar } from "./carRig";
import { createCharacter } from "./character";

async function load(url: string): Promise<GLTF> {
  const data = await (await fetch(url)).arrayBuffer();
  return new GLTFLoader().parseAsync(data, "");
}

/** The figure seated in a rigged car, posed by `sp` with the grip on top, as the game does. */
async function seated() {
  const car = carModel((await load(carUrl)).scene);
  car.group.rotation.set(0, 0.7, 0);
  car.group.position.set(10, 0, 5);
  const rig = rigCar(car.group.children[0]);
  const figure = createCharacter(await load(walkerUrl));
  const holder = new Group();
  rig.model.add(holder);
  holder.add(figure.group);
  const pose = (sp: ScriptPose) => {
    figure.group.position.set(sp.x, 0, sp.z);
    figure.group.rotation.y = sp.yaw;
    figure.pose(sp);
    rig.door(sp.door);
    car.group.updateMatrixWorld(true);
    holdYoke(figure.arms, rig, sp.ik);
  };
  const gap = (i: 0 | 1) =>
    figure.arms[i].hand
      .getWorldPosition(new Vector3())
      .distanceTo(rig.grips[i].getWorldPosition(new Vector3()));
  return { rig, figure, pose, gap };
}

describe("holdYoke", () => {
  it("puts both wrists on the grips, frame after frame, and follows the yoke as it turns", async () => {
    const { rig, figure, pose, gap } = await seated();
    // The clip's own hands are near the grips, not on them.
    pose({ ...SEATED, ik: 0 });
    expect(gap(0)).toBeGreaterThan(0.03);
    pose(SEATED);
    expect(gap(0)).toBeLessThan(0.01);
    expect(gap(1)).toBeLessThan(0.01);
    const elbow = figure.arms[0].lo.getWorldPosition(new Vector3());
    // The same pose again: the bend is not added on top of the last one.
    for (let i = 0; i < 3; i++) pose(SEATED);
    expect(figure.arms[0].lo.getWorldPosition(new Vector3()).distanceTo(elbow)).toBeLessThan(1e-4);
    rig.steer(1);
    pose(SEATED);
    expect(gap(0)).toBeLessThan(0.01);
    expect(gap(1)).toBeLessThan(0.01);
  });

  it("lets go getting out: the arms are the clip's once the grip is off", async () => {
    const { pose, gap } = await seated();
    const out = exitScript(null);
    const sp = makeScriptPose();
    pose(SEATED);
    // Out over the sill: the hands are far off the yoke.
    pose(poseAt(out, out.length - 0.5, sp));
    expect(gap(0)).toBeGreaterThan(0.3);
  });
});
