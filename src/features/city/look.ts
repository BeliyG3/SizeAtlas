/** The look of city v2: the night palette ("variant A") and the drawing order of its flat layers. */
export const LOOK = {
  ground: "#03060c",
  body: "#0a121e",
  wire: "#eaf4ff",
  road: "#0b1620",
  lane: "#56e6ff",
  ring: "#f2e08a",
  water: "#020409",
  shore: "#6c7fd8",
  open: "#1b2350",
  police: "#56e6ff",
  virus: "#ff2a40",
};

/** Hues a district's house edges lean toward, a little each (cyan, blue, violet). */
export const DISTRICT_TINT = ["#56e6ff", "#6c8cff", "#a27bff"];

/** Colours of the figures by role (`ROLE` in actors/residents): resident, police, virus. */
export const ROLE_COLOR = [LOOK.wire, LOOK.police, LOOK.virus];

/**
 * `renderOrder` of the flat layers, bottom first. They do not write depth, so each paints over
 * the ones before it without fighting, and everything standing on them is drawn after.
 */
export const ORDER = {
  water: -10,
  island: -9,
  land: -8,
  open: -7,
  canal: -6,
  outline: -5,
  road: -4,
  axis: -3,
};

/**
 * House edges fade with the distance from the camera, metres: full strength up to `near`,
 * smoothly down to `floor` (a share of the colour) from `far` on. See `render/edgeFade.ts`.
 */
export const EDGE_FADE = { near: 250, far: 2500, floor: 0.22 };
