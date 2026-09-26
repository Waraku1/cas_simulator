import {
  advanceSchoolRankedProjectiles,
  advanceSchoolRankedRuntime,
  createSchoolRankedRuntime,
  groundContactSchoolRanked,
  markSchoolRankedConnected,
  markSchoolRankedDisconnected,
  resolveSchoolRankedAction,
  schoolRankedLock,
  updateSchoolRankedCapture,
} from "./school-ranked-runtime.mjs";
import { gamePointToPosition } from "../src/shared/arcade-projectiles.mjs";
import { overtimeSecondsForHpGap } from "../src/shared/match-duration.mjs";
import aircraftCatalog from "../src/shared/aircraft-catalog.json" with { type: "json" };

if (aircraftCatalog.map(({ displayName }) => displayName).join(",") !== "Bell X-1,Bell X-2,Bell X-3"
  || new Set(aircraftCatalog.map(({ turnAccelerationDegS2 }) => turnAccelerationDegS2)).size !== 3
  || new Set(aircraftCatalog.map(({ maximumSpeedMps }) => maximumSpeedMps)).size !== 3
  || new Set(aircraftCatalog.map(({ minimumSpeedMps }) => minimumSpeedMps)).size !== 3) {
  throw new Error("Random aircraft pool must contain three distinct playable profiles");
}

function baseState(activeAtMs = 10_000) {
  return createSchoolRankedRuntime({
    matchId: "11111111-1111-4111-8111-111111111111",
    roomCode: "ABC234",
    activeAtMs,
    participants: [
      { slot: 1, joinToken: "token-token-token-1", aircraftId: "orbit-a1", spawnSide: "left" },
      { slot: 2, joinToken: "token-token-token-2", aircraftId: "strata-b2", spawnSide: "right" },
    ],
  });
}

let state = baseState();
state = markSchoolRankedConnected(state, 1, 10_001);
state = markSchoolRankedConnected(state, 2, 10_001);
if (advanceSchoolRankedRuntime(state, 10_001).phase !== "active") throw new Error("ACTIVE transition failed");

const poseSample = {
  pose: {
    latitudeDeg: 34.4,
    longitudeDeg: 132.45,
    altitudeM: 2_000,
    orientation: { w: 1, x: 0, y: 0, z: 0 },
  },
  receivedAtMs: 10_001,
};
const targetSample = {
  pose: { ...poseSample.pose, ...gamePointToPosition(poseSample.pose, [80, 0, 0]) },
  receivedAtMs: 10_001,
};
const targetAt = (nowMs) => ({ ...targetSample, receivedAtMs: nowMs });
let weaponState = state;
const missile = resolveSchoolRankedAction(
  weaponState,
  1,
  10_001,
  poseSample,
  targetSample,
  "missile",
);
if (!missile.accepted || !missile.locked || missile.state.projectiles?.length !== 1
  || missile.state.participants[1].heartPoints !== 100) {
  throw new Error("MISSILE must launch with lock and without immediate HP change");
}
weaponState = missile.state;
const missileCooldown = resolveSchoolRankedAction(
  weaponState,
  1,
  10_002,
  { ...poseSample, receivedAtMs: 10_002 },
  targetAt(10_002),
  "missile",
);
if (missileCooldown.accepted || missileCooldown.code !== "cooldown") {
  throw new Error("MISSILE cooldown was not enforced");
}
weaponState = advanceSchoolRankedProjectiles(weaponState, 10_260, (slot) =>
  slot === 2 ? targetAt(10_260) : { ...poseSample, receivedAtMs: 10_260 });
if (weaponState.participants[1].heartPoints !== 80 || weaponState.projectiles.length !== 0) {
  throw new Error("MISSILE must change HP on contact only");
}
const gun = resolveSchoolRankedAction(
  weaponState,
  1,
  10_262,
  { ...poseSample, receivedAtMs: 10_262 },
  targetAt(10_262),
  "gun",
);
if (!gun.accepted || gun.locked || gun.state.participants[1].heartPoints !== 80
  || gun.state.projectiles.length !== 2 || gun.state.nextProjectileSequence !== 3) {
  throw new Error("GUN independent cooldown/effect contract failed");
}
if (gun.state.projectiles[0].position[1] === gun.state.projectiles[1].position[1]) {
  throw new Error("A GUN trigger must spawn two separately visible projectiles");
}
const gunCooldown = resolveSchoolRankedAction(
  gun.state,
  1,
  10_263,
  { ...poseSample, receivedAtMs: 10_263 },
  targetAt(10_263),
  "gun",
);
if (gunCooldown.accepted || gunCooldown.code !== "cooldown") {
  throw new Error("GUN cooldown was not enforced");
}
weaponState = advanceSchoolRankedProjectiles(gun.state, 10_460, (slot) =>
  slot === 2 ? targetAt(10_460) : { ...poseSample, receivedAtMs: 10_460 });
