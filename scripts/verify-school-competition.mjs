const baseUrl = process.env.SCHOOL_URL ?? "http://127.0.0.1:5173";
const wsBase = baseUrl.replace(/^http/, "ws");

function waitForMessage(client, predicate, label, timeoutMs = 8_000) {
  const existing = client.messages.find(predicate);
  if (existing) return Promise.resolve(existing);
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      client.waiters.delete(waiter);
      reject(new Error(`${label} timeout`));
    }, timeoutMs);
    const waiter = {
      predicate,
      resolve(value) {
        clearTimeout(timer);
        client.waiters.delete(waiter);
        resolve(value);
      },
    };
    client.waiters.add(waiter);
  });
}

function trackedSocket(url, label, onOpen) {
  const socket = new WebSocket(url);
  const client = { socket, messages: [], waiters: new Set(), label };
  socket.addEventListener("message", (event) => {
    if (typeof event.data !== "string") return;
    const value = JSON.parse(event.data);
    client.messages.push(value);
    for (const waiter of [...client.waiters]) {
      if (waiter.predicate(value)) waiter.resolve(value);
    }
  });
  socket.addEventListener("open", () => onOpen?.(socket));
  return client;
}

async function matchmakingClient(label) {
  const client = trackedSocket(`${wsBase}/api/matchmaking/ws`, label, (socket) => {
    socket.send(JSON.stringify({ type: "enqueue", fixedAircraftId: null }));
  });
  const assignmentMessage = await waitForMessage(
    client,
    (message) => message.type === "match_found",
    `${label} match_found`,
  );
  return { client, assignment: assignmentMessage.assignment };
}

const [queued1, queued2] = await Promise.all([
  matchmakingClient("queue1"),
  matchmakingClient("queue2"),
]);
const a = queued1.assignment;
const b = queued2.assignment;
if (a.matchId !== b.matchId) throw new Error("ranked smoke received different match ids");

queued1.client.socket.close(1000, "match found");
queued2.client.socket.close(1000, "match found");

function rankedClient(assignment, label) {
  return trackedSocket(
    `${wsBase}/api/matches/${assignment.matchId}/ws?token=${encodeURIComponent(assignment.joinToken)}`,
    label,
  );
}

const ranked1 = rankedClient(a, "ranked1");
const ranked2 = rankedClient(b, "ranked2");
const [welcome1, welcome2] = await Promise.all([
  waitForMessage(ranked1, (message) => message.type === "welcome", "ranked1 welcome"),
  waitForMessage(ranked2, (message) => message.type === "welcome", "ranked2 welcome"),
]);
if (welcome1.slot === welcome2.slot) throw new Error("ranked participants share the same slot");

const [initial1, initial2] = await Promise.all([
  waitForMessage(ranked1, (message) => message.type === "match_state", "ranked1 initial state"),
  waitForMessage(ranked2, (message) => message.type === "match_state", "ranked2 initial state"),
]);
for (const stateMessage of [initial1, initial2]) {
  if (stateMessage.state.participants.some((participant) => participant.heartPoints !== 100)) {
    throw new Error("ranked match did not initialize at 100 HP");
  }
}

const waitUntilActiveMs = Math.max(0, a.activeAtMs - Date.now() + 120);
if (waitUntilActiveMs > 0) await new Promise((resolve) => setTimeout(resolve, waitUntilActiveMs));

const pose = {
  latitudeDeg: 34.4,
  longitudeDeg: 132.45,
  altitudeM: 2_000,
  orientation: { w: 1, x: 0, y: 0, z: 0 },
  sequence: 0,
  clientTimeMs: performance.now(),
};
ranked1.socket.send(JSON.stringify({ type: "pose", pose }));
ranked2.socket.send(JSON.stringify({ type: "pose", pose: { ...pose, sequence: 1 } }));
await new Promise((resolve) => setTimeout(resolve, 120));

ranked1.socket.send(JSON.stringify({ type: "action", weaponId: "missile", clientTimeMs: performance.now() }));
const missileAccepted = await waitForMessage(
  ranked1,
  (message) => message.type === "action_feedback"
    && message.code === "accepted"
    && message.weaponId === "missile",
  "accepted missile",
);
if (!missileAccepted.accepted) throw new Error("missile was not accepted");

const peerSlot = welcome1.slot === 1 ? 2 : 1;
const missileHpUpdate = await waitForMessage(
  ranked2,
  (message) => message.type === "match_state"
    && message.state.participants.some(
      (participant) => participant.slot === peerSlot && participant.heartPoints === 80,
    ),
  "missile HP update",
);
const afterMissile = missileHpUpdate.state.participants.find((participant) => participant.slot === peerSlot);
if (!afterMissile || afterMissile.heartPoints !== 80) throw new Error("missile did not apply 20 HP effect");

ranked1.socket.send(JSON.stringify({ type: "action", weaponId: "missile", clientTimeMs: performance.now() }));
const missileCooldown = await waitForMessage(
  ranked1,
  (message) => message.type === "action_feedback"
    && message.code === "cooldown"
    && message.weaponId === "missile",
  "missile cooldown rejection",
);
if (missileCooldown.accepted) throw new Error("missile cooldown was bypassed");

ranked1.socket.send(JSON.stringify({ type: "action", weaponId: "gun", clientTimeMs: performance.now() }));
const gunAccepted = await waitForMessage(
  ranked1,
  (message) => message.type === "action_feedback"
    && message.code === "accepted"
    && message.weaponId === "gun",
  "accepted gun",
);
if (!gunAccepted.accepted) throw new Error("gun was not independently ready");

const gunHpUpdate = await waitForMessage(
  ranked2,
  (message) => message.type === "match_state"
    && message.state.participants.some(
      (participant) => participant.slot === peerSlot && participant.heartPoints === 76,
    ),
  "gun HP update",
);
const afterGun = gunHpUpdate.state.participants.find((participant) => participant.slot === peerSlot);
if (!afterGun || afterGun.heartPoints !== 76) throw new Error("gun did not apply 4 HP effect");

ranked1.socket.send(JSON.stringify({ type: "action", weaponId: "gun", clientTimeMs: performance.now() }));
const gunCooldown = await waitForMessage(
  ranked1,
  (message) => message.type === "action_feedback"
    && message.code === "cooldown"
    && message.weaponId === "gun",
  "gun cooldown rejection",
);
if (gunCooldown.accepted) throw new Error("gun cooldown was bypassed");

ranked1.socket.send(JSON.stringify({ type: "leave_match" }));
const forfeit = await waitForMessage(
  ranked2,
  (message) => message.type === "match_state"
    && message.state.phase === "completed"
    && message.state.result?.reason === "forfeit",
  "forfeit result",
);
if (forfeit.state.result.winnerSlot !== welcome2.slot) throw new Error("forfeit winner slot mismatch");

ranked2.socket.close(1000, "verification complete");

console.log(JSON.stringify({
  ok: true,
  gate: "C4C_SCHOOL_COMPETITION_SMOKE",
  matchId: a.matchId,
  startingHp: 100,
  peerHpAfterMissile: afterMissile.heartPoints,
  peerHpAfterGun: afterGun.heartPoints,
  missileCooldownRejected: true,
  gunCooldownRejected: true,
  independentWeaponCooldowns: true,
  forfeitWinnerSlot: welcome2.slot,
}, null, 2));
