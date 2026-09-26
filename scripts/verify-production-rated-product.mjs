import { randomBytes } from "node:crypto";
import http from "node:http";
import https from "node:https";

const targetUrl = process.env.PRODUCTION_URL;
if (!targetUrl) throw new Error("PRODUCTION_URL is required");
const baseUrl = new URL(targetUrl);
if (baseUrl.protocol !== "https:" && baseUrl.protocol !== "http:") {
  throw new Error(`Unsupported production URL protocol: ${baseUrl.protocol}`);
}

const runSeed = String(process.env.C4D_SMOKE_RUN_ID ?? Date.now())
  .toLowerCase()
  .replace(/[^a-z0-9]/g, "")
  .slice(-10);
if (!runSeed) throw new Error("C4D_SMOKE_RUN_ID did not contain an alphanumeric suffix");

const LOGIN_A = `c4dpa_${runSeed}`.slice(0, 24);
const LOGIN_B = `c4dpb_${runSeed}`.slice(0, 24);
const PASSWORD = `C4D-Smoke-${runSeed}!`;
const AIRCRAFT_IDS = ["orbit-a1", "strata-b2", "kite-c3"];
const timeoutMs = 8_000;

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function jsonRequest(path, { method = "GET", body, cookie } = {}) {
  const headers = { accept: "application/json" };
  if (body !== undefined) headers["content-type"] = "application/json";
  if (cookie) headers.cookie = cookie;
  const response = await fetch(new URL(path, baseUrl), {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const responseText = await response.text();
  let value = null;
  try { value = responseText ? JSON.parse(responseText) : null; } catch { value = null; }
  return { response, value, responseText };
}

function responseFailureDetail(response, value, responseText) {
  const cfErrorType = response.headers.get("cf-error-type") ?? "none";
  const contentType = response.headers.get("content-type") ?? "none";
  const bodyPreview = value !== null
    ? JSON.stringify(value)
    : String(responseText ?? "").replace(/\s+/g, " ").trim().slice(0, 500);
  return [
    `HTTP ${response.status}`,
    `cf-error-type=${cfErrorType}`,
    `content-type=${contentType}`,
    `body=${bodyPreview || "<empty>"}`,
  ].join(" ");
}

function sessionCookie(setCookie) {
  const match = String(setCookie ?? "").match(/(?:^|,\s*)cas_session=([^;]+)/);
  if (!match) throw new Error("Authentication response did not include cas_session");
  return `cas_session=${match[1]}`;
}

function encodeClientFrame(opcode, payload = Buffer.alloc(0)) {
  const mask = randomBytes(4);
  const length = payload.length;
  let header;
  if (length < 126) {
    header = Buffer.alloc(2);
    header[0] = 0x80 | opcode;
    header[1] = 0x80 | length;
  } else if (length <= 0xffff) {
    header = Buffer.alloc(4);
    header[0] = 0x80 | opcode;
    header[1] = 0x80 | 126;
    header.writeUInt16BE(length, 2);
  } else {
    header = Buffer.alloc(10);
    header[0] = 0x80 | opcode;
    header[1] = 0x80 | 127;
    header.writeBigUInt64BE(BigInt(length), 2);
  }
  const masked = Buffer.alloc(length);
  for (let index = 0; index < length; index += 1) masked[index] = payload[index] ^ mask[index % 4];
  return Buffer.concat([header, mask, masked]);
}

class RawWebSocket {
  constructor(socket, head = Buffer.alloc(0)) {
    this.socket = socket;
    this.buffer = Buffer.from(head);
    this.messages = [];
    this.waiters = new Set();
    this.closed = false;
    socket.on("data", (chunk) => {
      this.buffer = Buffer.concat([this.buffer, chunk]);
      this.consume();
    });
    socket.on("close", () => {
      this.closed = true;
      for (const waiter of this.waiters) {
        clearTimeout(waiter.timer);
        waiter.reject(new Error("WebSocket closed before expected message"));
      }
      this.waiters.clear();
    });
    socket.on("error", (error) => {
      for (const waiter of this.waiters) {
        clearTimeout(waiter.timer);
        waiter.reject(error);
      }
      this.waiters.clear();
    });
    this.consume();
  }

  emit(value) {
    this.messages.push(value);
    for (const waiter of [...this.waiters]) {
      if (!waiter.predicate(value)) continue;
      clearTimeout(waiter.timer);
      this.waiters.delete(waiter);
      waiter.resolve(value);
    }
  }

  consume() {
    while (this.buffer.length >= 2) {
      const first = this.buffer[0];
      const second = this.buffer[1];
      const opcode = first & 0x0f;
      const masked = (second & 0x80) !== 0;
      let length = second & 0x7f;
      let offset = 2;
      if (length === 126) {
        if (this.buffer.length < 4) return;
        length = this.buffer.readUInt16BE(2);
        offset = 4;
      } else if (length === 127) {
        if (this.buffer.length < 10) return;
        length = Number(this.buffer.readBigUInt64BE(2));
        offset = 10;
      }
      const maskBytes = masked ? 4 : 0;
      if (this.buffer.length < offset + maskBytes + length) return;
      const mask = masked ? this.buffer.subarray(offset, offset + 4) : null;
      const payloadStart = offset + maskBytes;
      const payload = Buffer.from(this.buffer.subarray(payloadStart, payloadStart + length));
      if (mask) {
        for (let index = 0; index < payload.length; index += 1) payload[index] ^= mask[index % 4];
      }
      this.buffer = this.buffer.subarray(payloadStart + length);

      if (opcode === 0x1) {
        try { this.emit(JSON.parse(payload.toString("utf8"))); } catch { /* ignore non-JSON */ }
      } else if (opcode === 0x8) {
        this.closed = true;
        this.socket.end();
        return;
      } else if (opcode === 0x9) {
        this.socket.write(encodeClientFrame(0xA, payload));
      }
    }
  }

  send(value) {
    if (this.closed) throw new Error("Cannot send on a closed WebSocket");
    this.socket.write(encodeClientFrame(0x1, Buffer.from(JSON.stringify(value))));
  }

  waitFor(predicate, description, waitMs = timeoutMs) {
    const existing = this.messages.find(predicate);
    if (existing) return Promise.resolve(existing);
    return new Promise((resolve, reject) => {
      const waiter = { predicate, resolve, reject, timer: null };
      waiter.timer = setTimeout(() => {
        this.waiters.delete(waiter);
        reject(new Error(`Timed out waiting for ${description}`));
      }, waitMs);
      this.waiters.add(waiter);
    });
  }

  close() {
    if (this.closed) return;
    this.closed = true;
    try {
      const payload = Buffer.alloc(2);
      payload.writeUInt16BE(1000, 0);
      this.socket.write(encodeClientFrame(0x8, payload));
    } catch { /* socket already unavailable */ }
    this.socket.end();
  }
}

function connectWebSocket(path, cookie) {
  return new Promise((resolve, reject) => {
    const key = randomBytes(16).toString("base64");
    const transport = baseUrl.protocol === "https:" ? https : http;
    const request = transport.request({
      protocol: baseUrl.protocol,
      hostname: baseUrl.hostname,
      port: baseUrl.port || (baseUrl.protocol === "https:" ? 443 : 80),
      path,
      method: "GET",
      headers: {
        host: baseUrl.host,
        connection: "Upgrade",
        upgrade: "websocket",
        "sec-websocket-version": "13",
        "sec-websocket-key": key,
        cookie,
      },
    });
    const timer = setTimeout(() => {
      request.destroy();
      reject(new Error(`WebSocket upgrade timed out: ${path}`));
    }, timeoutMs);
    request.once("upgrade", (response, socket, head) => {
      clearTimeout(timer);
      if (response.statusCode !== 101) {
        socket.destroy();
        reject(new Error(`Unexpected WebSocket status ${response.statusCode}: ${path}`));
        return;
      }
      resolve(new RawWebSocket(socket, head));
    });
    request.once("response", (response) => {
      clearTimeout(timer);
      response.resume();
      reject(new Error(`WebSocket rejected with HTTP ${response.statusCode}: ${path}`));
    });
    request.once("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    request.end();
  });
}

async function register(loginId, label) {
  const { response, value, responseText } = await jsonRequest("/api/auth/register", {
    method: "POST",
    body: { loginId, displayName: `Prod Smoke ${label}`, password: PASSWORD },
  });
  assert(
    response.ok && value?.ok,
    `${label} registration failed: ${responseFailureDetail(response, value, responseText)}`,
  );
  assert(value.user.rating === 1200, `${label} initial rating is not 1200`);
  return { cookie: sessionCookie(response.headers.get("set-cookie")), user: value.user };
}

async function session(cookie) {
  const { response, value } = await jsonRequest("/api/auth/session", { cookie });
  assert(response.ok && value?.ok, `Session refresh failed: HTTP ${response.status}`);
  return value.user;
}

async function queuePair(firstCookie, secondCookie) {
  const [firstSocket, secondSocket] = await Promise.all([
    connectWebSocket("/api/matchmaking/ws", firstCookie),
    connectWebSocket("/api/matchmaking/ws", secondCookie),
  ]);
  firstSocket.send({ type: "enqueue", fixedAircraftId: "orbit-a1" });
  secondSocket.send({ type: "enqueue", fixedAircraftId: "orbit-a1" });
  const [firstFound, secondFound] = await Promise.all([
    firstSocket.waitFor((message) => message.type === "match_found", "first match_found"),
    secondSocket.waitFor((message) => message.type === "match_found", "second match_found"),
  ]);
  return {
    firstSocket,
    secondSocket,
    firstAssignment: firstFound.assignment,
    secondAssignment: secondFound.assignment,
  };
}

async function expectActiveMatchLock(cookie) {
  const socket = await connectWebSocket("/api/matchmaking/ws", cookie);
  socket.send({ type: "enqueue", fixedAircraftId: null });
  const message = await socket.waitFor(
    (entry) => entry.type === "error" && entry.code === "account_in_active_match",
    "account_in_active_match rejection",
  );
  socket.close();
  return message.code === "account_in_active_match";
}

async function waitForFinalizedProfiles(firstCookie, secondCookie, firstAircraftId, secondAircraftId, waitMs = 10_000) {
  const deadline = Date.now() + waitMs;
  while (Date.now() < deadline) {
    const [first, second] = await Promise.all([session(firstCookie), session(secondCookie)]);
    const ratingsApplied = first.rating === 1184 && first.losses === 1
      && second.rating === 1216 && second.wins === 1;
    const fixableApplied = first.fixableAircraftId === firstAircraftId
      && second.fixableAircraftId === secondAircraftId;
    if (ratingsApplied && fixableApplied) return [first, second];
    await new Promise((resolve) => setTimeout(resolve, 125));
  }
  throw new Error("Rated result/fixable-aircraft finalization did not complete before timeout");
}

async function queueAfterLockRelease(firstCookie, secondCookie, waitMs = 10_000) {
  const deadline = Date.now() + waitMs;
  while (Date.now() < deadline) {
    let first = null;
    let second = null;
    try {
      [first, second] = await Promise.all([
        connectWebSocket("/api/matchmaking/ws", firstCookie),
        connectWebSocket("/api/matchmaking/ws", secondCookie),
      ]);
      first.send({ type: "enqueue", fixedAircraftId: null });
      second.send({ type: "enqueue", fixedAircraftId: null });
      const outcome = await Promise.race([
        Promise.all([
          first.waitFor((message) => message.type === "match_found", "rematch first match_found", 2_000),
          second.waitFor((message) => message.type === "match_found", "rematch second match_found", 2_000),
        ]).then(([a, b]) => ({ kind: "matched", a, b })),
        Promise.any([
          first.waitFor((message) => message.type === "error", "rematch first error", 2_000),
          second.waitFor((message) => message.type === "error", "rematch second error", 2_000),
        ]).then((error) => ({ kind: "error", error })),
      ]);
      if (outcome.kind === "matched") {
        return {
          firstSocket: first,
          secondSocket: second,
          firstAssignment: outcome.a.assignment,
          secondAssignment: outcome.b.assignment,
        };
      }
    } catch {
      // The lock may still be reconciling; retry with fresh queue sockets.
    }
    first?.close();
    second?.close();
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error("Active-match lock was not released after authoritative result finalization");
}

const firstAccount = await register(LOGIN_A, "A");
const secondAccount = await register(LOGIN_B, "B");
const firstMatch = await queuePair(firstAccount.cookie, secondAccount.cookie);
const a = firstMatch.firstAssignment;
const b = firstMatch.secondAssignment;

assert(a.matchId === b.matchId, "Matched clients received different match IDs");
assert(a.roomCode === b.roomCode, "Matched clients received different room codes");
assert(AIRCRAFT_IDS.includes(a.aircraftId) && AIRCRAFT_IDS.includes(b.aircraftId), "Invalid aircraft assignment");
assert(await expectActiveMatchLock(firstAccount.cookie), "Active-match lock did not reject duplicate queue entry");

const [afterAssignmentA, afterAssignmentB] = await Promise.all([
  session(firstAccount.cookie),
  session(secondAccount.cookie),
]);
assert(afterAssignmentA.fixedAircraftId === null && afterAssignmentB.fixedAircraftId === null, "Client enqueue value altered fixed-aircraft state");
assert(afterAssignmentA.fixableAircraftId === null && afterAssignmentB.fixableAircraftId === null, "Production random assignment became fixable before completed result");

const [rankedA, rankedB] = await Promise.all([
  connectWebSocket(`/api/matches/${a.matchId}/ws?token=${encodeURIComponent(a.joinToken)}`, firstAccount.cookie),
  connectWebSocket(`/api/matches/${b.matchId}/ws?token=${encodeURIComponent(b.joinToken)}`, secondAccount.cookie),
]);
const [welcomeA, welcomeB] = await Promise.all([
  rankedA.waitFor((message) => message.type === "welcome", "ranked A welcome"),
  rankedB.waitFor((message) => message.type === "welcome", "ranked B welcome"),
]);
assert(welcomeA.slot !== welcomeB.slot, "Ranked participants did not receive distinct slots");
await rankedB.waitFor((message) => message.type === "presence" && message.peerConnected === true, "peer linked");

const smokePose = {
  latitudeDeg: 34.4,
  longitudeDeg: 132.45,
  altitudeM: 2_000,
  orientation: { w: 1, x: 0, y: 0, z: 0 },
};
const smokeTargetPose = {
  ...smokePose,
  longitudeDeg: smokePose.longitudeDeg + 80 / (111_195 * Math.cos(smokePose.latitudeDeg * Math.PI / 180)),
};
const waitUntilActiveMs = Math.max(0, a.activeAtMs - Date.now() + 150);
if (waitUntilActiveMs > 0) await new Promise((resolve) => setTimeout(resolve, waitUntilActiveMs));
// A normal client publishes poses through the countdown. An explicit fresh
// pair here also advances the match if a Durable Object alarm is delayed.
rankedA.send({ type: "pose", pose: { ...smokePose, sequence: 0, clientTimeMs: performance.now() } });
rankedB.send({ type: "pose", pose: { ...smokeTargetPose, sequence: 0, clientTimeMs: performance.now() } });

await Promise.all([
  rankedA.waitFor(
    (message) => message.type === "match_state" && (message.state?.phase === "active" || message.state?.phase === "overtime"),
    "ranked A active state",
    4_000,
  ),
  rankedB.waitFor(
    (message) => message.type === "match_state" && (message.state?.phase === "active" || message.state?.phase === "overtime"),
    "ranked B active state",
    4_000,
  ),
]);

// Keep both samples fresh while the forward, centered view completes the
// same continuous capture interval required of a game client.
for (let sequence = 1; sequence <= 8; sequence += 1) {
  rankedA.send({
    type: "pose",
    pose: {
      ...smokePose,
      sequence,
      clientTimeMs: performance.now(),
      view: { yawRad: 0, pitchRad: 0, weaponId: "missile", looking: false },
    },
  });
  rankedB.send({
    type: "pose",
    pose: { ...smokeTargetPose, sequence, clientTimeMs: performance.now() },
  });
  if (sequence < 8) await new Promise((resolve) => setTimeout(resolve, 200));
}
await rankedB.waitFor(
  (message) => message.type === "lock_alert" && message.sourceSlot === welcomeA.slot && message.locked === true,
  "continuous forward-view MISSILE lock",
  4_000,
);

rankedA.send({ type: "action", weaponId: "missile", clientTimeMs: performance.now() });
const missileAccepted = await rankedA.waitFor(
  (message) => message.type === "action_feedback"
    && message.code === "accepted"
    && message.weaponId === "missile",
  "accepted missile",
  4_000,
);
assert(missileAccepted.accepted === true, "MISSILE request was not accepted");
assert(missileAccepted.locked === true, "MISSILE did not lock on the aimed game target");

const targetSlot = welcomeB.slot;
const inFlightState = await rankedB.waitFor(
  (message) => message.type === "match_state"
    && message.state?.projectiles?.some((projectile) => projectile.weaponId === "missile"),
  "MISSILE in flight",
);
assert(inFlightState.state.participants.find((participant) => participant.slot === targetSlot)?.heartPoints === 100,
  "HP changed before game projectile contact");
const afterMissileState = await rankedB.waitFor(
  (message) => message.type === "match_state"
    && message.state?.participants?.some(
      (participant) => participant.slot === targetSlot && participant.heartPoints === 80,
    ),
  "MISSILE 20 HP effect",
  4_000,
);
const afterMissile = afterMissileState.state.participants.find((participant) => participant.slot === targetSlot);
assert(afterMissile?.heartPoints === 80, "MISSILE did not apply the expected 20 HP effect");

rankedA.send({ type: "action", weaponId: "missile", clientTimeMs: performance.now() });
const missileCooldown = await rankedA.waitFor(
  (message) => message.type === "action_feedback"
    && message.code === "cooldown"
    && message.weaponId === "missile",
  "MISSILE cooldown rejection",
  4_000,
);
assert(missileCooldown.accepted === false, "MISSILE cooldown was bypassed");

rankedA.send({ type: "action", weaponId: "gun", clientTimeMs: performance.now() });
const gunAccepted = await rankedA.waitFor(
  (message) => message.type === "action_feedback"
    && message.code === "accepted"
    && message.weaponId === "gun",
  "accepted GUN",
  4_000,
);
assert(gunAccepted.accepted === true, "GUN was not independently ready while MISSILE was cooling down");

const afterGunState = await rankedB.waitFor(
  (message) => message.type === "match_state"
    && message.state?.participants?.some(
      (participant) => participant.slot === targetSlot && participant.heartPoints === 72,
    ),
  "two-projectile GUN 8 HP effect",
  4_000,
);
const afterGun = afterGunState.state.participants.find((participant) => participant.slot === targetSlot);
assert(afterGun?.heartPoints === 72, "GUN did not apply the expected two-projectile effect");

rankedA.send({ type: "action", weaponId: "gun", clientTimeMs: performance.now() });
const gunCooldown = await rankedA.waitFor(
  (message) => message.type === "action_feedback"
    && message.code === "cooldown"
    && message.weaponId === "gun",
  "GUN cooldown rejection",
  4_000,
);
assert(gunCooldown.accepted === false, "GUN cooldown was bypassed");

rankedA.send({ type: "leave_match" });
const resolved = await rankedB.waitFor(
  (message) => message.type === "match_state" && message.state?.result?.reason === "forfeit",
  "forfeit result",
  6_000,
);
assert(resolved.state.result.winnerSlot !== welcomeA.slot, "Forfeiting participant was incorrectly declared winner");

const [ratedA, ratedB] = await waitForFinalizedProfiles(
  firstAccount.cookie,
  secondAccount.cookie,
  a.aircraftId,
  b.aircraftId,
);

const replay = await connectWebSocket(`/api/matches/${a.matchId}/ws?token=${encodeURIComponent(a.joinToken)}`, firstAccount.cookie);
await replay.waitFor((message) => message.type === "welcome", "replay welcome");
replay.send({ type: "leave_match" });
await new Promise((resolve) => setTimeout(resolve, 300));
const [afterReplayA, afterReplayB] = await Promise.all([session(firstAccount.cookie), session(secondAccount.cookie)]);
assert(afterReplayA.rating === 1184 && afterReplayA.losses === 1, "Rated match was applied more than once to loser");
assert(afterReplayB.rating === 1216 && afterReplayB.wins === 1, "Rated match was applied more than once to winner");
replay.close();

const { response: leaderboardResponse, value: leaderboard } = await jsonRequest("/api/leaderboard");
assert(leaderboardResponse.ok && leaderboard?.ok, "Leaderboard request failed");
const winnerIndex = leaderboard.entries.findIndex((entry) => entry.userId === ratedB.userId);
const loserIndex = leaderboard.entries.findIndex((entry) => entry.userId === ratedA.userId);
assert(winnerIndex >= 0 && loserIndex >= 0 && winnerIndex < loserIndex, "Leaderboard order did not reflect rating result");

for (const [cookie, aircraftId] of [[firstAccount.cookie, a.aircraftId], [secondAccount.cookie, b.aircraftId]]) {
  const fixed = await jsonRequest("/api/account/fixed-aircraft", {
    method: "PUT",
    cookie,
    body: { aircraftId },
  });
  assert(fixed.response.ok && fixed.value?.user?.fixedAircraftId === aircraftId, "Fixable aircraft persistence failed");
}

firstMatch.firstSocket.close();
firstMatch.secondSocket.close();
rankedA.close();
rankedB.close();

const rematch = await queueAfterLockRelease(firstAccount.cookie, secondAccount.cookie);
assert(rematch.firstAssignment.aircraftId === a.aircraftId, "First fixed aircraft was not honored after lock release");
assert(rematch.secondAssignment.aircraftId === b.aircraftId, "Second fixed aircraft was not honored after lock release");
rematch.firstSocket.close();
rematch.secondSocket.close();

console.log(JSON.stringify({
  ok: true,
  gate: "C4D_PRODUCTION_RATED_PRODUCT_SMOKE",
  runSeed,
  loginIds: [LOGIN_A, LOGIN_B],
  matchId: a.matchId,
  result: "FORFEIT",
  loserRating: ratedA.rating,
  winnerRating: ratedB.rating,
  loserLosses: ratedA.losses,
  winnerWins: ratedB.wins,
  activeMatchDuplicateRejected: true,
  activeMatchLockReleased: true,
  leaderboardWinnerAboveLoser: true,
  fixableAssignmentPersistedAfterResult: true,
  fixedAircraftRematchPersisted: true,
  duplicateResultIgnored: true,
  missileAccepted: true,
  missileHpEffect: 20,
  missileCooldownRejected: true,
  gunAcceptedDuringMissileCooldown: true,
  gunHpEffect: 8,
  gunCooldownRejected: true,
  independentWeaponCooldowns: true,
}, null, 2));
