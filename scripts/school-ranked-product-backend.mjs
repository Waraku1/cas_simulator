import { createHash, randomInt, randomUUID } from "node:crypto";
import { createServer } from "node:http";
import aircraftCatalog from "../src/shared/aircraft-catalog.json" with { type: "json" };
import {
  advanceSchoolRankedRuntime,
  advanceSchoolRankedProjectiles,
  createSchoolRankedRuntime,
  forfeitSchoolRanked,
  groundContactSchoolRanked,
  markSchoolRankedConnected,
  markSchoolRankedDisconnected,
  nextSchoolRankedDeadline,
  resolveSchoolRankedAction,
  schoolRankedLock,
  schoolRankedSnapshot,
  updateSchoolRankedCapture,
} from "./school-ranked-runtime.mjs";

const HOST = "127.0.0.1";
const PORT = Number(process.env.SCHOOL_PRODUCT_PORT ?? 8789);
const ACCOUNT_ORIGIN = process.env.SCHOOL_ACCOUNT_ORIGIN ?? "http://127.0.0.1:8788";
const INTERNAL_TOKEN = process.env.SCHOOL_INTERNAL_TOKEN ?? "";
const MATCHMAKING_SOCKET_ROUTE = "/api/matchmaking/ws";
const RANKED_MATCH_SOCKET_ROUTE = /^\/api\/matches\/([0-9a-f-]{36})\/ws$/i;
const ASSIGNMENT_REVEAL_MS = 2_500;
const COUNTDOWN_MS = 5_000;
const MAX_MESSAGE_BYTES = 2_048;
const WEBSOCKET_GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";
const ROOM_CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const AIRCRAFT_IDS = new Set(aircraftCatalog.map((aircraft) => aircraft.aircraftId));

if (!INTERNAL_TOKEN) {
  console.error("[school-product] SCHOOL_INTERNAL_TOKEN is required.");
  process.exit(1);
}

/** @type {Set<any>} */
const matchmakingClients = new Set();
/** @type {Map<string, any>} */
const rankedMatches = new Map();
let matching = false;

function writeJson(response, status, body) {
  const payload = JSON.stringify(body);
  response.writeHead(status, {
    "cache-control": "no-store",
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(payload),
  });
  response.end(payload);
}