if (weaponState.participants[1].heartPoints !== 72) throw new Error("Both GUN projectiles must resolve contact");

const draggedGun = resolveSchoolRankedAction(state, 1, 10_010,
  { pose: { ...poseSample.pose, view: { yawRad: Math.PI / 2, pitchRad: 0, weaponId: "gun", looking: true } }, receivedAtMs: 10_010 },
  { pose: { ...poseSample.pose, ...gamePointToPosition(poseSample.pose, [0, -80, 0]) }, receivedAtMs: 10_010 }, "gun");
if (!draggedGun.accepted || draggedGun.state.projectiles.length !== 2) {
  throw new Error("Dragged-view GUN volley must launch while looking");
}
const draggedContact = advanceSchoolRankedProjectiles(draggedGun.state, 10_250, (slot) => slot === 2
  ? { pose: { ...poseSample.pose, ...gamePointToPosition(poseSample.pose, [0, -80, 0]) }, receivedAtMs: 10_250 }
  : { ...poseSample, receivedAtMs: 10_250 });
if (draggedContact.participants[1].heartPoints !== 92) {
  throw new Error("Dragged-view GUN volley must contact only along the changed sight direction");
}
const fullVolleyRejected = resolveSchoolRankedAction(
  { ...state, projectiles: Array(7).fill(draggedGun.state.projectiles[0]) }, 1, 10_010,
  { ...poseSample, receivedAtMs: 10_010 }, targetAt(10_010), "gun");
if (fullVolleyRejected.code !== "projectile_limit" || fullVolleyRejected.state.projectiles.length !== 7) {
  throw new Error("GUN volley must reserve two free projectile slots atomically");
}

const miss = resolveSchoolRankedAction(state, 1, 10_010,
  { ...poseSample, receivedAtMs: 10_010 },
  { pose: { ...poseSample.pose, ...gamePointToPosition(poseSample.pose, [0, 90, 0]) }, receivedAtMs: 10_010 },
  "gun");
if (!miss.accepted) throw new Error("Off-axis GUN launch unexpectedly rejected");
const afterMiss = advanceSchoolRankedProjectiles(miss.state, 11_810, (slot) => slot === 2
  ? { pose: { ...poseSample.pose, ...gamePointToPosition(poseSample.pose, [0, 90, 0]) }, receivedAtMs: 11_810 }
  : { ...poseSample, receivedAtMs: 11_810 });
if (afterMiss.participants[1].heartPoints !== 100 || afterMiss.projectiles.length !== 0) {
  throw new Error("Off-axis GUN projectile must miss and expire");
}

const extendedTargetPose = {
  ...poseSample.pose,
  ...gamePointToPosition(poseSample.pose, [650, 0, 0]),
};
const extendedGun = resolveSchoolRankedAction(
  state, 1, 10_010, { ...poseSample, receivedAtMs: 10_010 },
  { pose: extendedTargetPose, receivedAtMs: 10_010 }, "gun",
);
if (!extendedGun.accepted) throw new Error("GUN must launch beyond the legacy catalog indicator");
const extendedContact = advanceSchoolRankedProjectiles(extendedGun.state, 11_610, (slot) => slot === 2
  ? { pose: extendedTargetPose, receivedAtMs: 11_610 }
  : { ...poseSample, receivedAtMs: 11_610 });
if (extendedContact.participants[1].heartPoints !== 92) {
  throw new Error("GUN must contact on its doubled game path");
}
const missileAtNewRange = resolveSchoolRankedAction(
  state, 1, 10_010, { ...poseSample, receivedAtMs: 10_010 },
  {
    pose: { ...poseSample.pose, ...gamePointToPosition(poseSample.pose, [1_300, 0, 0]) },
    receivedAtMs: 10_010,
  }, "missile",
);
const missileBeyondNewRange = resolveSchoolRankedAction(
  state, 1, 10_010, { ...poseSample, receivedAtMs: 10_010 },
  {
    pose: { ...poseSample.pose, ...gamePointToPosition(poseSample.pose, [1_400, 0, 0]) },
    receivedAtMs: 10_010,
  }, "missile",
);
if (!missileAtNewRange.accepted || missileBeyondNewRange.code !== "outside_interaction") {
  throw new Error("MISSILE interaction boundary must use the expanded catalog range");
}

