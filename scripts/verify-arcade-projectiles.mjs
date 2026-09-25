import assert from "node:assert/strict";
import {
  advanceArcadeProjectile,
  createArcadeProjectile,
  gameLockAvailable,
  gamePointToPosition,
} from "../src/shared/arcade-projectiles.mjs";

const pilot = {
  latitudeDeg: 34.4,
  longitudeDeg: 132.45,
  altitudeM: 2_000,
  orientation: { w: 1, x: 0, y: 0, z: 0 },
};
const point = (east, north = 0) => gamePointToPosition(pilot, [east, north, 0]);

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
assert.equal(gunExpired.projectile, null);

const gunOnAxis = createArcadeProjectile(2, 1, "gun", 0, pilot, point(80), 180);
assert.equal(advanceArcadeProjectile(gunOnAxis, 200, point(80)).touched, true,
  "Segment contact must register even when one update crosses the target");

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

console.log(JSON.stringify({ ok: true, gate: "ARCADE_PROJECTILE_CONTACT_AND_LOCK" }));