async function internalRequest(path, body) {
  const response = await fetch(`${ACCOUNT_ORIGIN}${path}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-cas-internal-token": INTERNAL_TOKEN,
    },
    body: JSON.stringify(body),
  });
  let value = null;
  try { value = await response.json(); } catch { value = null; }
  if (!response.ok || !value?.ok) return null;
  return value;
}

async function resolveSession(cookie) {
  if (!cookie) return null;
  const value = await internalRequest("/__internal/session/resolve", { cookie });
  return value?.user ?? null;
}

async function recordAssignment(userId, aircraftId, randomAssignment) {
  return internalRequest("/__internal/assignment", { userId, aircraftId, randomAssignment });
}

async function persistResult(match, nowMs) {
  if (match.resultPersistenceStarted || !match.state.result) return;
  match.resultPersistenceStarted = true;
  const result = match.state.result;
  if (result.reason === "infrastructure-failure") {
    match.resultPersisted = true;
    return;
  }
  const firstOutcome = result.winnerSlot === null ? "draw" : result.winnerSlot === 1 ? "win" : "loss";
  const stored = await internalRequest("/__internal/rated-match", {
    matchId: match.state.matchId,
    firstUserId: match.users[1],
    secondUserId: match.users[2],
    firstOutcome,
    reason: result.reason,
    completedAtMs: nowMs,
  });
  match.resultPersisted = Boolean(stored);
}

function generateRoomCode() {
  let code = "";
  for (let index = 0; index < 6; index += 1) code += ROOM_CODE_ALPHABET[randomInt(ROOM_CODE_ALPHABET.length)];
  return code;
}

function assignedAircraftId(fixedAircraftId) {
  if (typeof fixedAircraftId === "string" && AIRCRAFT_IDS.has(fixedAircraftId)) return fixedAircraftId;
  return aircraftCatalog[randomInt(aircraftCatalog.length)].aircraftId;
}

function encodeFrame(opcode, payload = Buffer.alloc(0)) {
  const length = payload.length;
  let header;
  if (length < 126) {
    header = Buffer.from([0x80 | opcode, length]);
  } else if (length <= 0xffff) {
    header = Buffer.alloc(4);
    header[0] = 0x80 | opcode;
    header[1] = 126;
    header.writeUInt16BE(length, 2);
  } else {
    header = Buffer.alloc(10);
    header[0] = 0x80 | opcode;
    header[1] = 127;
    header.writeBigUInt64BE(BigInt(length), 2);
  }
  return Buffer.concat([header, payload]);
}

function sendJson(client, message) {
  if (client.closed || client.socket.destroyed) return;
  client.socket.write(encodeFrame(0x1, Buffer.from(JSON.stringify(message))));
}

function acceptUpgrade(socket, key) {
  const accept = createHash("sha1").update(key + WEBSOCKET_GUID).digest("base64");
  socket.write([
    "HTTP/1.1 101 Switching Protocols",
    "Upgrade: websocket",
    "Connection: Upgrade",
    `Sec-WebSocket-Accept: ${accept}`,
    "\r\n",
  ].join("\r\n"));
}

function rejectUpgrade(socket, status, message) {
  socket.write(`HTTP/1.1 ${status}\r\nConnection: close\r\nContent-Type: application/json\r\n\r\n${JSON.stringify({ error: message })}`);
  socket.destroy();
}

function broadcastPresence(match) {
  const open = [...match.clients.values()].filter((client) => !client.closed && !client.socket.destroyed);
  const message = { type: "presence", playerCount: open.length, peerConnected: open.length >= 2 };
  for (const client of open) sendJson(client, message);
}

function broadcastState(match, nowMs = Date.now()) {
  const message = { type: "match_state", state: schoolRankedSnapshot(match.state, nowMs) };
  for (const client of match.clients.values()) sendJson(client, message);
}

function rankedPoseForSlot(match, slot) {
  const client = match.clients.get(slot);
  return client?.latestPose && client.latestPoseReceivedAtMs !== null
    ? { pose: client.latestPose, receivedAtMs: client.latestPoseReceivedAtMs } : null;
}

function scheduleMatch(match) {
  if (match.timer) clearTimeout(match.timer);
  match.timer = null;
  const nowMs = Date.now();
  const deadline = nextSchoolRankedDeadline(match.state, nowMs);
  if (deadline === null) return;
  match.timer = setTimeout(() => {
    const tickNow = Date.now();
    updateState(match, match.state, tickNow);
  }, Math.max(0, deadline - nowMs));
  match.timer.unref?.();
}

function updateState(match, state, nowMs = Date.now(), broadcast = true) {
  const timed = advanceSchoolRankedRuntime(state, Math.min(nowMs, state.regulationEndsAtMs));
  match.state = advanceSchoolRankedRuntime(
    advanceSchoolRankedProjectiles(timed, nowMs, (slot) => rankedPoseForSlot(match, slot)), nowMs);
  if (match.state.result) void persistResult(match, nowMs);
  scheduleMatch(match);
  if (broadcast) broadcastState(match, nowMs);
}

function cleanupClient(client) {
  if (client.closed) return;
  client.closed = true;
  if (client.kind === "matchmaking") {
    matchmakingClients.delete(client);
    return;
  }
  const match = rankedMatches.get(client.matchId);
  if (!match) return;
  if (match.clients.get(client.slot) === client) {
    match.clients.delete(client.slot);
    if (!match.state.result) {
      const nowMs = Date.now();
      updateState(match, markSchoolRankedDisconnected(match.state, client.slot, nowMs), nowMs);
    }
  }
  broadcastPresence(match);
}

function closeClient(client, code = 1000, reason = "") {
  if (client.closed) return;
  const reasonBytes = Buffer.from(reason).subarray(0, 123);
  const payload = Buffer.alloc(2 + reasonBytes.length);
  payload.writeUInt16BE(code, 0);
  reasonBytes.copy(payload, 2);
  try { client.socket.write(encodeFrame(0x8, payload)); } catch { /* socket already gone */ }
  cleanupClient(client);
  client.socket.end();
}

function finite(value) {
  return typeof value === "number" && Number.isFinite(value);
}

function validPoseSnapshot(value) {
  if (typeof value !== "object" || value === null || typeof value.orientation !== "object" || value.orientation === null) return false;
  const orientation = value.orientation;
  if (
    !finite(value.latitudeDeg) || value.latitudeDeg < -85 || value.latitudeDeg > 85
    || !finite(value.longitudeDeg) || value.longitudeDeg < -180 || value.longitudeDeg > 180
    || !finite(value.altitudeM) || value.altitudeM < 0 || value.altitudeM > 20_000
    || (value.groundHeightM !== undefined && (!finite(value.groundHeightM)
      || value.groundHeightM < -500 || value.groundHeightM > 9_000))
    || !finite(orientation.w) || !finite(orientation.x) || !finite(orientation.y) || !finite(orientation.z)
    || !Number.isSafeInteger(value.sequence) || value.sequence < 0
    || !finite(value.clientTimeMs) || value.clientTimeMs < 0
  ) return false;
  const norm = Math.hypot(orientation.w, orientation.x, orientation.y, orientation.z);
  return norm >= 0.8 && norm <= 1.2;
}

async function tryMatchmaking() {
  if (matching) return;
  matching = true;
  try {
    const waiting = [...matchmakingClients]
      .filter((client) => !client.closed && !client.socket.destroyed && client.queueState === "waiting")
      .sort((a, b) => (a.queuedAtMs ?? 0) - (b.queuedAtMs ?? 0));

    while (waiting.length >= 2) {
      const first = waiting.shift();
      let secondIndex = waiting.findIndex((candidate) => candidate.user.userId !== first.user.userId);
      if (secondIndex < 0) break;
      const [second] = waiting.splice(secondIndex, 1);
      if (!first || !second) break;

      first.queueState = "matched";
      second.queueState = "matched";
      const matchedAtMs = Date.now();
      const assignmentEndsAtMs = matchedAtMs + ASSIGNMENT_REVEAL_MS;
      const activeAtMs = assignmentEndsAtMs + COUNTDOWN_MS;
      const matchId = randomUUID();
      const roomCode = generateRoomCode();
      const firstJoinToken = randomUUID();
      const secondJoinToken = randomUUID();
      const firstRandom = first.user.fixedAircraftId === null;
      const secondRandom = second.user.fixedAircraftId === null;
      const firstAircraftId = assignedAircraftId(first.user.fixedAircraftId);
      const secondAircraftId = assignedAircraftId(second.user.fixedAircraftId);
      const firstSide = randomInt(2) === 0 ? "left" : "right";
      const secondSide = firstSide === "left" ? "right" : "left";

      await Promise.all([
        recordAssignment(first.user.userId, firstAircraftId, firstRandom),
        recordAssignment(second.user.userId, secondAircraftId, secondRandom),
      ]);

      const state = createSchoolRankedRuntime({
        matchId,
        roomCode,
        activeAtMs,
        participants: [
          { slot: 1, joinToken: firstJoinToken, aircraftId: firstAircraftId, spawnSide: firstSide },
          { slot: 2, joinToken: secondJoinToken, aircraftId: secondAircraftId, spawnSide: secondSide },
        ],
      });
      const match = {
        state,
        clients: new Map(),
        timer: null,
        users: { 1: first.user.userId, 2: second.user.userId },
        participantCookies: { 1: first.cookie, 2: second.cookie },
        resultPersistenceStarted: false,
        resultPersisted: false,
      };
      rankedMatches.set(matchId, match);
      scheduleMatch(match);

      sendJson(first, { type: "match_found", assignment: { matchId, roomCode, joinToken: firstJoinToken, aircraftId: firstAircraftId, peerAircraftId: secondAircraftId, spawnSide: firstSide, assignmentEndsAtMs, activeAtMs } });
      sendJson(second, { type: "match_found", assignment: { matchId, roomCode, joinToken: secondJoinToken, aircraftId: secondAircraftId, peerAircraftId: firstAircraftId, spawnSide: secondSide, assignmentEndsAtMs, activeAtMs } });
    }
  } finally {
    matching = false;
  }
}

function handleMatchmakingMessage(client, payload) {
  let value = null;
  try { value = JSON.parse(payload.toString("utf8")); } catch { value = null; }
  if (typeof value !== "object" || value === null || typeof value.type !== "string") {
    sendJson(client, { type: "error", code: "invalid_message", message: "Matchmaking request failed validation." });
    return;
  }
  if (value.type === "cancel") {
    client.queueState = "cancelled";
    closeClient(client, 1000, "queue cancelled");
    return;
  }
  if (value.type !== "enqueue") {
    sendJson(client, { type: "error", code: "invalid_message", message: "Matchmaking request failed validation." });
    return;
  }
  if (client.queueState === "matched") {
    sendJson(client, { type: "error", code: "already_matched", message: "This queue connection already has a match." });
    return;
  }
  client.queuedAtMs = Date.now();
  client.queueState = "waiting";
  sendJson(client, { type: "queued", queuedAtMs: client.queuedAtMs });
  void tryMatchmaking();
}

function handleRankedMessage(client, payload) {
  let value = null;
  try { value = JSON.parse(payload.toString("utf8")); } catch { value = null; }
  if (typeof value !== "object" || value === null || typeof value.type !== "string") {
    sendJson(client, { type: "error", code: "invalid_message", message: "Ranked match payload failed validation." });
    return;
  }
  const match = rankedMatches.get(client.matchId);
  if (!match) return;
  const nowMs = Date.now();
  if (match.state.projectiles?.length) updateState(match, match.state, nowMs);
  else {
    const advanced = advanceSchoolRankedRuntime(match.state, nowMs);
    if (advanced !== match.state) updateState(match, advanced, nowMs);
  }

  if (value.type === "pose" && validPoseSnapshot(value.pose)) {
    client.latestPose = value.pose;
    client.latestPoseReceivedAtMs = nowMs;
    const grounded = groundContactSchoolRanked(match.state, client.slot, value.pose, nowMs);
    if (grounded !== match.state) updateState(match, grounded, nowMs);
    if (grounded.result) return;
    if (match.state.projectiles?.length) updateState(match, match.state, nowMs);
    const peer = match.clients.get(client.slot === 1 ? 2 : 1);
    for (const [source, target] of [[client, peer], [peer, client]]) {
      if (!source) continue;
      const capture = updateSchoolRankedCapture(source, target, match.state, nowMs);
      if (capture.changed && target) sendJson(target, { type: "lock_alert", sourceSlot: source.slot, locked: capture.locked });
    }
    if (peer) sendJson(peer, { type: "peer_pose", playerId: client.playerId, serverTimeMs: nowMs, pose: value.pose });
    return;
  }
  if (value.type === "leave_match") {
    updateState(match, forfeitSchoolRanked(match.state, client.slot, nowMs), nowMs);
    closeClient(client, 1000, "match forfeited");
    return;
  }
  if (value.type === "action" && finite(value.clientTimeMs) && value.clientTimeMs >= 0) {
    const peer = match.clients.get(client.slot === 1 ? 2 : 1);
    const resolution = resolveSchoolRankedAction(
      match.state,
      client.slot,
      nowMs,
      client.latestPose && client.latestPoseReceivedAtMs !== null ? { pose: client.latestPose, receivedAtMs: client.latestPoseReceivedAtMs } : null,
      peer?.latestPose && peer.latestPoseReceivedAtMs !== null ? { pose: peer.latestPose, receivedAtMs: peer.latestPoseReceivedAtMs } : null,
      value.weaponId ?? "missile",
      schoolRankedLock(client, peer, nowMs),
    );
    updateState(match, resolution.state, nowMs);
    sendJson(client, { type: "action_feedback", accepted: resolution.accepted, code: resolution.code, nextActionAtMs: resolution.nextActionAtMs, weaponId: resolution.weaponId, locked: resolution.locked });
    return;
  }
  sendJson(client, { type: "error", code: "invalid_message", message: "Ranked match payload failed validation." });
}

function consumeFrames(client, chunk) {
  client.buffer = Buffer.concat([client.buffer, chunk]);
  while (client.buffer.length >= 2) {
    const first = client.buffer[0];
    const second = client.buffer[1];
    const fin = (first & 0x80) !== 0;
    const opcode = first & 0x0f;
    const masked = (second & 0x80) !== 0;
    let length = second & 0x7f;
    let offset = 2;
    if (length === 126) {
      if (client.buffer.length < 4) return;
      length = client.buffer.readUInt16BE(2);
      offset = 4;
    } else if (length === 127) {
      if (client.buffer.length < 10) return;
      const bigLength = client.buffer.readBigUInt64BE(2);
      if (bigLength > BigInt(MAX_MESSAGE_BYTES + 256)) { closeClient(client, 1009, "message too large"); return; }
      length = Number(bigLength);
      offset = 10;
    }
    if (!masked || !fin) { closeClient(client, 1003, "unsupported websocket frame"); return; }
    const frameLength = offset + 4 + length;
    if (client.buffer.length < frameLength) return;
    const mask = client.buffer.subarray(offset, offset + 4);
    const payload = Buffer.from(client.buffer.subarray(offset + 4, frameLength));
    for (let index = 0; index < payload.length; index += 1) payload[index] ^= mask[index % 4];
    client.buffer = client.buffer.subarray(frameLength);
    if (opcode === 0x8) { closeClient(client, 1000, "peer closed"); return; }
    if (opcode === 0x9) { client.socket.write(encodeFrame(0xA, payload)); continue; }
    if (opcode === 0xA) continue;
    if (opcode !== 0x1) { closeClient(client, 1003, "unsupported websocket opcode"); return; }
    if (payload.length > MAX_MESSAGE_BYTES) { sendJson(client, { type: "error", code: "invalid_message", message: "Message exceeded the bounded protocol size." }); continue; }
    if (client.kind === "matchmaking") handleMatchmakingMessage(client, payload);
    else handleRankedMessage(client, payload);
  }
}

const server = createServer((request, response) => {
  const url = new URL(request.url ?? "/", `http://${request.headers.host ?? `${HOST}:${PORT}`}`);
  if (url.pathname === "/api/product-health") {
    writeJson(response, 200, { ok: true, runtime: "SCHOOL_AUTHENTICATED_RANKED", matches: rankedMatches.size });
    return;
  }
  writeJson(response, 404, { error: "not_found" });
});

