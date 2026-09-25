// Fictional CAS game-space motion only. These values are gameplay timing and
// contact sizes, not a model of any real aircraft or weapon.
export const ARCADE_PROJECTILES = Object.freeze({
  missile: Object.freeze({ speed: 280, lifetimeMs: 2_600, touchRadius: 18 }),
  gun: Object.freeze({ speed: 450, lifetimeMs: 900, maxTravelM: 360, touchRadius: 10 }),
});
export const MAX_ARCADE_PROJECTILES = 8;
export const ARCADE_TICK_MS = 100;
export const ARCADE_LOCK = Object.freeze({
  holdMs: 1_200,
  sampleGapMs: 400,
  centerCosine: Math.cos(8 * Math.PI / 180),
  cameraBackM: 108,
  cameraUpM: 16,
  cameraLookAheadM: 72,
});

const RADIUS = 6_371_000;
const RAD = Math.PI / 180;
const clamp = (value, minimum, maximum) => Math.min(maximum, Math.max(minimum, value));
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const length = (v) => Math.hypot(...v);
const normalized = (v) => {
  const size = length(v);
  return size > 1e-9 ? v.map((component) => component / size) : [1, 0, 0];
};
const addScaled = (a, b, scale) => a.map((component, index) => component + b[index] * scale);

export function relativeGamePoint(origin, pose) {
  const latitude = origin.latitudeDeg * RAD;
  return [
    (pose.longitudeDeg - origin.longitudeDeg) * RAD * RADIUS * Math.max(0.05, Math.cos(latitude)),
    (pose.latitudeDeg - origin.latitudeDeg) * RAD * RADIUS,
    pose.altitudeM - origin.altitudeM,
  ];
}

export function gamePointToPosition(origin, point) {
  const latitude = origin.latitudeDeg * RAD;
  return {
    latitudeDeg: origin.latitudeDeg + point[1] / (RADIUS * RAD),
    longitudeDeg: origin.longitudeDeg + point[0] / (RADIUS * RAD * Math.max(0.05, Math.cos(latitude))),
    altitudeM: origin.altitudeM + point[2],
  };
}

function gameAxis(orientation, axis) {
  const norm = Math.hypot(orientation.w, orientation.x, orientation.y, orientation.z) || 1;
  const { w, x, y, z } = Object.fromEntries(
    ["w", "x", "y", "z"].map((key) => [key, orientation[key] / norm]),
  );
  // The flight state shares the +X forward, +Y left, +Z up game frame.
  const [vx, vy, vz] = axis;
  const product = x * vx + y * vy + z * vz;
  const squared = x * x + y * y + z * z;
  return normalized([
    2 * product * x + (w * w - squared) * vx + 2 * w * (y * vz - z * vy),
    2 * product * y + (w * w - squared) * vy + 2 * w * (z * vx - x * vz),
    2 * product * z + (w * w - squared) * vz + 2 * w * (x * vy - y * vx),
  ]);
}

export function gameForward(orientation) {
  return gameAxis(orientation, [1, 0, 0]);
}

export function gameLockAvailable(localPose, peerPose, maximumDistance) {
  const delta = relativeGamePoint(localPose, peerPose);
  const distance = length(delta);
  return distance > 15
    && distance <= maximumDistance
    && dot(gameForward(localPose.orientation), normalized(delta)) >= 0.9;
}

