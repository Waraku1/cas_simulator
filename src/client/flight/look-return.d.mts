export const LOOK_RETURN_DURATION_MS: number;
export function returningLook(startYawRad: number, startPitchRad: number, elapsedMs: number): {
  yawRad: number;
  pitchRad: number;
  completed: boolean;
};
