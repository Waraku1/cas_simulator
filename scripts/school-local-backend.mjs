import { createHash, randomInt, randomUUID } from "node:crypto";
import { createServer } from "node:http";
import aircraftCatalog from "../src/shared/aircraft-catalog.json" with { type: "json" };
import {
  advanceSchoolRankedRuntime,
  advanceSchoolRankedProjectiles,
  createSchoolRankedRuntime,
  forfeitSchoolRanked,
  markSchoolRankedConnected,
  markSchoolRankedDisconnected,
  nextSchoolRankedDeadline,
  resolveSchoolRankedAction,
  schoolRankedSnapshot,
} from "./school-ranked-runtime.mjs";

const HOST = "127.0.0.1";
const PORT = Number(process.env.SCHOOL_BACKEND_PORT ?? 8787);
const ROOM_CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const ROOM_CODE_PATTERN = /^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{6}$/;
const ROOM_SOCKET_ROUTE = /^\/api\/rooms\/([ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{6})\/ws$/;
const RANKED_MATCH_SOCKET_ROUTE = /^\/api\/matches\/([0-9a-f-]{36})\/ws$/i;
const MATCHMAKING_SOCKET_ROUTE = "/api/matchmaking/ws";
const MAX_ROOM_PLAYERS = 2;
const MAX_ROOM_MESSAGE_BYTES = 2_048;
const ASSIGNMENT_REVEAL_MS = 2_500;
const COUNTDOWN_MS = 5_000;
const WEBSOCKET_GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";
const AIRCRAFT_IDS = new Set(aircraftCatalog.map((aircraft) => aircraft.aircraftId));

/** @type {Map<string, Set<any>>} */
const rooms = new Map();
/** @type {Set<any>} */
const matchmakingClients = new Set();
/** @type {Map<string, {state: any, clients: Map<number, any>, timer: NodeJS.Timeout | null}>} */
const rankedMatches = new Map();

function writeJson(response, status, body) {
  const payload = JSON.stringify(body);
  response.writeHead(status, {
    "cache-control": "no-store",
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(payload),
  });
  response.end(payload);
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

function generateRoomCode() {
  let code = "";
  for (let index = 0; index < 6; index += 1) {
    code += ROOM_CODE_ALPHABET[randomInt(ROOM_CODE_ALPHABET.length)];
  }
  return code;
}

function assignedAircraftId(fixedAircraftId) {
  if (typeof fixedAircraftId === "string" && AIRCRAFT_IDS.has(fixedAircraftId)) return fixedAircraftId;
  return aircraftCatalog[randomInt(aircraftCatalog.length)].aircraftId;
}

function broadcastPresence(roomCode) {
  const room = rooms.get(roomCode);
  if (!room) return;
  const open = [...room].filter((client) => !client.closed && !client.socket.destroyed);
  const message = {
    type: "presence",
    playerCount: open.length,
    peerConnected: open.length >= 2,
  };
  for (const client of open) sendJson(client, message);
}

function broadcastRankedPresence(match) {
  const open = [...match.clients.values()].filter((client) => !client.closed && !client.socket.destroyed);
  const message = {
    type: "presence",
    playerCount: open.length,
    peerConnected: open.length >= 2,
  };
  for (const client of open) sendJson(client, message);
}

function broadcastRankedState(match, nowMs = Date.now()) {
  const message = { type: "match_state", state: schoolRankedSnapshot(match.state, nowMs) };
  for (const client of match.clients.values()) sendJson(client, message);
}

function rankedPoseForSlot(match, slot) {
  const client = match.clients.get(slot);
  return client?.latestPose && client.latestPoseReceivedAtMs !== null
    ? { pose: client.latestPose, receivedAtMs: client.latestPoseReceivedAtMs } : null;
}

function scheduleRankedMatch(match) {
  if (match.timer) clearTimeout(match.timer);
  match.timer = null;
  const nowMs = Date.now();
  const deadline = nextSchoolRankedDeadline(match.state, nowMs);
  if (deadline === null) return;
  match.timer = setTimeout(() => {
    const tickNowMs = Date.now();
    updateRankedState(match, match.state, tickNowMs);
  }, Math.max(0, deadline - nowMs));
  match.timer.unref?.();
}

function updateRankedState(match, state, nowMs = Date.now(), broadcast = true) {
  match.state = advanceSchoolRankedRuntime(
    advanceSchoolRankedProjectiles(state, nowMs, (slot) => rankedPoseForSlot(match, slot)), nowMs);
  scheduleRankedMatch(match);
  if (broadcast) broadcastRankedState(match, nowMs);
}

function cleanupClient(client) {
  if (client.closed) return;
  client.closed = true;

  if (client.kind === "room") {
    const room = rooms.get(client.roomCode);
    if (room) {
      room.delete(client);
      if (room.size === 0) rooms.delete(client.roomCode);
    }
    broadcastPresence(client.roomCode);
    return;
  }

  if (client.kind === "ranked") {
    const match = rankedMatches.get(client.matchId);
    if (!match) return;
    if (match.clients.get(client.slot) === client) {
      match.clients.delete(client.slot);
      if (!match.state.result) {
        const nowMs = Date.now();
        updateRankedState(match, markSchoolRankedDisconnected(match.state, client.slot, nowMs), nowMs);
      }
    }
    broadcastRankedPresence(match);
    return;
  }

  matchmakingClients.delete(client);
}

function closeClient(client, code = 1000, reason = "") {
  if (client.closed) return;
  const reasonBytes = Buffer.from(reason).subarray(0, 123);
  const payload = Buffer.alloc(2 + reasonBytes.length);
  payload.writeUInt16BE(code, 0);
  reasonBytes.copy(payload, 2);
  try {
    client.socket.write(encodeFrame(0x8, payload));
  } catch {
    // Socket may already be gone.
  }
  cleanupClient(client);
  client.socket.end();
}

function finite(value) {
  return typeof value === "number" && Number.isFinite(value);
}

function validPoseSnapshot(value) {
  if (typeof value !== "object" || value === null) return false;
  const pose = value;
  const orientation = pose.orientation;
  if (typeof orientation !== "object" || orientation === null) return false;
  if (
    !finite(pose.latitudeDeg) || pose.latitudeDeg < -85 || pose.latitudeDeg > 85
    || !finite(pose.longitudeDeg) || pose.longitudeDeg < -180 || pose.longitudeDeg > 180
    || !finite(pose.altitudeM) || pose.altitudeM < 0 || pose.altitudeM > 20_000
    || !finite(orientation.w) || !finite(orientation.x)
    || !finite(orientation.y) || !finite(orientation.z)
    || !Number.isSafeInteger(pose.sequence) || pose.sequence < 0
    || !finite(pose.clientTimeMs) || pose.clientTimeMs < 0
  ) {
    return false;
  }
  const norm = Math.hypot(orientation.w, orientation.x, orientation.y, orientation.z);
  return norm >= 0.8 && norm <= 1.2;
}

function handleRoomTextMessage(client, payload) {
  let value;
  try {
    value = JSON.parse(payload.toString("utf8"));
  } catch {
    value = null;
  }

  if (
    typeof value !== "object" || value === null
    || value.type !== "pose"
    || !validPoseSnapshot(value.pose)
  ) {
    sendJson(client, {
      type: "error",
      code: "invalid_message",
      message: "Snapshot payload failed protocol validation.",
    });
    return;
  }

  const room = rooms.get(client.roomCode);
  if (!room) return;
  const relay = {
    type: "peer_pose",
    playerId: client.playerId,
    serverTimeMs: Date.now(),
    pose: value.pose,
  };
  for (const peer of room) {
    if (peer !== client) sendJson(peer, relay);
  }
}

function handleRankedTextMessage(client, payload) {
  let value;
  try {
    value = JSON.parse(payload.toString("utf8"));
  } catch {
    value = null;
  }
  if (typeof value !== "object" || value === null || typeof value.type !== "string") {
    sendJson(client, { type: "error", code: "invalid_message", message: "Ranked match payload failed validation." });
    return;
  }

  const match = rankedMatches.get(client.matchId);
  if (!match) {
    sendJson(client, { type: "error", code: "missing_match", message: "Match state is unavailable." });
    return;
  }
  const nowMs = Date.now();
  if (match.state.projectiles?.length) updateRankedState(match, match.state, nowMs);
  else {
    const advanced = advanceSchoolRankedRuntime(match.state, nowMs);
    if (advanced !== match.state) updateRankedState(match, advanced, nowMs);
  }

  if (value.type === "pose" && validPoseSnapshot(value.pose)) {
    client.latestPose = value.pose;
    client.latestPoseReceivedAtMs = nowMs;
    if (match.state.projectiles?.length) updateRankedState(match, match.state, nowMs);
    const peer = match.clients.get(client.slot === 1 ? 2 : 1);
    if (peer) {
      sendJson(peer, {
        type: "peer_pose",
        playerId: client.playerId,
        serverTimeMs: nowMs,
        pose: value.pose,
      });
    }
    return;
  }

  if (value.type === "leave_match") {
    updateRankedState(match, forfeitSchoolRanked(match.state, client.slot, nowMs), nowMs);
    closeClient(client, 1000, "match forfeited");
    return;
  }

  if (value.type === "action" && finite(value.clientTimeMs) && value.clientTimeMs >= 0) {
    const peerSlot = client.slot === 1 ? 2 : 1;
    const peer = match.clients.get(peerSlot);
    const resolution = resolveSchoolRankedAction(
      match.state,
      client.slot,
      nowMs,
      client.latestPose && client.latestPoseReceivedAtMs !== null
        ? { pose: client.latestPose, receivedAtMs: client.latestPoseReceivedAtMs }
        : null,
      peer?.latestPose && peer.latestPoseReceivedAtMs !== null
        ? { pose: peer.latestPose, receivedAtMs: peer.latestPoseReceivedAtMs }
        : null,
      value.weaponId ?? "missile",
    );
    updateRankedState(match, resolution.state, nowMs);
    sendJson(client, {
      type: "action_feedback",
      accepted: resolution.accepted,
      code: resolution.code,
      nextActionAtMs: resolution.nextActionAtMs,
      weaponId: resolution.weaponId,
      locked: resolution.locked,
    });
    return;
  }

  sendJson(client, { type: "error", code: "invalid_message", message: "Ranked match payload failed validation." });
}

function tryMatchmaking() {
  const waiting = [...matchmakingClients]
    .filter((client) => !client.closed && !client.socket.destroyed && client.queueState === "waiting")
    .sort((a, b) => (a.queuedAtMs ?? 0) - (b.queuedAtMs ?? 0));

  while (waiting.length >= 2) {
    const first = waiting.shift();
    const second = waiting.shift();
    if (!first || !second) return;

    first.queueState = "matched";
    second.queueState = "matched";
    const matchedAtMs = Date.now();
    const assignmentEndsAtMs = matchedAtMs + ASSIGNMENT_REVEAL_MS;
    const activeAtMs = assignmentEndsAtMs + COUNTDOWN_MS;
    const matchId = randomUUID();
    const roomCode = generateRoomCode();
    const firstJoinToken = randomUUID();
    const secondJoinToken = randomUUID();
    const firstAircraftId = assignedAircraftId(first.fixedAircraftId);
    const secondAircraftId = assignedAircraftId(second.fixedAircraftId);
    const firstSide = randomInt(2) === 0 ? "left" : "right";
    const secondSide = firstSide === "left" ? "right" : "left";

    const state = createSchoolRankedRuntime({
      matchId,
      roomCode,
      activeAtMs,
      participants: [
        { slot: 1, joinToken: firstJoinToken, aircraftId: firstAircraftId, spawnSide: firstSide },
        { slot: 2, joinToken: secondJoinToken, aircraftId: secondAircraftId, spawnSide: secondSide },
      ],
    });
    const match = { state, clients: new Map(), timer: null };
    rankedMatches.set(matchId, match);
    scheduleRankedMatch(match);

    sendJson(first, {
      type: "match_found",
      assignment: {
        matchId,
        roomCode,
        joinToken: firstJoinToken,
        aircraftId: firstAircraftId,
        peerAircraftId: secondAircraftId,
        spawnSide: firstSide,
        assignmentEndsAtMs,
        activeAtMs,
      },
    });
    sendJson(second, {
      type: "match_found",
      assignment: {
        matchId,
        roomCode,
        joinToken: secondJoinToken,
        aircraftId: secondAircraftId,
        peerAircraftId: firstAircraftId,
        spawnSide: secondSide,
        assignmentEndsAtMs,
        activeAtMs,
      },
    });
  }
}

function handleMatchmakingTextMessage(client, payload) {
  let value;
  try {
    value = JSON.parse(payload.toString("utf8"));
  } catch {
    value = null;
  }

  if (typeof value !== "object" || value === null || typeof value.type !== "string") {
    sendJson(client, { type: "error", code: "invalid_message", message: "Matchmaking request failed validation." });
    return;
  }

  if (value.type === "cancel") {
    client.queueState = "cancelled";
    closeClient(client, 1000, "queue cancelled");
    return;
  }

  if (
    value.type !== "enqueue"
    || (value.fixedAircraftId !== null && (typeof value.fixedAircraftId !== "string" || !AIRCRAFT_IDS.has(value.fixedAircraftId)))
  ) {
    sendJson(client, { type: "error", code: "invalid_message", message: "Matchmaking request failed validation." });
    return;
  }

  if (client.queueState === "matched") {
    sendJson(client, { type: "error", code: "already_matched", message: "This queue connection already has a match." });
    return;
  }

  client.fixedAircraftId = value.fixedAircraftId;
  client.queuedAtMs = Date.now();
  client.queueState = "waiting";
  sendJson(client, { type: "queued", queuedAtMs: client.queuedAtMs });
  tryMatchmaking();
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
      if (bigLength > BigInt(MAX_ROOM_MESSAGE_BYTES + 256)) {
        closeClient(client, 1009, "message too large");
        return;
      }
      length = Number(bigLength);
      offset = 10;
    }

    if (!masked || !fin) {
      closeClient(client, 1003, "unsupported websocket frame");
      return;
    }

    const frameLength = offset + 4 + length;
    if (client.buffer.length < frameLength) return;

    const mask = client.buffer.subarray(offset, offset + 4);
    const payload = Buffer.from(client.buffer.subarray(offset + 4, frameLength));
    for (let index = 0; index < payload.length; index += 1) {
      payload[index] ^= mask[index % 4];
    }
    client.buffer = client.buffer.subarray(frameLength);

    if (opcode === 0x8) {
      closeClient(client, 1000, "peer closed");
      return;
    }
    if (opcode === 0x9) {
      client.socket.write(encodeFrame(0xA, payload));
      continue;
    }
    if (opcode === 0xA) continue;
    if (opcode === 0x2) {
      sendJson(client, {
        type: "error",
        code: "binary_unsupported",
        message: "Only bounded JSON text messages are accepted.",
      });
      continue;
    }
    if (opcode !== 0x1) {
      closeClient(client, 1003, "unsupported websocket opcode");
      return;
    }

    if (payload.length > MAX_ROOM_MESSAGE_BYTES) {
      sendJson(client, { type: "error", code: "invalid_message", message: "Message exceeded the bounded protocol size." });
      continue;
    }

    if (client.kind === "matchmaking") handleMatchmakingTextMessage(client, payload);
    else if (client.kind === "ranked") handleRankedTextMessage(client, payload);
    else handleRoomTextMessage(client, payload);
  }
}

