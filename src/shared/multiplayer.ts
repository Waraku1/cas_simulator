export const ROOM_CODE_LENGTH = 6;
export const ROOM_CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
export const ROOM_CODE_PATTERN = /^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{6}$/;
export const MAX_ROOM_PLAYERS = 2;
export const SNAPSHOT_INTERVAL_MS = 200;
export const MAX_ROOM_MESSAGE_BYTES = 2_048;

export type NetworkQuaternion = Readonly<{
  w: number;
  x: number;
  y: number;
  z: number;
}>;

export type AircraftPose = Readonly<{
  latitudeDeg: number;
  longitudeDeg: number;
  altitudeM: number;
  orientation: NetworkQuaternion;
}>;

export type PoseSnapshot = AircraftPose & Readonly<{
  sequence: number;
  clientTimeMs: number;
}>;

export type ClientRoomMessage = Readonly<{
  type: "pose";
  pose: PoseSnapshot;
}>;

export type ServerRoomMessage =
  | Readonly<{
      type: "welcome";
      roomCode: string;
      playerId: string;
      slot: 1 | 2;
      peerConnected: boolean;
    }>
  | Readonly<{
      type: "presence";
      playerCount: number;
      peerConnected: boolean;
    }>
  | Readonly<{
      type: "peer_pose";
      playerId: string;
      serverTimeMs: number;
      pose: PoseSnapshot;
    }>
  | Readonly<{
      type: "error";
      code: string;
      message: string;
    }>;

const finite = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value);

const record = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

export function normalizeRoomCode(value: string) {
  const upper = value.toUpperCase();
  let normalized = "";
  for (const character of upper) {
    if (!ROOM_CODE_ALPHABET.includes(character)) continue;
    normalized += character;
    if (normalized.length >= ROOM_CODE_LENGTH) break;
  }
  return normalized;
}

export function isValidRoomCode(value: string) {
  return ROOM_CODE_PATTERN.test(value);
}

export function generateRoomCode() {
  const bytes = new Uint8Array(ROOM_CODE_LENGTH);
  crypto.getRandomValues(bytes);
  let code = "";
  for (const byte of bytes) {
    code += ROOM_CODE_ALPHABET[byte % ROOM_CODE_ALPHABET.length];
  }
  return code;
}

export function isAircraftPose(value: unknown): value is AircraftPose {
  if (!record(value) || !record(value.orientation)) return false;
  const orientation = value.orientation;
  if (
    !finite(value.latitudeDeg)
    || value.latitudeDeg < -85
    || value.latitudeDeg > 85
    || !finite(value.longitudeDeg)
    || value.longitudeDeg < -180
    || value.longitudeDeg > 180
    || !finite(value.altitudeM)
    || value.altitudeM < 0
    || value.altitudeM > 20_000
    || !finite(orientation.w)
    || !finite(orientation.x)
    || !finite(orientation.y)
    || !finite(orientation.z)
  ) {
    return false;
  }

  const norm = Math.hypot(orientation.w, orientation.x, orientation.y, orientation.z);
  return norm >= 0.8 && norm <= 1.2;
}

export function isPoseSnapshot(value: unknown): value is PoseSnapshot {
  return record(value)
    && isAircraftPose(value)
    && Number.isSafeInteger(value.sequence)
    && (value.sequence as number) >= 0
    && finite(value.clientTimeMs)
    && value.clientTimeMs >= 0;
}

export function parseClientRoomMessage(text: string): ClientRoomMessage | null {
  if (new TextEncoder().encode(text).byteLength > MAX_ROOM_MESSAGE_BYTES) return null;
  try {
    const value: unknown = JSON.parse(text);
    if (!record(value) || value.type !== "pose" || !isPoseSnapshot(value.pose)) return null;
    return { type: "pose", pose: value.pose };
  } catch {
    return null;
  }
}

export function parseServerRoomMessage(text: string): ServerRoomMessage | null {
  if (new TextEncoder().encode(text).byteLength > MAX_ROOM_MESSAGE_BYTES) return null;
  try {
    const value: unknown = JSON.parse(text);
    if (!record(value) || typeof value.type !== "string") return null;

    if (
      value.type === "welcome"
      && typeof value.roomCode === "string"
      && isValidRoomCode(value.roomCode)
      && typeof value.playerId === "string"
      && (value.slot === 1 || value.slot === 2)
      && typeof value.peerConnected === "boolean"
    ) {
      return value as ServerRoomMessage;
    }

    if (
      value.type === "presence"
      && Number.isInteger(value.playerCount)
      && finite(value.playerCount)
      && value.playerCount >= 0
      && value.playerCount <= MAX_ROOM_PLAYERS
      && typeof value.peerConnected === "boolean"
    ) {
      return value as ServerRoomMessage;
    }

    if (
      value.type === "peer_pose"
      && typeof value.playerId === "string"
      && finite(value.serverTimeMs)
      && isPoseSnapshot(value.pose)
    ) {
      return value as ServerRoomMessage;
    }

    if (
      value.type === "error"
      && typeof value.code === "string"
      && typeof value.message === "string"
    ) {
      return value as ServerRoomMessage;
    }

    return null;
  } catch {
    return null;
  }
}
