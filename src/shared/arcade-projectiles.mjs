// Fictional CAS game-space motion only. These values are gameplay timing and
// contact sizes, not a model of any real aircraft or weapon.
export const ARCADE_PROJECTILES = Object.freeze({
  missile: Object.freeze({ speed: 280, lifetimeMs: 2_600, touchRadius: 18 }),
  gun: Object.freeze({ speed: 450, lifetimeMs: 500, touchRadius: 10 }),
});
export const MAX_ARCADE_PROJECTILES = 8;
export const ARCADE_TICK_MS = 100;

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

export function gameForward(orientation) {
  const norm = Math.hypot(orientation.w, orientation.x, orientation.y, orientation.z) || 1;
  const { w, x, y, z } = Object.fromEntries(
    ["w", "x", "y", "z"].map((key) => [key, orientation[key] / norm]),
  );
  // The flight state shares the +X forward, +Y left, +Z up game frame.
  return normalized([1 - 2 * (y * y + z * z), 2 * (x * y + w * z), 2 * (x * z - w * y)]);
}

export function gameLockAvailable(localPose, peerPose, maximumDistance) {
  const delta = relativeGamePoint(localPose, peerPose);
  const distance = length(delta);
  return distance > 15
    && distance <= maximumDistance
    && dot(gameForward(localPose.orientation), normalized(delta)) >= 0.9;
}

export function createArcadeProjectile(id, ownerSlot, weaponId, nowMs, localPose, peerPose, maximumDistance) {
  const rules = ARCADE_PROJECTILES[weaponId];
  const direction = gameForward(localPose.orientation);
  const locked = weaponId === "missile" && gameLockAvailable(localPose, peerPose, maximumDistance);
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
    const next = addScaled(position, direction, rules.speed * stepMs / 1_000);
    if (target && touchesSegment(position, next, target, rules.touchRadius)) {
      return { projectile: null, touched: true };
    }
    position = next;
    remainingMs -= stepMs;
  }

  if (nowMs >= projectile.expiresAtMs) return { projectile: null, touched: false };
  return {
    projectile: { ...projectile, position, direction, lastStepAtMs: until },
    touched: false,
  };
}