const server = createServer((request, response) => {
  const url = new URL(request.url ?? "/", `http://${request.headers.host ?? `${HOST}:${PORT}`}`);
  if (url.pathname === "/api/health") {
    writeJson(response, 200, {
      ok: true,
      stage: "C0_FOUNDATION",
      service: "cas-flight-simulator",
      features: {
        multiplayer: "C3_FOUNDATION",
        matchmaking: "C4B_FOUNDATION",
        competition: "C4C_FOUNDATION",
      },
      runtime: "SCHOOL_NODE_LOCAL_RELAY",
      timestamp: new Date().toISOString(),
    });
    return;
  }
  if (url.pathname.startsWith("/api/")) {
    writeJson(response, 404, { error: "not_found" });
    return;
  }
  writeJson(response, 404, { error: "not_found" });
});

function acceptUpgrade(request, socket, key) {
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

server.on("upgrade", (request, socket, head) => {
  const url = new URL(request.url ?? "/", `http://${request.headers.host ?? `${HOST}:${PORT}`}`);
  const key = request.headers["sec-websocket-key"];
  const isMatchmaking = url.pathname === MATCHMAKING_SOCKET_ROUTE;
  const rankedMatchId = url.pathname.match(RANKED_MATCH_SOCKET_ROUTE)?.[1] ?? "";
  const isRanked = rankedMatchId.length > 0;
  const roomCode = url.pathname.match(ROOM_SOCKET_ROUTE)?.[1] ?? "";

  if (
    request.headers.upgrade?.toLowerCase() !== "websocket"
    || typeof key !== "string"
    || (!isMatchmaking && !isRanked && !ROOM_CODE_PATTERN.test(roomCode))
  ) {
    rejectUpgrade(socket, "400 Bad Request", "bad_request");
    return;
  }

  if (isMatchmaking) {
    acceptUpgrade(request, socket, key);
    const client = {
      kind: "matchmaking",
      socket,
      clientId: randomUUID(),
      queueState: "connected",
      queuedAtMs: null,
      fixedAircraftId: null,
      buffer: Buffer.alloc(0),
      closed: false,
    };
    matchmakingClients.add(client);
    socket.on("data", (chunk) => consumeFrames(client, chunk));
    socket.on("close", () => cleanupClient(client));
    socket.on("error", () => cleanupClient(client));
    if (head.length > 0) consumeFrames(client, head);
    return;
  }

  if (isRanked) {
    const match = rankedMatches.get(rankedMatchId);
    if (!match) {
      rejectUpgrade(socket, "404 Not Found", "match_not_initialized");
      return;
    }
    const joinToken = url.searchParams.get("token") ?? "";
    const participant = match.state.participants.find((entry) => entry.joinToken === joinToken);
    if (!participant) {
      rejectUpgrade(socket, "403 Forbidden", "invalid_join_token");
      return;
    }

    const existing = match.clients.get(participant.slot);
    if (existing && !existing.closed) closeClient(existing, 4001, "participant reconnected");

    acceptUpgrade(request, socket, key);
    const client = {
      kind: "ranked",
      socket,
      matchId: rankedMatchId,
      roomCode: match.state.roomCode,
      playerId: randomUUID(),
      slot: participant.slot,
      joinToken,
      latestPose: null,
      latestPoseReceivedAtMs: null,
      buffer: Buffer.alloc(0),
      closed: false,
    };
    match.clients.set(participant.slot, client);
    const nowMs = Date.now();
    updateRankedState(match, markSchoolRankedConnected(match.state, participant.slot, nowMs), nowMs, false);

    sendJson(client, {
      type: "welcome",
      roomCode: match.state.roomCode,
      playerId: client.playerId,
      slot: client.slot,
      peerConnected: match.clients.size >= 2,
    });
    broadcastRankedPresence(match);
    broadcastRankedState(match, nowMs);

    socket.on("data", (chunk) => consumeFrames(client, chunk));
    socket.on("close", () => cleanupClient(client));
    socket.on("error", () => cleanupClient(client));
    if (head.length > 0) consumeFrames(client, head);
    return;
  }

  const room = rooms.get(roomCode) ?? new Set();
  for (const client of room) {
    if (client.closed || client.socket.destroyed) room.delete(client);
  }
  if (room.size >= MAX_ROOM_PLAYERS) {
    rejectUpgrade(socket, "409 Conflict", "room_full");
    return;
  }

  acceptUpgrade(request, socket, key);
  const client = {
    kind: "room",
    socket,
    roomCode,
    playerId: randomUUID(),
    slot: /** @type {1 | 2} */ (room.size + 1),
    buffer: Buffer.alloc(0),
    closed: false,
  };
  room.add(client);
  rooms.set(roomCode, room);

  sendJson(client, {
    type: "welcome",
    roomCode,
    playerId: client.playerId,
    slot: client.slot,
    peerConnected: room.size === 2,
  });
  broadcastPresence(roomCode);

  socket.on("data", (chunk) => consumeFrames(client, chunk));
  socket.on("close", () => cleanupClient(client));
  socket.on("error", () => cleanupClient(client));
  if (head.length > 0) consumeFrames(client, head);
});

server.on("error", (error) => {
  console.error(`[school-backend] ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});

server.listen(PORT, HOST, () => {
  console.log(`[school-backend] listening on http://${HOST}:${PORT}`);
});

function shutdown() {
  for (const room of rooms.values()) {
    for (const client of room) closeClient(client, 1001, "server shutdown");
  }
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
