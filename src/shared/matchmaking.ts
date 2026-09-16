import { isAircraftId } from "./aircraft";
import { isValidRoomCode } from "./multiplayer";

export const MATCHMAKING_PATH = "/api/matchmaking/ws";
export const MATCHMAKING_MESSAGE_MAX_BYTES = 1_024;
export const MATCHMAKING_ASSIGNMENT_REVEAL_MS = 2_500;
export const MATCHMAKING_COUNTDOWN_MS = 5_000;

export type SpawnSide = "left" | "right";

export type ClientMatchmakingMessage =
  | Readonly<{
      type: "enqueue";
      fixedAircraftId: string | null;
    }>
  | Readonly<{
      type: "cancel";
    }>;

export type MatchFoundAssignment = Readonly<{
  matchId: string;
  roomCode: string;
  aircraftId: string;
  peerAircraftId: string;
  spawnSide: SpawnSide;
  assignmentEndsAtMs: number;
  activeAtMs: number;
}>;

export type ServerMatchmakingMessage =
  | Readonly<{
      type: "queued";
      queuedAtMs: number;
    }>
  | Readonly<{
      type: "match_found";
      assignment: MatchFoundAssignment;
    }>
  | Readonly<{
      type: "error";
      code: string;
      message: string;
    }>;

const record = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

const finite = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value);

function byteLength(text: string) {
  return new TextEncoder().encode(text).byteLength;
}

export function parseClientMatchmakingMessage(text: string): ClientMatchmakingMessage | null {
  if (byteLength(text) > MATCHMAKING_MESSAGE_MAX_BYTES) return null;
  try {
    const value: unknown = JSON.parse(text);
    if (!record(value) || typeof value.type !== "string") return null;
    if (value.type === "cancel") return { type: "cancel" };
    if (value.type === "enqueue") {
      if (value.fixedAircraftId !== null && !isAircraftId(value.fixedAircraftId)) return null;
      return { type: "enqueue", fixedAircraftId: value.fixedAircraftId as string | null };
    }
    return null;
  } catch {
    return null;
  }
}

export function parseServerMatchmakingMessage(text: string): ServerMatchmakingMessage | null {
  if (byteLength(text) > MATCHMAKING_MESSAGE_MAX_BYTES * 2) return null;
  try {
    const value: unknown = JSON.parse(text);
    if (!record(value) || typeof value.type !== "string") return null;

    if (value.type === "queued" && finite(value.queuedAtMs) && value.queuedAtMs >= 0) {
      return { type: "queued", queuedAtMs: value.queuedAtMs };
    }

    if (value.type === "error" && typeof value.code === "string" && typeof value.message === "string") {
      return { type: "error", code: value.code, message: value.message };
    }

    if (value.type !== "match_found" || !record(value.assignment)) return null;
    const assignment = value.assignment;
    if (
      typeof assignment.matchId !== "string"
      || assignment.matchId.length < 8
      || typeof assignment.roomCode !== "string"
      || !isValidRoomCode(assignment.roomCode)
      || !isAircraftId(assignment.aircraftId)
      || !isAircraftId(assignment.peerAircraftId)
      || (assignment.spawnSide !== "left" && assignment.spawnSide !== "right")
      || !finite(assignment.assignmentEndsAtMs)
      || !finite(assignment.activeAtMs)
      || assignment.assignmentEndsAtMs < 0
      || assignment.activeAtMs < assignment.assignmentEndsAtMs
    ) {
      return null;
    }

    return {
      type: "match_found",
      assignment: assignment as unknown as MatchFoundAssignment,
    };
  } catch {
    return null;
  }
}
