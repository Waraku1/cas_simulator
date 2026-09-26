import aircraftCatalog from "../src/shared/aircraft-catalog.json" with { type: "json" };
import weaponCatalog from "../src/shared/weapon-catalog.json" with { type: "json" };
import {
  ARCADE_LOCK,
  ARCADE_TICK_MS,
  MAX_ARCADE_PROJECTILES,
  advanceArcadeProjectile,
  createArcadeProjectile,
  gamePointToPosition,
  gameCaptureAvailable,
} from "../src/shared/arcade-projectiles.mjs";
import { gameGroundContact } from "../src/shared/game-ground.mjs";
import { REGULATION_SECONDS, MAX_OVERTIME_SECONDS, overtimeSecondsForHpGap } from "../src/shared/match-duration.mjs";

const STARTING_HP = 100;
const REGULATION_MS = REGULATION_SECONDS * 1_000;
const OVERTIME_MS = MAX_OVERTIME_SECONDS * 1_000;
const DISCONNECT_GRACE_MS = 20 * 1_000;
const POSE_FRESHNESS_MS = 1_500;

const aircraftById = new Map(aircraftCatalog.map((aircraft) => [aircraft.aircraftId, aircraft]));
const weaponById = new Map(weaponCatalog.map((weapon) => [weapon.weaponId, weapon]));
const DEFAULT_WEAPONS = ["missile", "gun"];

function peerSlot(slot) {
  return slot === 1 ? 2 : 1;
}

function completed(state, winnerSlot, reason) {
  return {
    ...state,
    phase: reason === "infrastructure-failure" ? "no-contest" : "completed",
    result: { winnerSlot, reason },
    projectiles: [],
  };
}

function weaponReadiness(participant) {
  return {
    missile: participant.weaponReadyAtMs?.missile ?? participant.nextActionAtMs,
    gun: participant.weaponReadyAtMs?.gun ?? participant.nextActionAtMs,
  };
}

export function createSchoolRankedRuntime(init) {
  return {
    matchId: init.matchId,
    roomCode: init.roomCode,
    phase: "countdown",
    activeAtMs: init.activeAtMs,
    regulationEndsAtMs: init.activeAtMs + REGULATION_MS,
    overtimeEndsAtMs: init.activeAtMs + REGULATION_MS + OVERTIME_MS,
    participants: init.participants.map((participant) => ({
      ...participant,
      heartPoints: STARTING_HP,
      connected: false,
      nextActionAtMs: init.activeAtMs,
      weaponReadyAtMs: {
        missile: init.activeAtMs,
        gun: init.activeAtMs,
      },
      disconnectDeadlineMs: init.activeAtMs + DISCONNECT_GRACE_MS,
    })),
    result: null,
    projectiles: [],
    nextProjectileSequence: 0,
  };
}

