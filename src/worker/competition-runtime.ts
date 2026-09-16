import { actionModuleById } from "../shared/action-modules";
import { aircraftById } from "../shared/aircraft";
import {
  COMPETITION_POSE_FRESHNESS_MS,
  competitionDistanceM,
  type CompetitionActionFeedbackCode,
  type CompetitionRoomInit,
  type CompetitionSlot,
  type CompetitionStateSnapshot,
} from "../shared/competition";
import type { AircraftPose } from "../shared/multiplayer";
import { clampHeartPoints, MATCH_RULES, type MatchResultReason } from "../shared/product";

export type StoredCompetitionParticipant = {
  slot: CompetitionSlot;
  joinToken: string;
  aircraftId: string;
  spawnSide: "left" | "right";
  accountUserId: string | null;
  randomAssignment: boolean;
  heartPoints: number;
  connected: boolean;
  nextActionAtMs: number;
  disconnectDeadlineMs: number | null;
};

export type StoredCompetitionRuntime = {
  matchId: string;
  roomCode: string;
  phase: "countdown" | "active" | "overtime" | "completed" | "no-contest";
  activeAtMs: number;
  regulationEndsAtMs: number;
  overtimeEndsAtMs: number;
  participants: [StoredCompetitionParticipant, StoredCompetitionParticipant];
  result: {
    winnerSlot: CompetitionSlot | null;
    reason: MatchResultReason;
  } | null;
};

export type ServerPoseSample = Readonly<{
  pose: AircraftPose;
  receivedAtMs: number;
}>;

export type ActionResolution = Readonly<{
  state: StoredCompetitionRuntime;
  accepted: boolean;
  code: CompetitionActionFeedbackCode;
  nextActionAtMs: number;
}>;

const regulationDurationMs = MATCH_RULES.regulationSeconds * 1_000;
const overtimeDurationMs = MATCH_RULES.overtimeSeconds * 1_000;
const disconnectGraceMs = MATCH_RULES.disconnectGraceSeconds * 1_000;

function participantBySlot(state: StoredCompetitionRuntime, slot: CompetitionSlot) {
  return state.participants[slot - 1];
}

function peerSlot(slot: CompetitionSlot): CompetitionSlot {
  return slot === 1 ? 2 : 1;
}

function completed(
  state: StoredCompetitionRuntime,
  winnerSlot: CompetitionSlot | null,
  reason: MatchResultReason,
): StoredCompetitionRuntime {
  return {
    ...state,
    phase: reason === "infrastructure-failure" ? "no-contest" : "completed",
    result: { winnerSlot, reason },
  };
}

export function createCompetitionRuntime(init: CompetitionRoomInit): StoredCompetitionRuntime {
  return {
    matchId: init.matchId,
    roomCode: init.roomCode,
    phase: "countdown",
    activeAtMs: init.activeAtMs,
    regulationEndsAtMs: init.activeAtMs + regulationDurationMs,
    overtimeEndsAtMs: init.activeAtMs + regulationDurationMs + overtimeDurationMs,
    participants: init.participants.map((participant) => ({
      slot: participant.slot,
      joinToken: participant.joinToken,
      aircraftId: participant.aircraftId,
      spawnSide: participant.spawnSide,
      accountUserId: participant.accountUserId ?? null,
      randomAssignment: participant.randomAssignment ?? false,
      heartPoints: MATCH_RULES.startingHeartPoints,
      connected: false,
      nextActionAtMs: init.activeAtMs,
      disconnectDeadlineMs: null,
    })) as [StoredCompetitionParticipant, StoredCompetitionParticipant],
    result: null,
  };
}

export function advanceCompetitionRuntime(
  state: StoredCompetitionRuntime,
  nowMs: number,
): StoredCompetitionRuntime {
  if (state.result) return state;

  const expired = state.participants.filter(
    (participant) => !participant.connected
      && participant.disconnectDeadlineMs !== null
      && participant.disconnectDeadlineMs <= nowMs,
  );
  if (expired.length >= 2) {
    return completed(state, null, "infrastructure-failure");
  }
  if (expired.length === 1) {
    return completed(state, peerSlot(expired[0].slot), "forfeit");
  }

  const zeroHp = state.participants.filter((participant) => participant.heartPoints <= 0);
  if (zeroHp.length === 1) {
    return completed(state, peerSlot(zeroHp[0].slot), "heart-points-depleted");
  }
  if (zeroHp.length >= 2) {
    return completed(state, null, "overtime-draw");
  }

  if (nowMs < state.activeAtMs) {
    return state.phase === "countdown" ? state : { ...state, phase: "countdown" };
  }

  if (nowMs < state.regulationEndsAtMs) {
    return state.phase === "active" ? state : { ...state, phase: "active" };
  }

  const [first, second] = state.participants;
  let advanced = state;

  if (state.phase !== "overtime") {
    if (first.heartPoints !== second.heartPoints) {
      return completed(
        state,
        first.heartPoints > second.heartPoints ? 1 : 2,
        "regulation-heart-points",
      );
    }
    advanced = { ...state, phase: "overtime" };
  }

  if (nowMs < advanced.overtimeEndsAtMs) return advanced;

  const [overtimeFirst, overtimeSecond] = advanced.participants;
  if (overtimeFirst.heartPoints !== overtimeSecond.heartPoints) {
    return completed(
      advanced,
      overtimeFirst.heartPoints > overtimeSecond.heartPoints ? 1 : 2,
      "overtime-heart-points",
    );
  }
  return completed(advanced, null, "overtime-draw");
}

