import { randomBytes } from "node:crypto";
import http from "node:http";

const baseUrl = new URL(process.env.SCHOOL_URL ?? "http://127.0.0.1:5173");
const AIRCRAFT_IDS = ["orbit-a1", "strata-b2", "kite-c3"];
const PASSWORD = "SchoolC4D-2026!";

if (baseUrl.protocol !== "http:") {
  throw new Error("C4D school smoke expects the localhost HTTP development origin.");
}

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
  let value = null;
  try { value = await response.json(); } catch { value = null; }
  return { response, value };
}

function sessionCookie(setCookie) {
  const match = String(setCookie ?? "").match(/(?:^|,\s*)cas_session=([^;]+)/);
  if (!match) throw new Error("Registration response did not include cas_session.");
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
        waiter.reject(new Error("WebSocket closed before expected message."));
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
        try { this.emit(JSON.parse(payload.toString("utf8"))); } catch { /* ignore non-JSON text */ }
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
    if (this.closed) throw new Error("Cannot send on a closed WebSocket.");
    this.socket.write(encodeClientFrame(0x1, Buffer.from(JSON.stringify(value))));
  }

  waitFor(predicate, timeoutMs = 6_000) {
    const existing = this.messages.find(predicate);
    if (existing) return Promise.resolve(existing);
    return new Promise((resolve, reject) => {
      const waiter = { predicate, resolve, reject, timer: null };
      waiter.timer = setTimeout(() => {
        this.waiters.delete(waiter);
        reject(new Error("Timed out waiting for WebSocket message."));
      }, timeoutMs);
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
    } catch { /* socket already closed */ }
    this.socket.end();
  }
}

