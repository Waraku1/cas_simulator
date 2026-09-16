import {
  advanceSchoolRankedRuntime,
  createSchoolRankedRuntime,
  markSchoolRankedConnected,
  markSchoolRankedDisconnected,
} from "./school-ranked-runtime.mjs";

function baseState(activeAtMs = 10_000) {
  return createSchoolRankedRuntime({
    matchId: "11111111-1111-4111-8111-111111111111",
    roomCode: "ABC234",
    activeAtMs,
    participants: [
      { slot: 1, joinToken: "token-token-token-1", aircraftId: "orbit-a1", spawnSide: "left" },
      { slot: 2, joinToken: "token-token-token-2", aircraftId: "strata-b2", spawnSide: "right" },
    ],
  });
}

let state = baseState();
state = markSchoolRankedConnected(state, 1, 10_001);
state = markSchoolRankedConnected(state, 2, 10_001);
if (advanceSchoolRankedRuntime(state, 10_001).phase !== "active") throw new Error("ACTIVE transition failed");

const regulationEnd = state.regulationEndsAtMs;
state = {
  ...state,
  participants: [
    { ...state.participants[0], heartPoints: 88 },
    { ...state.participants[1], heartPoints: 76 },
  ],
};
let regulationResult = advanceSchoolRankedRuntime(state, regulationEnd);
if (regulationResult.phase !== "completed" || regulationResult.result?.winnerSlot !== 1 || regulationResult.result?.reason !== "regulation-heart-points") {
  throw new Error("regulation HP result failed");
}

state = baseState();
state = markSchoolRankedConnected(state, 1, 10_001);
state = markSchoolRankedConnected(state, 2, 10_001);
let overtimeState = advanceSchoolRankedRuntime(state, state.regulationEndsAtMs);
if (overtimeState.phase !== "overtime" || overtimeState.result !== null) throw new Error("overtime transition failed");

overtimeState = {
  ...overtimeState,
  participants: [
    { ...overtimeState.participants[0], heartPoints: 93 },
    { ...overtimeState.participants[1], heartPoints: 86 },
  ],
};
const duringOvertime = advanceSchoolRankedRuntime(overtimeState, overtimeState.overtimeEndsAtMs - 1);
if (duringOvertime.phase !== "overtime" || duringOvertime.result !== null) {
  throw new Error("overtime ended before the full 60 seconds");
}
const overtimeResult = advanceSchoolRankedRuntime(duringOvertime, duringOvertime.overtimeEndsAtMs);
if (overtimeResult.result?.winnerSlot !== 1 || overtimeResult.result?.reason !== "overtime-heart-points") {
  throw new Error("overtime HP result failed");
}

state = baseState();
state = markSchoolRankedConnected(state, 1, 10_001);
state = markSchoolRankedConnected(state, 2, 10_001);
state = advanceSchoolRankedRuntime(state, state.regulationEndsAtMs);
const draw = advanceSchoolRankedRuntime(state, state.overtimeEndsAtMs);
if (draw.phase !== "completed" || draw.result?.winnerSlot !== null || draw.result?.reason !== "overtime-draw") {
  throw new Error("overtime draw failed");
}

state = baseState();
state = markSchoolRankedConnected(state, 1, 10_001);
state = markSchoolRankedConnected(state, 2, 10_001);
state = markSchoolRankedDisconnected(state, 2, 15_000);
if (advanceSchoolRankedRuntime(state, 34_999).result !== null) throw new Error("disconnect grace ended early");
const forfeit = advanceSchoolRankedRuntime(state, 35_000);
if (forfeit.result?.winnerSlot !== 1 || forfeit.result?.reason !== "forfeit") {
  throw new Error("disconnect grace forfeit failed");
}

state = baseState();
state = markSchoolRankedConnected(state, 1, 10_001);
if (advanceSchoolRankedRuntime(state, 29_999).result !== null) {
  throw new Error("initial connection grace ended early");
}
const initialForfeit = advanceSchoolRankedRuntime(state, 30_000);
if (initialForfeit.result?.winnerSlot !== 1 || initialForfeit.result?.reason !== "forfeit") {
  throw new Error("initial missing participant did not forfeit after grace");
}

state = baseState();
if (advanceSchoolRankedRuntime(state, 29_999).result !== null) {
  throw new Error("dual initial connection grace ended early");
}
const initialNoContest = advanceSchoolRankedRuntime(state, 30_000);
if (initialNoContest.phase !== "no-contest" || initialNoContest.result?.winnerSlot !== null || initialNoContest.result?.reason !== "infrastructure-failure") {
  throw new Error("dual initial absence did not resolve NO CONTEST after grace");
}

console.log(JSON.stringify({
  ok: true,
  gate: "C4C_RUNTIME_CONTRACT",
  regulation: "PASS",
  overtimeFullDuration: "PASS",
  draw: "PASS",
  disconnectGrace20s: "PASS",
  initialConnectionGrace20s: "PASS",
  dualInitialAbsenceNoContest: "PASS",
}, null, 2));