server.on("upgrade", async (request, socket, head) => {
  const url = new URL(request.url ?? "/", `http://${request.headers.host ?? `${HOST}:${PORT}`}`);
  const key = request.headers["sec-websocket-key"];
  const isMatchmaking = url.pathname === MATCHMAKING_SOCKET_ROUTE;
  const matchId = url.pathname.match(RANKED_MATCH_SOCKET_ROUTE)?.[1] ?? "";
  if (request.headers.upgrade?.toLowerCase() !== "websocket" || typeof key !== "string" || (!isMatchmaking && !matchId)) {
    rejectUpgrade(socket, "400 Bad Request", "bad_request");
    return;
  }

  const cookie = request.headers.cookie ?? "";
  const user = await resolveSession(cookie);
  if (!user) {
    rejectUpgrade(socket, "401 Unauthorized", "authentication_required");
    return;
  }

  if (isMatchmaking) {
    acceptUpgrade(socket, key);
    const client = { kind: "matchmaking", socket, user, cookie, clientId: randomUUID(), queueState: "connected", queuedAtMs: null, buffer: Buffer.alloc(0), closed: false };
    matchmakingClients.add(client);
    socket.on("data", (chunk) => consumeFrames(client, chunk));
    socket.on("close", () => cleanupClient(client));
    socket.on("error", () => cleanupClient(client));
    if (head.length > 0) consumeFrames(client, head);
    return;
  }

  const match = rankedMatches.get(matchId);
  if (!match) { rejectUpgrade(socket, "404 Not Found", "match_not_initialized"); return; }
  const joinToken = url.searchParams.get("token") ?? "";
  const participant = match.state.participants.find((entry) => entry.joinToken === joinToken);
  if (!participant || match.users[participant.slot] !== user.userId) {
    rejectUpgrade(socket, "403 Forbidden", "invalid_participant_identity");
    return;
  }
  const existing = match.clients.get(participant.slot);
  if (existing && !existing.closed) closeClient(existing, 4001, "participant reconnected");
  acceptUpgrade(socket, key);
  const client = { kind: "ranked", socket, matchId, playerId: randomUUID(), slot: participant.slot, latestPose: null, latestPoseReceivedAtMs: null, buffer: Buffer.alloc(0), closed: false };
  match.clients.set(participant.slot, client);
  const nowMs = Date.now();
  updateState(match, markSchoolRankedConnected(match.state, participant.slot, nowMs), nowMs, false);
  sendJson(client, { type: "welcome", roomCode: match.state.roomCode, playerId: client.playerId, slot: client.slot, peerConnected: match.clients.size >= 2 });
  broadcastPresence(match);
  broadcastState(match, nowMs);
  socket.on("data", (chunk) => consumeFrames(client, chunk));
  socket.on("close", () => cleanupClient(client));
  socket.on("error", () => cleanupClient(client));
  if (head.length > 0) consumeFrames(client, head);
});

server.on("error", (error) => {
  console.error(`[school-product] ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});

server.listen(PORT, HOST, () => {
  console.log(`[school-product] listening on http://${HOST}:${PORT}`);
});

function shutdown() {
  for (const match of rankedMatches.values()) {
    if (match.timer) clearTimeout(match.timer);
    for (const client of [...match.clients.values()]) closeClient(client, 1001, "server shutdown");
  }
  for (const client of [...matchmakingClients]) closeClient(client, 1001, "server shutdown");
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 1_000).unref();
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
