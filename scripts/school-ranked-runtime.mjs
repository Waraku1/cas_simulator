import aircraftCatalog from "../src/shared/aircraft-catalog.json" with { type: "json" };
import actionModuleCatalog from "../src/shared/action-module-catalog.json" with { type: "json" };

const STARTING_HP = 100;
const REGULATION_MS = 4 * 60 * 1_000;
const OVERTIME_MS = 60 * 1_000;
const DISCONNECT_GRACE_MS = 20 * 1_000;
const POSE_FRESHNESS_MS = 1_500;

const aircraftById = new Map(aircraftCatalog.map((aircraft) => [aircraft.aircraftId, aircraft]));
const moduleById = new Map(actionModuleCatalog.map((module) => [module.actionModuleId, module]));

function peerSlot(slot) {
  return slot === 1 ? 2 : 1;
}

function completed(state, winnerSlot, reason) {
  return {
    ...state,
    phase: reason === "infrastructure-failure" ? "no-contest" : "completed",
    result: { winnerSlot, reason },
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
      disconnectDeadlineMs: null,
    })),
    result: null,
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
    if (first.heartPoints !== second.heartPoints) {
      return completed(state, first.heartPoints > second.heartPoints ? 1 : 2, "regulation-heart-points");
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

export function resolveSchoolRankedAction(state, slot, nowMs, localPose, peerPose) {
  let advanced = advanceSchoolRankedRuntime(state, nowMs);
  const local = advanced.participants[slot - 1];
  const peer = advanced.participants[peerSlot(slot) - 1];
  const reject = (code) => ({
    state: advanced,
    accepted: false,
    code,
    nextActionAtMs: local.nextActionAtMs,
  });

  if (advanced.phase !== "active" && advanced.phase !== "overtime") return reject("not_active");
  if (!local.connected || !peer.connected) return reject("peer_unavailable");
  if (nowMs < local.nextActionAtMs) return reject("cooldown");
  if (
    !localPose || !peerPose
    || nowMs - localPose.receivedAtMs > POSE_FRESHNESS_MS
    || nowMs - peerPose.receivedAtMs > POSE_FRESHNESS_MS
  ) {
    return reject("pose_stale");
  }

  const aircraft = aircraftById.get(local.aircraftId);
  const module = aircraft ? moduleById.get(aircraft.actionModuleId) : null;
  if (!module) return reject("not_active");
  if (distanceM(localPose.pose, peerPose.pose) > module.activationRadiusM) return reject("outside_interaction");

  advanced = {
    ...advanced,
    participants: advanced.participants.map((participant) => {
      if (participant.slot === local.slot) {
        return { ...participant, nextActionAtMs: nowMs + module.cooldownMs };
      }
      if (participant.slot === peer.slot) {
        return {
          ...participant,
          heartPoints: Math.max(0, Math.min(STARTING_HP, Math.round(participant.heartPoints - module.heartPointEffect))),
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
    nextActionAtMs: advanced.participants[slot - 1].nextActionAtMs,
  };
}

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
      disconnectDeadlineMs: participant.disconnectDeadlineMs,
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
    ...advanced.participants.map((participant) => participant.disconnectDeadlineMs),
  ].filter((value) => value !== null && value > nowMs);
  return deadlines.length > 0 ? Math.min(...deadlines) : null;
}
