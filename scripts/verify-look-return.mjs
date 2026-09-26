import assert from "node:assert/strict";
import { LOOK_RETURN_DURATION_MS, returningLook } from "../src/client/flight/look-return.mjs";

assert.equal(LOOK_RETURN_DURATION_MS, 200);
assert.deepEqual(returningLook(1, -0.5, 0), {
  yawRad: 1, pitchRad: -0.5, completed: false,
});
assert.deepEqual(returningLook(1, -0.5, 100), {
  yawRad: 0.5, pitchRad: -0.25, completed: false,
});
assert.deepEqual(returningLook(1, -0.5, 200), {
  yawRad: 0, pitchRad: 0, completed: true,
});
assert.deepEqual(returningLook(1, -0.5, 300), {
  yawRad: 0, pitchRad: 0, completed: true,
});

console.log(JSON.stringify({ ok: true, gate: "LOOK_RETURN_200MS" }));