export function advanceSchoolRankedRuntime(state, nowMs) {
  if (state.result) return state;

  const expired = state.participants.filter(
    (participant) => !participant.connected
      && participant.disconnectDeadlineMs !== null
      && participant.disconnectDeadlineMs <= nowMs,
  );
  if (expired.length >= 2) return completed(state, null, "infrastructure-failure");
  if (expired.length === 1) return completed(state, peerSlot(expired[0].slot), "forfeit");

  const zeroHp = state.participants.filter((participant) => participant.heartPoints <= 0);
  if (zeroHp.length === 1) return completed(state, peerSlot(zeroHp[0].slot), "heart-points-depleted");
  if (zeroHp.length >= 2) return completed(state, null, "overtime-draw");

  if (nowMs < state.activeAtMs) {
    return state.phase === "countdown" ? state : { ...state, phase: "countdown" };
  }
  if (nowMs < state.regulationEndsAtMs) {
    return state.phase === "active" ? state : { ...state, phase: "active" };
  }

  const [first, second] = state.participants;
  let advanced = state;
  if (state.phase !== "overtime") {
    advanced = { ...state, phase: "overtime",
      overtimeEndsAtMs: state.regulationEndsAtMs
        + overtimeSecondsForHpGap(first.heartPoints - second.heartPoints) * 1_000 };
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

export function markSchoolRankedConnected(state, slot, nowMs) {
  const advanced = advanceSchoolRankedRuntime(state, nowMs);
  if (advanced.result) return advanced;
  return {
    ...advanced,
    participants: advanced.participants.map((participant) =>
      participant.slot === slot
        ? { ...participant, connected: true, disconnectDeadlineMs: null }
        : participant),
  };
}

export function markSchoolRankedDisconnected(state, slot, nowMs) {
  const advanced = advanceSchoolRankedRuntime(state, nowMs);
  if (advanced.result) return advanced;
  return {
    ...advanced,
    participants: advanced.participants.map((participant) =>
      participant.slot === slot
        ? { ...participant, connected: false, disconnectDeadlineMs: nowMs + DISCONNECT_GRACE_MS }
        : participant),
  };
}

export function forfeitSchoolRanked(state, slot, nowMs) {
  const advanced = advanceSchoolRankedRuntime(state, nowMs);
  if (advanced.result) return advanced;
  return completed(advanced, peerSlot(slot), "forfeit");
}

export function groundContactSchoolRanked(state, slot, pose, nowMs) {
  const advanced = advanceSchoolRankedRuntime(state, nowMs);
  if (advanced.result || (advanced.phase !== "active" && advanced.phase !== "overtime")) return advanced;
  return gameGroundContact(pose.altitudeM, pose.groundHeightM ?? 0)
    ? completed(advanced, peerSlot(slot), "ground-crash") : advanced;
}

export function updateSchoolRankedCapture(client, peer, state, nowMs) {
  const range = weaponById.get("missile")?.activationRadiusM ?? 0;
  const capturing = !state.result && (state.phase === "active" || state.phase === "overtime")
    && state.participants.every((participant) => participant.connected)
    && client.latestPose?.view?.weaponId === "missile" && peer?.latestPose
    && nowMs - client.latestPoseReceivedAtMs <= ARCADE_LOCK.sampleGapMs
    && nowMs - peer.latestPoseReceivedAtMs <= ARCADE_LOCK.sampleGapMs
    && gameCaptureAvailable(client.latestPose, peer.latestPose, range);
  const continuous = capturing && client.captureLastAtMs != null
    && nowMs - client.captureLastAtMs <= ARCADE_LOCK.sampleGapMs;
  client.captureStartedAtMs = capturing
    ? continuous ? client.captureStartedAtMs ?? nowMs : nowMs : null;
  client.captureLastAtMs = capturing ? nowMs : null;
  const locked = client.captureStartedAtMs !== null
    && nowMs - client.captureStartedAtMs >= ARCADE_LOCK.holdMs;
  const changed = Boolean(client.lockNotified) !== locked;
  client.lockNotified = locked;
  return { locked, changed };
}

export function schoolRankedLock(client, peer, nowMs) {
  if (!client.latestPose?.view) return undefined;
  const range = weaponById.get("missile")?.activationRadiusM ?? 0;
  return Boolean(client.lockNotified && peer?.latestPose
    && nowMs - client.latestPoseReceivedAtMs <= ARCADE_LOCK.sampleGapMs
    && nowMs - peer.latestPoseReceivedAtMs <= ARCADE_LOCK.sampleGapMs
    && nowMs - client.captureLastAtMs <= ARCADE_LOCK.sampleGapMs
    && gameCaptureAvailable(client.latestPose, peer.latestPose, range));
}

function distanceM(a, b) {
  const earthRadiusM = 6_371_000;
  const toRad = Math.PI / 180;
  const lat1 = a.latitudeDeg * toRad;
  const lat2 = b.latitudeDeg * toRad;
  const dLat = (b.latitudeDeg - a.latitudeDeg) * toRad;
  const dLon = (b.longitudeDeg - a.longitudeDeg) * toRad;
  const hav = Math.sin(dLat / 2) ** 2
    + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  const surfaceM = 2 * earthRadiusM * Math.asin(Math.min(1, Math.sqrt(hav)));
  return Math.hypot(surfaceM, b.altitudeM - a.altitudeM);
}

export function resolveSchoolRankedAction(
  state,
  slot,
  nowMs,
  localPose,
  peerPose,
  requestedWeaponId = "missile",
  confirmedLock,
) {
  let advanced = advanceSchoolRankedRuntime(state, nowMs);
  const local = advanced.participants[slot - 1];
  const peer = advanced.participants[peerSlot(slot) - 1];
  const aircraft = aircraftById.get(local.aircraftId);
  const loadout = aircraft?.weaponIds ?? DEFAULT_WEAPONS;
  const weapon = loadout.includes(requestedWeaponId) ? weaponById.get(requestedWeaponId) : null;
  const currentReadyAt = weaponReadiness(local)[requestedWeaponId] ?? local.nextActionAtMs;

  const reject = (code) => ({
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
    !localPose || !peerPose
    || nowMs - localPose.receivedAtMs > POSE_FRESHNESS_MS
    || nowMs - peerPose.receivedAtMs > POSE_FRESHNESS_MS
  ) {
    return reject("pose_stale");
  }

  if (requestedWeaponId === "missile" && distanceM(localPose.pose, peerPose.pose) > weapon.activationRadiusM) {
    return reject("outside_interaction");
  }
  const volleySize = requestedWeaponId === "gun" ? 2 : 1;
  if ((advanced.projectiles?.length ?? 0) + volleySize > MAX_ARCADE_PROJECTILES) return reject("projectile_limit");

  const nextReadyAt = nowMs + weapon.cooldownMs;
  const nextSequence = (advanced.nextProjectileSequence ?? 0) + volleySize;
  const volley = Array.from({ length: volleySize }, (_, index) => createArcadeProjectile(
    nextSequence - volleySize + index + 1, slot, requestedWeaponId, nowMs,
    localPose.pose, peerPose.pose, weapon.activationRadiusM, confirmedLock,
    requestedWeaponId === "gun" ? (index === 0 ? -2 : 2) : 0,
  ));
  advanced = {
    ...advanced,
    projectiles: [...(advanced.projectiles ?? []), ...volley],
    nextProjectileSequence: nextSequence,
    participants: advanced.participants.map((participant) => {
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
    }),
  };
  advanced = advanceSchoolRankedRuntime(advanced, nowMs);
  return {
    state: advanced,
    accepted: true,
    code: "accepted",
    weaponId: requestedWeaponId,
    locked: volley[0].targetSlot !== null,
    nextActionAtMs: weaponReadiness(advanced.participants[slot - 1])[requestedWeaponId],
  };
}

export function advanceSchoolRankedProjectiles(state, nowMs, poseForSlot) {
  if (state.result || !state.projectiles?.length) return state;
  const cutoff = Math.min(nowMs, state.overtimeEndsAtMs);
  const projectiles = [];
  const damage = [0, 0];
  for (const projectile of state.projectiles) {
    const peerSlot = peerSlotOf(projectile.ownerSlot);
    const sample = poseForSlot(peerSlot);
    const peerPose = sample && cutoff - sample.receivedAtMs <= POSE_FRESHNESS_MS
      && sample.receivedAtMs <= cutoff && state.participants[peerSlot - 1].connected
      ? sample.pose : null;
    const result = advanceArcadeProjectile(projectile, cutoff, peerPose);
    if (result.projectile) projectiles.push(result.projectile);
    if (result.touched) damage[peerSlot - 1] += weaponById.get(projectile.weaponId)?.heartPointEffect ?? 0;
  }
  return {
    ...state,
    projectiles,
    participants: state.participants.map((participant) => ({
      ...participant,
      heartPoints: Math.max(0, participant.heartPoints - damage[participant.slot - 1]),
    })),
  };
}

const peerSlotOf = (slot) => slot === 1 ? 2 : 1;

export function schoolRankedSnapshot(state, nowMs) {
  const advanced = advanceSchoolRankedRuntime(state, nowMs);
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
    })),
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

export function nextSchoolRankedDeadline(state, nowMs) {
  const advanced = advanceSchoolRankedRuntime(state, nowMs);
  if (advanced.result) return null;
  const deadlines = [
    advanced.phase === "countdown" ? advanced.activeAtMs : null,
    advanced.phase === "active" ? advanced.regulationEndsAtMs : null,
    advanced.phase === "overtime" ? advanced.overtimeEndsAtMs : null,
    advanced.projectiles?.length ? nowMs + ARCADE_TICK_MS : null,
    ...advanced.participants.map((participant) => participant.disconnectDeadlineMs),
  ].filter((value) => value !== null && value > nowMs);
  return deadlines.length > 0 ? Math.min(...deadlines) : null;
}
