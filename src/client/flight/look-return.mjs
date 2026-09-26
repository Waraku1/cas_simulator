export const LOOK_RETURN_DURATION_MS = 200;

export function returningLook(startYawRad, startPitchRad, elapsedMs) {
  const progress = Math.max(0, Math.min(1, elapsedMs / LOOK_RETURN_DURATION_MS));
  if (progress >= 1) return { yawRad: 0, pitchRad: 0, completed: true };
  const remaining = 1 - progress * progress * (3 - 2 * progress);
  return {
    yawRad: startYawRad * remaining,
    pitchRad: startPitchRad * remaining,
    completed: false,
  };
}
