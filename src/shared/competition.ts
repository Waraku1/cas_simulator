import type { MatchResultReason } from "./product";

export const COMPETITION_MESSAGE_MAX_BYTES = 1_024;
export const COMPETITION_POSE_FRESHNESS_MS = 1_500;

export type CompetitionSlot = 1 | 2;
export type CompetitionPhase = "countdown" | "active" | "overtime" | "completed" | "no-contest";

export type CompetitionParticipantInit = Readonly<{
  slot: CompetitionSlot;
  joinToken: string;
  aircraftId: string;
  spawnSide: "left" | "right";
}>;

export type CompetitionRoomInit = Readonly<{
  matchId: string;
  roomCode: string;
  activeAtMs: number;
  participants: readonly [CompetitionParticipantInit, CompetitionParticipantInit];
}>;

export type CompetitionParticipantSnapshot = Readonly<{
  slot: CompetitionSlot;
  aircraftId: string;
  heartPoints: number;
  connected: boolean;
  nextActionAtMs: number;
  disconnectDeadlineMs: number | null;
}>;

export type CompetitionResultSnapshot = Readonly<{
  winnerSlot: CompetitionSlot | null;
  reason: MatchResultReason;
}>;

export type CompetitionStateSnapshot = Readonly<{
  matchId: string;
  phase: CompetitionPhase;
  serverTimeMs: number;
  activeAtMs: number;
  regulationEndsAtMs: number;
  overtimeEndsAtMs: number;
  participants: readonly [CompetitionParticipantSnapshot, CompetitionParticipantSnapshot];
  result: CompetitionResultSnapshot | null;
}>;

export type ClientCompetitionMessage =
  | Readonly<{
      type: "action";
      clientTimeMs: number;
    }>
  | Readonly<{
      type: "leave_match";
    }>;

export type CompetitionActionFeedbackCode =
  | "accepted"
  | "not_active"
  | "cooldown"
  | "peer_unavailable"
  | "pose_stale"
  | "outside_interaction";

export type ServerCompetitionMessage =
  | Readonly<{
      type: "match_state";
      state: CompetitionStateSnapshot;
    }>
  | Readonly<{
      type: "action_feedback";
      accepted: boolean;
      code: CompetitionActionFeedbackCode;
      nextActionAtMs: number;
    }>;

export type CompetitionPosition = Readonly<{
  latitudeDeg: number;
  longitudeDeg: number;
  altitudeM: number;
}>;

const record = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

const finite = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value);

function byteLength(text: string) {
  return new TextEncoder().encode(text).byteLength;
}

export function parseClientCompetitionMessage(text: string): ClientCompetitionMessage | null {
  if (byteLength(text) > COMPETITION_MESSAGE_MAX_BYTES) return null;
  try {
    const value: unknown = JSON.parse(text);
    if (!record(value) || typeof value.type !== "string") return null;
    if (value.type === "leave_match") return { type: "leave_match" };
    if (value.type === "action" && finite(value.clientTimeMs) && value.clientTimeMs >= 0) {
      return { type: "action", clientTimeMs: value.clientTimeMs };
    }
    return null;
  } catch {
    return null;
  }
}

export function competitionDistanceM(a: CompetitionPosition, b: CompetitionPosition) {
  const earthRadiusM = 6_371_000;
  const toRad = Math.PI / 180;
  const lat1 = a.latitudeDeg * toRad;
  const lat2 = b.latitudeDeg * toRad;
  const dLat = (b.latitudeDeg - a.latitudeDeg) * toRad;
  const dLon = (b.longitudeDeg - a.longitudeDeg) * toRad;
  const hav = Math.sin(dLat / 2) ** 2
    + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  const surfaceM = 2 * earthRadiusM * Math.asin(Math.min(1, Math.sqrt(hav)));
  const altitudeDeltaM = b.altitudeM - a.altitudeM;
  return Math.hypot(surfaceM, altitudeDeltaM);
}