// A small, dimensionless screen-center region in the fictional game camera.
// The same view offset is used by the renderer and the server-side check.
export function gameCaptureAvailable(localPose, peerPose, maximumDistance) {
  const view = localPose.view;
  if (!view) return false;
  const target = relativeGamePoint(localPose, peerPose);
  const distance = length(target);
  if (distance <= 15 || distance > maximumDistance) return false;
  const forward = gameForward(localPose.orientation);
  const left = gameAxis(localPose.orientation, [0, 1, 0]);
  const up = gameAxis(localPose.orientation, [0, 0, 1]);
  const yaw = view.yawRad;
  const pitch = view.pitchRad;
  const orbit = Math.cos(pitch);
  let camera = addScaled([0, 0, 0], forward, -ARCADE_LOCK.cameraBackM * Math.cos(yaw) * orbit);
  camera = addScaled(camera, left, ARCADE_LOCK.cameraBackM * Math.sin(yaw) * orbit);
  camera = addScaled(camera, up, ARCADE_LOCK.cameraUpM + ARCADE_LOCK.cameraBackM * Math.sin(pitch));
  const ahead = ARCADE_LOCK.cameraLookAheadM * Math.max(0, Math.cos(yaw) * orbit);
  const focus = addScaled([0, 0, 0], forward, ahead);
  const direction = normalized(focus.map((value, index) => value - camera[index]));
  const toTarget = normalized(target.map((value, index) => value - camera[index]));
  return dot(direction, toTarget) >= ARCADE_LOCK.centerCosine;
}

export function createArcadeProjectile(id, ownerSlot, weaponId, nowMs, localPose, peerPose, maximumDistance, confirmedLock) {
  const rules = ARCADE_PROJECTILES[weaponId];
  const direction = gameForward(localPose.orientation);
  const locked = weaponId === "missile" && (confirmedLock ?? gameLockAvailable(localPose, peerPose, maximumDistance));
  return {
    id,
    ownerSlot,
    weaponId,
    origin: {
      latitudeDeg: localPose.latitudeDeg,
      longitudeDeg: localPose.longitudeDeg,
      altitudeM: localPose.altitudeM,
    },
    position: addScaled([0, 0, 0], direction, 8),
    direction,
    targetSlot: locked ? (ownerSlot === 1 ? 2 : 1) : null,
    lastStepAtMs: nowMs,
    expiresAtMs: nowMs + rules.lifetimeMs,
  };
}

function touchesSegment(start, end, point, radius) {
  const delta = end.map((value, index) => value - start[index]);
  const toPoint = point.map((value, index) => value - start[index]);
  const segmentSizeSquared = dot(delta, delta);
  const fraction = segmentSizeSquared > 0
    ? clamp(dot(toPoint, delta) / segmentSizeSquared, 0, 1)
    : 0;
  const nearest = addScaled(start, delta, fraction);
  return Math.hypot(...point.map((value, index) => value - nearest[index])) <= radius;
}

export function advanceArcadeProjectile(projectile, nowMs, peerPose) {
  const rules = ARCADE_PROJECTILES[projectile.weaponId];
  const until = Math.min(nowMs, projectile.expiresAtMs);
  let position = projectile.position;
  let direction = projectile.direction;
  let remainingMs = Math.max(0, until - projectile.lastStepAtMs);
  const target = peerPose ? relativeGamePoint(projectile.origin, peerPose) : null;

  while (remainingMs > 0) {
    const stepMs = Math.min(remainingMs, 50);
    if (target && projectile.targetSlot !== null) {
      // Deliberately simple game easing toward the currently visible opponent.
      const desired = normalized(target.map((value, index) => value - position[index]));
      const blend = Math.min(0.22, stepMs / 250);
      direction = normalized(direction.map((value, index) => value * (1 - blend) + desired[index] * blend));
    }
    let next = addScaled(position, direction, rules.speed * stepMs / 1_000);
    const capped = rules.maxTravelM !== undefined && length(next) >= rules.maxTravelM;
    if (capped) next = addScaled(position, direction, Math.max(0, rules.maxTravelM - length(position)));
    if (target && touchesSegment(position, next, target, rules.touchRadius)) {
      return { projectile: null, touched: true };
    }
    position = next;
    if (capped) return { projectile: null, touched: false };
    remainingMs -= stepMs;
  }

  if (nowMs >= projectile.expiresAtMs) return { projectile: null, touched: false };
  return {
    projectile: { ...projectile, position, direction, lastStepAtMs: until },
    touched: false,
  };
}
