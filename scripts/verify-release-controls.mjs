import { readFile } from "node:fs/promises";
import { join } from "node:path";

const root = new URL("..", import.meta.url).pathname;
const flightModel = await readFile(join(root, "src/client/flight/model.ts"), "utf8");
const earthScene = await readFile(join(root, "src/client/components/EarthScene.tsx"), "utf8");
const flightHud = await readFile(join(root, "src/client/components/FlightHud.tsx"), "utf8");

const forbiddenModelSignatures = [
  "YAW_TEST_RATE_DEG_S",
  "input.yaw",
  "yawInput",
  "yawTestDelta",
];
for (const signature of forbiddenModelSignatures) {
  if (flightModel.includes(signature)) {
    throw new Error(`Release flight model contains removed direct-yaw signature: ${signature}`);
  }
}

for (const key of ['"KeyQ"', '"KeyE"']) {
  if (earthScene.includes(key)) {
    throw new Error(`Release input layer still captures removed direct-yaw key: ${key}`);
  }
}
if (/\byaw\s*:\s*keyAxis\(/.test(earthScene)) {
  throw new Error("Release input layer still maps a direct-yaw axis");
}
if (flightHud.includes("YAW TEST")) {
  throw new Error("Release HUD still advertises the removed YAW TEST control");
}

console.log(JSON.stringify({
  ok: true,
  gate: "C5_RELEASE_CONTROLS",
  directYawInput: "REMOVED",
  qEKeyCapture: "REMOVED",
  yawTestHud: "REMOVED",
}, null, 2));