const regulationEnd = state.regulationEndsAtMs;
state = {
  ...state,
  participants: [
    { ...state.participants[0], heartPoints: 88 },
    { ...state.participants[1], heartPoints: 76 },
  ],
};
let regulationResult = advanceSchoolRankedRuntime(state, regulationEnd);
if (regulationResult.phase !== "overtime" || regulationResult.overtimeEndsAtMs !== regulationEnd + 4 * 60_000) {
  throw new Error("A 12 HP gap must award four minutes of overtime");
}
if (advanceSchoolRankedRuntime(regulationResult, regulationResult.overtimeEndsAtMs - 1).result !== null
  || advanceSchoolRankedRuntime(regulationResult, regulationResult.overtimeEndsAtMs).result?.winnerSlot !== 1) {
  throw new Error("Unequal HP must be decided after, not before, the allotted overtime");
}
for (const [gap, minutes] of [[0, 5], [9, 5], [10, 4], [19, 4], [20, 3], [30, 2], [40, 1], [100, 1]]) {
  if (overtimeSecondsForHpGap(gap) !== minutes * 60) throw new Error(`Incorrect overtime for HP gap ${gap}`);
}

state = baseState();
state = markSchoolRankedConnected(state, 1, 10_001);
state = markSchoolRankedConnected(state, 2, 10_001);
let overtimeState = advanceSchoolRankedRuntime(state, state.regulationEndsAtMs);
if (overtimeState.phase !== "overtime" || overtimeState.result !== null
  || overtimeState.overtimeEndsAtMs !== overtimeState.regulationEndsAtMs + 5 * 60_000) {
  throw new Error("An equal HP match must enter five minutes of overtime");
}

overtimeState = {
  ...overtimeState,
  participants: [
    { ...overtimeState.participants[0], heartPoints: 93 },
    { ...overtimeState.participants[1], heartPoints: 86 },
  ],
};
const duringOvertime = advanceSchoolRankedRuntime(overtimeState, overtimeState.overtimeEndsAtMs - 1);
if (duringOvertime.phase !== "overtime" || duringOvertime.result !== null) {
  throw new Error("overtime ended before its assigned full duration");
}
const overtimeResult = advanceSchoolRankedRuntime(duringOvertime, duringOvertime.overtimeEndsAtMs);
if (overtimeResult.result?.winnerSlot !== 1 || overtimeResult.result?.reason !== "overtime-heart-points") {
  throw new Error("overtime HP result failed");
}

state = baseState();
state = markSchoolRankedConnected(state, 1, 10_001);
state = markSchoolRankedConnected(state, 2, 10_001);
state = advanceSchoolRankedRuntime(state, state.regulationEndsAtMs);
const draw = advanceSchoolRankedRuntime(state, state.overtimeEndsAtMs);
if (draw.phase !== "completed" || draw.result?.winnerSlot !== null || draw.result?.reason !== "overtime-draw") {
  throw new Error("overtime draw failed");
}

state = baseState();
state = markSchoolRankedConnected(state, 1, 10_001);
state = markSchoolRankedConnected(state, 2, 10_001);
const inAir = groundContactSchoolRanked(state, 1, { altitudeM: 2_000, groundHeightM: 1_000 }, 10_002);
if (inAir.result !== null) throw new Error("Above-ground flight ended the match");
const grounded = groundContactSchoolRanked(inAir, 1, { altitudeM: 1_005, groundHeightM: 1_000 }, 10_003);
if (grounded.result?.winnerSlot !== 2 || grounded.result?.reason !== "ground-crash") {
  throw new Error("Terrain contact must award the opponent a ground-crash win");
}

