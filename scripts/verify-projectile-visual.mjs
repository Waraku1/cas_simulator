import assert from "node:assert/strict";
import { gunProjectilePixelSize } from "../src/client/flight/projectile-visual.mjs";

const viewportHeight = 800;
const fov = Math.PI / 3;
const near = gunProjectilePixelSize(100, viewportHeight, fov);
const middle = gunProjectilePixelSize(500, viewportHeight, fov);
const far = gunProjectilePixelSize(1_400, viewportHeight, fov);
assert.equal(near, 18, "Close GUN tracer size is bounded");
assert.ok(middle > far && middle < near,
  "Perspective size must shrink as the camera-to-projectile distance grows");
assert.equal(far, 3, "The distant tracer remains visible at a bounded minimum size");
assert.ok(gunProjectilePixelSize(500, 1_600, fov) > middle,
  "Projection responds to viewport height");
assert.ok(gunProjectilePixelSize(500, viewportHeight, fov / 2) > middle,
  "Projection responds to camera field of view");

console.log(JSON.stringify({ ok: true, gate: "GUN_DISTANCE_VISUAL_SIZE" }));
