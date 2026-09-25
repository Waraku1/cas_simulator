import { aircraftById } from "../shared/aircraft";
import {
  ARCADE_TICK_MS,
  MAX_ARCADE_PROJECTILES,
  advanceArcadeProjectile,
  createArcadeProjectile,
  gamePointToPosition,
  type ArcadeProjectile,
} from "../shared/arcade-projectiles.mjs";
import {
  COMPETITION_POSE_FRESHNESS_MS,
  competitionDistanceM,
  type CompetitionActionFeedbackCode,
  type CompetitionRoomInit,
  type CompetitionSlot,
  type CompetitionStateSnapshot,
} from "../shared/competition";
import type { AircraftPose, GameView } from "../shared/multiplayer";
import {
  clampHeartPoints,
  MATCH_RULES,
  type MatchResultReason,
  type WeaponId,
} from "../shared/product";
import { DEFAULT_WEAPON_LOADOUT, weaponById, weaponReadyAt } from "../shared/weapons";

export type StoredCompetitionParticipant = {
  slot: CompetitionSlot;
  joinToken: string;
  aircraftId: string;
  spawnSide: "left" | "right";
  accountUserId: string | null;
  randomAssignment: boolean;
  heartPoints: number;
  connected: boolean;
  /** Legacy single-action readiness retained for rolling compatibility. */
  nextActionAtMs: number;
  weaponReadyAtMs?: Record<WeaponId, number>;
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
  projectiles?: ArcadeProjectile[];
  nextProjectileSequence?: number;
  result: {
    winnerSlot: CompetitionSlot | null;
    reason: MatchResultReason;
  } | null;
};

export type ServerPoseSample = Readonly<{
  pose: AircraftPose & { view?: GameView };
  receivedAtMs: number;
}>;

export type ActionResolution = Readonly<{
  state: StoredCompetitionRuntime;
  accepted: boolean;
  code: CompetitionActionFeedbackCode;
  weaponId: WeaponId;
  nextActionAtMs: number;
  locked: boolean;
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

function weaponReadiness(
  participant: StoredCompetitionParticipant,
): Record<WeaponId, number> {
  return {
    missile: weaponReadyAt(participant.weaponReadyAtMs, "missile", participant.nextActionAtMs),
    gun: weaponReadyAt(participant.weaponReadyAtMs, "gun", participant.nextActionAtMs),
  };
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
    projectiles: [],
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
      weaponReadyAtMs: {
        missile: init.activeAtMs,
        gun: init.activeAtMs,
      },
      disconnectDeadlineMs: init.activeAtMs + disconnectGraceMs,
    })) as [StoredCompetitionParticipant, StoredCompetitionParticipant],
    result: null,
    projectiles: [],
    nextProjectileSequence: 0,
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
  requestedWeaponId: WeaponId = "missile",
  confirmedLock?: boolean,
): ActionResolution {
  let advanced = advanceCompetitionRuntime(state, nowMs);
  const local = participantBySlot(advanced, slot);
  const peer = participantBySlot(advanced, peerSlot(slot));
  const aircraft = aircraftById(local.aircraftId);
  const loadout = aircraft?.weaponIds ?? DEFAULT_WEAPON_LOADOUT;
  const weapon = loadout.includes(requestedWeaponId)
    ? weaponById(requestedWeaponId)
    : null;
  const currentReadyAt = weaponReadyAt(
    local.weaponReadyAtMs,
    requestedWeaponId,
    local.nextActionAtMs,
  );

  const reject = (code: CompetitionActionFeedbackCode): ActionResolution => ({
    state: advanced,
    accepted: false,
    code,
    weaponId: requestedWeaponId,
    nextActionAtMs: currentReadyAt,
    locked: false,
  });

  if (!weapon) return reject("invalid_weapon");
  if (advanced.phase !== "active" && advanced.phase !== "overtime") return reject("not_active");
  if (!local.connected || !peer.connected) return reject("peer_unavailable");
  if (nowMs < currentReadyAt) return reject("cooldown");
  if (
    !localPose
    || !peerPose
    || nowMs - localPose.receivedAtMs > COMPETITION_POSE_FRESHNESS_MS
    || nowMs - peerPose.receivedAtMs > COMPETITION_POSE_FRESHNESS_MS
  ) {
    return reject("pose_stale");
  }

  // The gun launches regardless of peer distance. Its bounded game-space
  // trajectory and segment contact decide whether it can reach the peer.
  if (requestedWeaponId === "missile" && competitionDistanceM(localPose.pose, peerPose.pose) > weapon.activationRadiusM) {
    return reject("outside_interaction");
  }
  if ((advanced.projectiles?.length ?? 0) >= MAX_ARCADE_PROJECTILES) return reject("projectile_limit");

  const nextReadyAt = nowMs + weapon.cooldownMs;
  const projectile = createArcadeProjectile(
    (advanced.nextProjectileSequence ?? 0) + 1,
    slot,
    requestedWeaponId,
    nowMs,
    localPose.pose,
    peerPose.pose,
    weapon.activationRadiusM,
    confirmedLock,
  );
  const participants = advanced.participants.map((participant) => {
    if (participant.slot === local.slot) {
      return {
        ...participant,
        nextActionAtMs: nextReadyAt,
        weaponReadyAtMs: {
          ...weaponReadiness(participant),
          [requestedWeaponId]: nextReadyAt,
        },
      };
    }
    return participant;
  }) as [StoredCompetitionParticipant, StoredCompetitionParticipant];

  advanced = { ...advanced, participants,
    projectiles: [...(advanced.projectiles ?? []), projectile],
    nextProjectileSequence: projectile.id,
  };
  return {
    state: advanced,
    accepted: true,
    code: "accepted",
    weaponId: requestedWeaponId,
    locked: projectile.targetSlot !== null,
    nextActionAtMs: weaponReadyAt(
      participantBySlot(advanced, slot).weaponReadyAtMs,
      requestedWeaponId,
      nextReadyAt,
    ),
  };
}