const capturingState = advanceSchoolRankedRuntime(inAir, 10_001);
const capturingClient = { latestPose: {
  ...poseSample.pose, view: { yawRad: 0, pitchRad: 0, weaponId: "missile", looking: false },
}, latestPoseReceivedAtMs: 10_001 };
const capturePeer = { latestPose: targetSample.pose, latestPoseReceivedAtMs: 10_001 };
updateSchoolRankedCapture(capturingClient, capturePeer, capturingState, 10_001);
capturingClient.latestPose.view.looking = true;
capturingClient.latestPoseReceivedAtMs = 10_101;
updateSchoolRankedCapture(capturingClient, capturePeer, capturingState, 10_101);
if (schoolRankedLock(capturingClient, capturePeer, 10_101)) throw new Error("Drag must clear capture");
capturingClient.latestPose.view.looking = false;
capturingClient.latestPoseReceivedAtMs = 10_201;
capturePeer.latestPoseReceivedAtMs = 10_201;
updateSchoolRankedCapture(capturingClient, capturePeer, capturingState, 10_201);
capturingClient.latestPoseReceivedAtMs = 11_401;
capturePeer.latestPoseReceivedAtMs = 11_401;
updateSchoolRankedCapture(capturingClient, capturePeer, capturingState, 11_401);
if (schoolRankedLock(capturingClient, capturePeer, 11_401)) {
  throw new Error("Capture gaps must not count toward the hold");
}
capturingClient.latestPoseReceivedAtMs = 12_601;
capturePeer.latestPoseReceivedAtMs = 12_601;
updateSchoolRankedCapture(capturingClient, capturePeer, capturingState, 12_601);
if (schoolRankedLock(capturingClient, capturePeer, 12_601)) {
  throw new Error("A single later sample cannot complete the hold");
}
for (const nowMs of [12_901, 13_201, 13_501, 13_801]) {
  capturingClient.latestPoseReceivedAtMs = nowMs;
  capturePeer.latestPoseReceivedAtMs = nowMs;
  updateSchoolRankedCapture(capturingClient, capturePeer, capturingState, nowMs);
}
if (!schoolRankedLock(capturingClient, capturePeer, 13_801)) {
  throw new Error("Continuous forward capture must complete after 1.2 s");
}
capturingClient.latestPose.view.yawRad = 0.1;
updateSchoolRankedCapture(capturingClient, capturePeer, capturingState, 13_802);
if (schoolRankedLock(capturingClient, capturePeer, 13_802)) {
  throw new Error("Displaced view must clear a completed capture");
}
if (groundContactSchoolRanked(grounded, 2, { altitudeM: 0, groundHeightM: 0 }, 10_004).result?.winnerSlot !== 2) {
  throw new Error("Ground-crash result must remain terminal");
}

state = baseState();
state = markSchoolRankedConnected(state, 1, 10_001);
state = markSchoolRankedConnected(state, 2, 10_001);
state = markSchoolRankedDisconnected(state, 2, 15_000);
if (advanceSchoolRankedRuntime(state, 34_999).result !== null) throw new Error("disconnect grace ended early");
const forfeit = advanceSchoolRankedRuntime(state, 35_000);
if (forfeit.result?.winnerSlot !== 1 || forfeit.result?.reason !== "forfeit") {
  throw new Error("disconnect grace forfeit failed");
}

state = baseState();
state = markSchoolRankedConnected(state, 1, 10_001);
if (advanceSchoolRankedRuntime(state, 29_999).result !== null) {
  throw new Error("initial connection grace ended early");
}
const initialForfeit = advanceSchoolRankedRuntime(state, 30_000);
if (initialForfeit.result?.winnerSlot !== 1 || initialForfeit.result?.reason !== "forfeit") {
  throw new Error("initial missing participant did not forfeit after grace");
}

state = baseState();
if (advanceSchoolRankedRuntime(state, 29_999).result !== null) {
  throw new Error("dual initial connection grace ended early");
}
const initialNoContest = advanceSchoolRankedRuntime(state, 30_000);
if (initialNoContest.phase !== "no-contest" || initialNoContest.result?.winnerSlot !== null || initialNoContest.result?.reason !== "infrastructure-failure") {
  throw new Error("dual initial absence did not resolve NO CONTEST after grace");
}

console.log(JSON.stringify({
  ok: true,
  gate: "C4C_RUNTIME_CONTRACT",
  regulation: "PASS",
  overtimeFullDuration: "PASS",
  draw: "PASS",
  disconnectGrace20s: "PASS",
  initialConnectionGrace20s: "PASS",
  dualInitialAbsenceNoContest: "PASS",
  missileGunWeaponContract: "PASS",
  independentWeaponCooldowns: "PASS",
}, null, 2));
