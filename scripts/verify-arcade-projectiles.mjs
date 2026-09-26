import assert from "node:assert/strict";
import {
  ARCADE_LOCK,
  ARCADE_PROJECTILES,
  advanceArcadeProjectile,
  createArcadeProjectile,
  gameCaptureAvailable,
  gameLockAvailable,
  gamePointToPosition,
} from "../src/shared/arcade-projectiles.mjs";
import { GAME_GROUND_CLEARANCE_M, gameGroundContact } from "../src/shared/game-ground.mjs";
import weaponCatalog from "../src/shared/weapon-catalog.json" with { type: "json" };

const pilot = {
  latitudeDeg: 34.4,
  longitudeDeg: 132.45,
  altitudeM: 2_000,
  orientation: { w: 1, x: 0, y: 0, z: 0 },
};
const point = (east, north = 0) => gamePointToPosition(pilot, [east, north, 0]);
assert.equal(ARCADE_LOCK.holdMs, 1_200, "Capture hold time remains unchanged");
assert.equal(ARCADE_PROJECTILES.gun.speed, 450, "GUN movement remains unchanged");
assert.equal(ARCADE_PROJECTILES.gun.maxTravelM, 720, "GUN path doubles without changing speed");
assert.equal(ARCADE_PROJECTILES.gun.lifetimeMs, 1_800, "GUN remains simulated until its doubled path ends");
assert.equal(ARCADE_PROJECTILES.missile.lifetimeMs, 5_100, "MISSILE travel time increases by 1.5x");
assert.equal(weaponCatalog.find((weapon) => weapon.weaponId === "missile")?.activationRadiusM, 1_350);
assert.equal(weaponCatalog.find((weapon) => weapon.weaponId === "gun")?.activationRadiusM, 360);

assert.equal(gameLockAvailable(pilot, point(120), 600), true);
assert.equal(gameLockAvailable(pilot, point(0, 120), 600), false);

const gun = createArcadeProjectile(1, 1, "gun", 0, pilot, point(0, 90), 180);
assert.equal(gun.targetSlot, null);
const gunAt200 = advanceArcadeProjectile(gun, 200, point(0, 90));
assert.equal(gunAt200.touched, false);
assert.ok(gunAt200.projectile.position[0] > 80);
assert.equal(gunAt200.projectile.position[1], 0, "GUN must fly straight");
const gunExpired = advanceArcadeProjectile(gunAt200.projectile, 501, point(0, 90));
assert.equal(gunExpired.touched, false);
assert.ok(gunExpired.projectile, "GUN remains visible after a short flight");
const gunAtLimit = advanceArcadeProjectile(gunExpired.projectile, 1_800, point(760));
assert.equal(gunAtLimit.touched, false);
assert.equal(gunAtLimit.projectile, null, "GUN simulation stops at the bounded game distance");

const gunOnAxis = createArcadeProjectile(2, 1, "gun", 0, pilot, point(80), 180);
assert.equal(advanceArcadeProjectile(gunOnAxis, 200, point(80)).touched, true,
  "Segment contact must register even when one update crosses the target");
const gunBeyondActivation = createArcadeProjectile(5, 1, "gun", 0, pilot, point(300), 180);
assert.equal(advanceArcadeProjectile(gunBeyondActivation, 700, point(300)).touched, true,
  "GUN contact is decided by the path even beyond the activation indicator");
const gunAtExtendedRange = createArcadeProjectile(6, 1, "gun", 0, pilot, point(650), 360);
assert.equal(advanceArcadeProjectile(gunAtExtendedRange, 1_600, point(650)).touched, true,
  "GUN contact reaches the doubled path boundary");
const gunBeyondSimulation = createArcadeProjectile(10, 1, "gun", 0, pilot, point(760), 360);
assert.equal(advanceArcadeProjectile(gunBeyondSimulation, 1_800, point(760)).touched, false,
  "GUN cannot contact a peer beyond the simulated segment");

