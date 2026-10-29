/** The city's light, the same in the panel and the game: a soft fill and one sun. */
import { AmbientLight, DirectionalLight, type Scene } from "three";

export function addLights(scene: Scene) {
  scene.add(new AmbientLight(0xffffff, 0.6 * Math.PI));
  const sun = new DirectionalLight(0xffffff, 0.5 * Math.PI);
  sun.position.set(40, 100, 25);
  scene.add(sun);
}
