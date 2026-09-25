import type { AircraftPose } from "./multiplayer";
import type { WeaponId } from "./product";

export type GamePosition = Pick<AircraftPose, "latitudeDeg" | "longitudeDeg" | "altitudeM">;
export type GameVector = [number, number, number];
export type ArcadeProjectile = {
  id: number;
  ownerSlot: 1 | 2;
  weaponId: WeaponId;
  origin: GamePosition;
  position: GameVector;
  direction: GameVector;
  targetSlot: 1 | 2 | null;
  lastStepAtMs: number;
  expiresAtMs: number;
};
export const ARCADE_PROJECTILES: Readonly<Record<WeaponId, Readonly<{
  speed: number;
  lifetimeMs: number;
  touchRadius: number;
  maxTravelM?: number;
}>>>;
export const MAX_ARCADE_PROJECTILES: number;
export const ARCADE_TICK_MS: number;
export const ARCADE_LOCK: Readonly<{
  holdMs: number;
  sampleGapMs: number;
  centerCosine: number;
  cameraBackM: number;
  cameraUpM: number;
  cameraLookAheadM: number;
}>;
export function relativeGamePoint(origin: GamePosition, pose: GamePosition): GameVector;
export function gamePointToPosition(origin: GamePosition, point: GameVector): GamePosition;
export function gameForward(orientation: AircraftPose["orientation"]): GameVector;
export function gameLockAvailable(localPose: AircraftPose, peerPose: GamePosition, maximumDistance: number): boolean;
export function gameCaptureAvailable(localPose: AircraftPose & { view?: { yawRad: number; pitchRad: number } }, peerPose: GamePosition, maximumDistance: number): boolean;
export function createArcadeProjectile(id: number, ownerSlot: 1 | 2, weaponId: WeaponId, nowMs: number, localPose: AircraftPose, peerPose: GamePosition, maximumDistance: number, confirmedLock?: boolean): ArcadeProjectile;
export function advanceArcadeProjectile(projectile: ArcadeProjectile, nowMs: number, peerPose: GamePosition | null): {
  projectile: ArcadeProjectile | null;
  touched: boolean;
};
