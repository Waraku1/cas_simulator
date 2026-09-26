import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import ts from "typescript";

// Exercise the actual flight integrator without requiring a browser or a TS loader.
const source = await readFile(new URL("../src/client/flight/model.ts", import.meta.url), "utf8");
const configImport = 'import { THEATER } from "../../shared/config";';
assert.ok(source.includes(configImport));
const isolated = source.replace(configImport,
  "const THEATER = { centerLatitudeDeg: 35.3606, centerLongitudeDeg: 138.7274 };");
const output = ts.transpileModule(isolated, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
}).outputText;
const { createInitialFlightState, integrateFlightState } = await import(
  `data:text/javascript;base64,${Buffer.from(output).toString("base64")}`
);

const initial = createInitialFlightState();
const starting = { ...initial, orientation: { w: 1, x: 0, y: 0, z: 0 } };
const half = Math.PI / 12;
const climb = { ...starting, orientation: { w: Math.cos(half), x: 0, y: -Math.sin(half), z: 0 } };
const descent = { ...starting, orientation: { w: Math.cos(half), x: 0, y: Math.sin(half), z: 0 } };
const input = { pitch: 0, roll: 0, throttle: 0 };
const fly = (state) => {
  for (let i = 0; i < 60; i += 1) state = integrateFlightState(state, input, 0.05);
  return state;
};
const levelResult = fly(starting);
const climbResult = fly(climb);
const descentResult = fly(descent);
const oldLevelTarget = 90 + (230 - 90) * starting.throttle;
assert.ok(Math.abs(levelResult.speedMps - oldLevelTarget) < 1e-8,
  "Level flight must retain the existing throttle speed");
assert.ok(climbResult.speedMps < levelResult.speedMps && climbResult.altitudeM > starting.altitudeM,
  "Upward travel slows without changing the input mapping");
assert.ok(descentResult.speedMps > levelResult.speedMps && descentResult.altitudeM < starting.altitudeM,
  "Downward travel accelerates without changing the input mapping");
assert.equal(climbResult.throttle, starting.throttle);
assert.equal(descentResult.throttle, starting.throttle);
assert.equal(levelResult.altitudeM, starting.altitudeM);

console.log(JSON.stringify({ ok: true, gate: "FLIGHT_DIRECTION_SPEED" }));