export function markCompetitionConnected(
  state: StoredCompetitionRuntime,
  slot: CompetitionSlot,
  nowMs: number,
) {
  const advanced = advanceCompetitionRuntime(state, nowMs);
  if (advanced.result) return advanced;
  const participants = advanced.participants.map((participant) =>
    participant.slot === slot
      ? { ...participant, connected: true, disconnectDeadlineMs: null }
      : participant,
  ) as [StoredCompetitionParticipant, StoredCompetitionParticipant];
  return { ...advanced, participants };
}

export function markCompetitionDisconnected(
  state: StoredCompetitionRuntime,
  slot: CompetitionSlot,
  nowMs: number,
) {
  const advanced = advanceCompetitionRuntime(state, nowMs);
  if (advanced.result) return advanced;
  const participants = advanced.participants.map((participant) =>
    participant.slot === slot
      ? {
          ...participant,
          connected: false,
          disconnectDeadlineMs: nowMs + disconnectGraceMs,
        }
      : participant,
  ) as [StoredCompetitionParticipant, StoredCompetitionParticipant];
  return { ...advanced, participants };
}

export function forfeitCompetition(
  state: StoredCompetitionRuntime,
  slot: CompetitionSlot,
  nowMs: number,
) {
  const advanced = advanceCompetitionRuntime(state, nowMs);
  if (advanced.result) return advanced;
  return completed(advanced, peerSlot(slot), "forfeit");
}

export function noContestCompetition(state: StoredCompetitionRuntime) {
  if (state.result) return state;
  return completed(state, null, "infrastructure-failure");
}

export function resolveCompetitionAction(
  state: StoredCompetitionRuntime,
  slot: CompetitionSlot,
  nowMs: number,
  localPose: ServerPoseSample | null,
  peerPose: ServerPoseSample | null,
): ActionResolution {
  let advanced = advanceCompetitionRuntime(state, nowMs);
  const local = participantBySlot(advanced, slot);
  const peer = participantBySlot(advanced, peerSlot(slot));

  const reject = (code: CompetitionActionFeedbackCode): ActionResolution => ({
    state: advanced,
    accepted: false,
    code,
    nextActionAtMs: local.nextActionAtMs,
  });

  if (advanced.phase !== "active" && advanced.phase !== "overtime") return reject("not_active");
  if (!local.connected || !peer.connected) return reject("peer_unavailable");
  if (nowMs < local.nextActionAtMs) return reject("cooldown");
  if (
    !localPose
    || !peerPose
    || nowMs - localPose.receivedAtMs > COMPETITION_POSE_FRESHNESS_MS
    || nowMs - peerPose.receivedAtMs > COMPETITION_POSE_FRESHNESS_MS
  ) {
    return reject("pose_stale");
  }

  const aircraft = aircraftById(local.aircraftId);
  const module = aircraft ? actionModuleById(aircraft.actionModuleId) : null;
  if (!module) return reject("not_active");

  if (competitionDistanceM(localPose.pose, peerPose.pose) > module.activationRadiusM) {
    return reject("outside_interaction");
  }

  const participants = advanced.participants.map((participant) => {
    if (participant.slot === local.slot) {
      return { ...participant, nextActionAtMs: nowMs + module.cooldownMs };
    }
    if (participant.slot === peer.slot) {
      return {
        ...participant,
        heartPoints: clampHeartPoints(participant.heartPoints - module.heartPointEffect),
      };
    }
    return participant;
  }) as [StoredCompetitionParticipant, StoredCompetitionParticipant];

  advanced = advanceCompetitionRuntime({ ...advanced, participants }, nowMs);
  return {
    state: advanced,
    accepted: true,
    code: "accepted",
    nextActionAtMs: participantBySlot(advanced, slot).nextActionAtMs,
  };
}

export function competitionSnapshot(
  state: StoredCompetitionRuntime,
  nowMs: number,
): CompetitionStateSnapshot {
  const advanced = advanceCompetitionRuntime(state, nowMs);
  return {
    matchId: advanced.matchId,
    phase: advanced.phase,
    serverTimeMs: nowMs,
    activeAtMs: advanced.activeAtMs,
    regulationEndsAtMs: advanced.regulationEndsAtMs,
    overtimeEndsAtMs: advanced.overtimeEndsAtMs,
    participants: advanced.participants.map((participant) => ({
      slot: participant.slot,
      aircraftId: participant.aircraftId,
      heartPoints: participant.heartPoints,
      connected: participant.connected,
      nextActionAtMs: participant.nextActionAtMs,
      disconnectDeadlineMs: participant.disconnectDeadlineMs,
    })) as CompetitionStateSnapshot["participants"],
    result: advanced.result,
  };
}

export function nextCompetitionDeadline(state: StoredCompetitionRuntime, nowMs: number) {
  const advanced = advanceCompetitionRuntime(state, nowMs);
  if (advanced.result) return null;
  const deadlines = [
    advanced.phase === "countdown" ? advanced.activeAtMs : null,
    advanced.phase === "active" ? advanced.regulationEndsAtMs : null,
    advanced.phase === "overtime" ? advanced.overtimeEndsAtMs : null,
    ...advanced.participants.map((participant) => participant.disconnectDeadlineMs),
  ].filter((value): value is number => value !== null && value > nowMs);
  return deadlines.length > 0 ? Math.min(...deadlines) : null;
}