const viewedPilot = { ...pilot, view: { yawRad: 0, pitchRad: 0, weaponId: "missile" } };
assert.equal(gameCaptureAvailable(viewedPilot, point(120), 600), true);
assert.equal(gameCaptureAvailable(viewedPilot, point(0, 120), 600), false);
assert.equal(gameCaptureAvailable(viewedPilot, point(300, 80), 900), true,
  "Wider central region includes a moderately offset target");
assert.equal(gameCaptureAvailable(viewedPilot, point(300, 130), 900), false,
  "Central capture still has a boundary");
assert.equal(gameCaptureAvailable(viewedPilot, point(1_300), 1_350), true,
  "Extended game interaction region accepts a distant target");
assert.equal(gameCaptureAvailable(viewedPilot, point(1_400), 1_350), false,
  "Distant targets remain outside the new interaction boundary");
assert.equal(gameCaptureAvailable({ ...viewedPilot, view: { ...viewedPilot.view, yawRad: -Math.PI / 2 } }, point(0, 120), 600), false,
  "Looking sideways cannot establish a lock, even with the peer centered on screen");
assert.equal(gameCaptureAvailable({ ...viewedPilot, view: { ...viewedPilot.view, looking: true } }, point(120), 600), false,
  "A centered target cannot progress while the look pointer is held");
assert.equal(gameCaptureAvailable({ ...viewedPilot, view: { ...viewedPilot.view, yawRad: 0.05 } }, point(120), 600), false,
  "A displaced look direction must return to forward before capture");
assert.equal(gameCaptureAvailable(viewedPilot, point(120), 600), true,
  "Forward view restores capture without changing its duration");
assert.equal(gameGroundContact(500 + GAME_GROUND_CLEARANCE_M, 500), true);
assert.equal(gameGroundContact(500 + GAME_GROUND_CLEARANCE_M + 1, 500), false);
assert.equal(createArcadeProjectile(7, 1, "missile", 0, viewedPilot, point(120), 600, false).targetSlot, null,
  "A server-declined capture must not create a tracking projectile");
assert.equal(createArcadeProjectile(8, 1, "missile", 0, viewedPilot, point(0, 120), 600, true).targetSlot, 2,
  "A server-confirmed camera capture can track an off-axis target");

const locked = createArcadeProjectile(3, 1, "missile", 0, pilot, point(120), 600);
const unlocked = createArcadeProjectile(4, 1, "missile", 0, pilot, point(0, 120), 600);
assert.equal(locked.targetSlot, 2);
assert.equal(unlocked.targetSlot, null);
let tracking = locked;
let straight = unlocked;
for (const now of [100, 200, 300, 400, 500]) {
  const lockedStep = advanceArcadeProjectile(tracking, now, point(120, 65));
  const unlockedStep = advanceArcadeProjectile(straight, now, point(120, 65));
  assert.equal(unlockedStep.touched, false, "Unlocked MISSILE must miss an off-axis target");
  assert.equal(unlockedStep.projectile.position[1], 0, "Unlocked MISSILE must remain straight");
  straight = unlockedStep.projectile;
  if (lockedStep.touched) {
    assert.ok(now > 100, "Tracking must take time");
    tracking = null;
    break;
  }
  assert.ok(lockedStep.projectile.position[1] > 0, "Locked MISSILE must turn in game space");
  tracking = lockedStep.projectile;
}
assert.equal(tracking, null, "Locked MISSILE did not touch a moving game target");

const widerTarget = point(500, 260);
let widerTracking = createArcadeProjectile(9, 1, "missile", 0, pilot, widerTarget, 900, true);
const earlyStep = advanceArcadeProjectile(widerTracking, 100, widerTarget);
assert.ok(earlyStep.projectile.position[1] > 8,
  "Stronger arcade tracking must respond promptly to an offset target");
widerTracking = earlyStep.projectile;
for (const now of [200, 400, 800, 1_200, 1_600]) {
  const step = advanceArcadeProjectile(widerTracking, now, widerTarget);
  if (step.touched) {
    widerTracking = null;
    break;
  }
  widerTracking = step.projectile;
}
assert.equal(widerTracking, null, "Extended-duration tracking should reach the offset target");

console.log(JSON.stringify({ ok: true, gate: "ARCADE_PROJECTILE_CONTACT_AND_LOCK" }));