/** Server-side arcade movement and contact. Pose freshness prevents an old
 * client position from producing a new contact after the link goes stale. */
export function advanceCompetitionProjectiles(
  state: StoredCompetitionRuntime,
  nowMs: number,
  poseForSlot: (slot: CompetitionSlot) => ServerPoseSample | null,
): StoredCompetitionRuntime {
  if (state.result || !state.projectiles?.length) return state;
  const cutoff = Math.min(nowMs, state.overtimeEndsAtMs,
    state.phase === "active" && state.participants[0].heartPoints !== state.participants[1].heartPoints
      ? state.regulationEndsAtMs : Number.POSITIVE_INFINITY);
  const projectiles: ArcadeProjectile[] = [];
  const damage: [number, number] = [0, 0];
  for (const projectile of state.projectiles) {
    const peerSlot = projectile.ownerSlot === 1 ? 2 : 1;
    const sample = poseForSlot(peerSlot);
    const peerPose = sample && cutoff - sample.receivedAtMs <= COMPETITION_POSE_FRESHNESS_MS
      && sample.receivedAtMs <= cutoff && state.participants[peerSlot - 1].connected
      ? sample.pose : null;
    const result = advanceArcadeProjectile(projectile, cutoff, peerPose);
    if (result.projectile) projectiles.push(result.projectile);
    if (result.touched) {
      damage[peerSlot - 1] += weaponById(projectile.weaponId)?.heartPointEffect ?? 0;
    }
  }
  const participants = state.participants.map((participant) => ({
    ...participant,
    heartPoints: clampHeartPoints(participant.heartPoints - damage[participant.slot - 1]),
  })) as [StoredCompetitionParticipant, StoredCompetitionParticipant];
  return { ...state, participants, projectiles };
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
      weaponReadyAtMs: weaponReadiness(participant),
      disconnectDeadlineMs: participant.disconnectDeadlineMs,
    })) as CompetitionStateSnapshot["participants"],
    projectiles: (advanced.projectiles ?? []).map((projectile) => ({
      id: projectile.id,
      ownerSlot: projectile.ownerSlot,
      weaponId: projectile.weaponId,
      locked: projectile.targetSlot !== null,
      ...gamePointToPosition(projectile.origin, projectile.position),
    })),
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
    advanced.projectiles?.length ? nowMs + ARCADE_TICK_MS : null,
    ...advanced.participants.map((participant) => participant.disconnectDeadlineMs),
  ].filter((value): value is number => value !== null && value > nowMs);
  return deadlines.length > 0 ? Math.min(...deadlines) : null;
}