function connectWebSocket(path, cookie) {
  return new Promise((resolve, reject) => {
    const key = randomBytes(16).toString("base64");
    const request = http.request({
      hostname: baseUrl.hostname,
      port: Number(baseUrl.port || 80),
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
    const timeout = setTimeout(() => {
      request.destroy();
      reject(new Error(`WebSocket upgrade timed out: ${path}`));
    }, 6_000);
    request.once("upgrade", (response, socket, head) => {
      clearTimeout(timeout);
      if (response.statusCode !== 101) {
        socket.destroy();
        reject(new Error(`Unexpected WebSocket status ${response.statusCode}: ${path}`));
        return;
      }
      resolve(new RawWebSocket(socket, head));
    });
    request.once("response", (response) => {
      clearTimeout(timeout);
      response.resume();
      reject(new Error(`WebSocket rejected with HTTP ${response.statusCode}: ${path}`));
    });
    request.once("error", (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    request.end();
  });
}

async function register(label) {
  const suffix = randomBytes(4).toString("hex");
  const loginId = `c4d_${label}_${suffix}`;
  const { response, value } = await jsonRequest("/api/auth/register", {
    method: "POST",
    body: { loginId, displayName: `C4D ${label.toUpperCase()}`, password: PASSWORD },
  });
  assert(response.ok && value?.ok, `${label} registration failed`);
  assert(value.user.rating === 1200, `${label} initial rating is not 1200`);
  return { cookie: sessionCookie(response.headers.get("set-cookie")), user: value.user };
}

async function session(cookie) {
  const { response, value } = await jsonRequest("/api/auth/session", { cookie });
  assert(response.ok && value?.ok, "Session refresh failed");
  return value.user;
}

async function waitForRatings(firstCookie, secondCookie, timeoutMs = 4_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const [first, second] = await Promise.all([session(firstCookie), session(secondCookie)]);
    if (first.rating !== 1200 || second.rating !== 1200) return [first, second];
    await new Promise((resolve) => setTimeout(resolve, 75));
  }
  throw new Error("Rated result was not persisted before timeout.");
}

async function queuePair(firstCookie, secondCookie) {
  const [firstSocket, secondSocket] = await Promise.all([
    connectWebSocket("/api/matchmaking/ws", firstCookie),
    connectWebSocket("/api/matchmaking/ws", secondCookie),
  ]);
  firstSocket.send({ type: "enqueue", fixedAircraftId: "orbit-a1" });
  secondSocket.send({ type: "enqueue", fixedAircraftId: "orbit-a1" });
  const [firstFound, secondFound] = await Promise.all([
    firstSocket.waitFor((message) => message.type === "match_found"),
    secondSocket.waitFor((message) => message.type === "match_found"),
  ]);
  return {
    firstSocket,
    secondSocket,
    firstAssignment: firstFound.assignment,
    secondAssignment: secondFound.assignment,
  };
}

const firstAccount = await register("a");
const secondAccount = await register("b");
const firstMatch = await queuePair(firstAccount.cookie, secondAccount.cookie);
const a = firstMatch.firstAssignment;
const b = firstMatch.secondAssignment;

assert(a.matchId === b.matchId, "Matched clients received different match IDs");
assert(a.roomCode === b.roomCode, "Matched clients received different room codes");
assert(AIRCRAFT_IDS.includes(a.aircraftId) && AIRCRAFT_IDS.includes(b.aircraftId), "Invalid aircraft assignment");

const [afterAssignmentA, afterAssignmentB] = await Promise.all([
  session(firstAccount.cookie),
  session(secondAccount.cookie),
]);
assert(afterAssignmentA.fixedAircraftId === null && afterAssignmentB.fixedAircraftId === null, "Client enqueue value altered server fixed-aircraft state");
assert(afterAssignmentA.fixableAircraftId === a.aircraftId, "First random aircraft was not recorded as fixable");
assert(afterAssignmentB.fixableAircraftId === b.aircraftId, "Second random aircraft was not recorded as fixable");

const [rankedA, rankedB] = await Promise.all([
  connectWebSocket(`/api/matches/${a.matchId}/ws?token=${encodeURIComponent(a.joinToken)}`, firstAccount.cookie),
  connectWebSocket(`/api/matches/${b.matchId}/ws?token=${encodeURIComponent(b.joinToken)}`, secondAccount.cookie),
]);
const [welcomeA, welcomeB] = await Promise.all([
  rankedA.waitFor((message) => message.type === "welcome"),
  rankedB.waitFor((message) => message.type === "welcome"),
]);
assert(welcomeA.slot !== welcomeB.slot, "Ranked participants did not receive distinct slots");
await rankedB.waitFor((message) => message.type === "presence" && message.peerConnected === true);

rankedA.send({ type: "leave_match" });
const resolved = await rankedB.waitFor(
  (message) => message.type === "match_state" && message.state?.result?.reason === "forfeit",
  4_000,
);
assert(resolved.state.result.winnerSlot !== welcomeA.slot, "Forfeiting participant was incorrectly declared winner");

const [ratedA, ratedB] = await waitForRatings(firstAccount.cookie, secondAccount.cookie);
assert(ratedA.rating === 1184 && ratedA.losses === 1 && ratedA.wins === 0, "Forfeit loser rating/W-L was not applied exactly once");
assert(ratedB.rating === 1216 && ratedB.wins === 1 && ratedB.losses === 0, "Forfeit winner rating/W-L was not applied exactly once");

const replay = await connectWebSocket(`/api/matches/${a.matchId}/ws?token=${encodeURIComponent(a.joinToken)}`, firstAccount.cookie);
await replay.waitFor((message) => message.type === "welcome");
replay.send({ type: "leave_match" });
await new Promise((resolve) => setTimeout(resolve, 200));
const [afterReplayA, afterReplayB] = await Promise.all([session(firstAccount.cookie), session(secondAccount.cookie)]);
assert(afterReplayA.rating === 1184 && afterReplayA.losses === 1, "Rated match was applied more than once to loser");
assert(afterReplayB.rating === 1216 && afterReplayB.wins === 1, "Rated match was applied more than once to winner");
replay.close();

const { response: leaderboardResponse, value: leaderboard } = await jsonRequest("/api/leaderboard");
assert(leaderboardResponse.ok && leaderboard?.ok, "Leaderboard request failed");
const winnerIndex = leaderboard.entries.findIndex((entry) => entry.userId === ratedB.userId);
const loserIndex = leaderboard.entries.findIndex((entry) => entry.userId === ratedA.userId);
assert(winnerIndex >= 0 && loserIndex >= 0 && winnerIndex < loserIndex, "Leaderboard order did not reflect rating result");

const wrongAircraft = AIRCRAFT_IDS.find((aircraftId) => aircraftId !== a.aircraftId);
const wrongFix = await jsonRequest("/api/account/fixed-aircraft", {
  method: "PUT",
  cookie: firstAccount.cookie,
  body: { aircraftId: wrongAircraft },
});
assert(wrongFix.response.status === 409, "Non-fixable aircraft was accepted");

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

const fixedMatch = await queuePair(firstAccount.cookie, secondAccount.cookie);
assert(fixedMatch.firstAssignment.aircraftId === a.aircraftId, "First fixed aircraft was not honored by server matchmaking");
assert(fixedMatch.secondAssignment.aircraftId === b.aircraftId, "Second fixed aircraft was not honored by server matchmaking");
fixedMatch.firstSocket.close();
fixedMatch.secondSocket.close();

console.log(JSON.stringify({
  ok: true,
  gate: "C4D_AUTHENTICATED_RATED_PRODUCT_SMOKE",
  matchId: a.matchId,
  result: "FORFEIT",
  loserRating: ratedA.rating,
  winnerRating: ratedB.rating,
  loserLosses: ratedA.losses,
  winnerWins: ratedB.wins,
  leaderboardWinnerAboveLoser: true,
  fixableAssignmentPersisted: true,
  fixedAircraftRematchPersisted: true,
  duplicateResultIgnored: true,
}, null, 2));