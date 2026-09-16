import { createHash, randomUUID } from "node:crypto";
import { createServer } from "node:http";

const HOST = "127.0.0.1";
const PORT = Number(process.env.SCHOOL_BACKEND_PORT ?? 8787);
const ROOM_CODE_PATTERN = /^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{6}$/;
const ROOM_SOCKET_ROUTE = /^\/api\/rooms\/([ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{6})\/ws$/;
const MAX_ROOM_PLAYERS = 2;
const MAX_ROOM_MESSAGE_BYTES = 2_048;
const WEBSOCKET_GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";

/** @type {Map<string, Set<any>>} */
const rooms = new Map();

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

function cleanupClient(client) {
  if (client.closed) return;
  client.closed = true;
  const room = rooms.get(client.roomCode);
  if (room) {
    room.delete(client);
    if (room.size === 0) rooms.delete(client.roomCode);
  }
  broadcastPresence(client.roomCode);
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

function handleTextMessage(client, payload) {
  if (payload.length > MAX_ROOM_MESSAGE_BYTES) {
    sendJson(client, {
      type: "error",
      code: "invalid_message",
      message: "Snapshot payload failed protocol validation.",
    });
    return;
  }

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

    handleTextMessage(client, payload);
  }
}

const server = createServer((request, response) => {
  const url = new URL(request.url ?? "/", `http://${request.headers.host ?? `${HOST}:${PORT}`}`);
  if (url.pathname === "/api/health") {
    writeJson(response, 200, {
      ok: true,
      stage: "C0_FOUNDATION",
      service: "cas-flight-simulator",
      features: { multiplayer: "C3_FOUNDATION" },
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

server.on("upgrade", (request, socket, head) => {
  const url = new URL(request.url ?? "/", `http://${request.headers.host ?? `${HOST}:${PORT}`}`);
  const roomCode = url.pathname.match(ROOM_SOCKET_ROUTE)?.[1] ?? "";
  const key = request.headers["sec-websocket-key"];

  if (
    request.headers.upgrade?.toLowerCase() !== "websocket"
    || typeof key !== "string"
    || !ROOM_CODE_PATTERN.test(roomCode)
  ) {
    socket.write("HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n");
    socket.destroy();
    return;
  }

  const room = rooms.get(roomCode) ?? new Set();
  for (const client of room) {
    if (client.closed || client.socket.destroyed) room.delete(client);
  }
  if (room.size >= MAX_ROOM_PLAYERS) {
    socket.write("HTTP/1.1 409 Conflict\r\nConnection: close\r\nContent-Type: application/json\r\n\r\n{\"error\":\"room_full\"}");
    socket.destroy();
    return;
  }

  const accept = createHash("sha1").update(key + WEBSOCKET_GUID).digest("base64");
  socket.write([
    "HTTP/1.1 101 Switching Protocols",
    "Upgrade: websocket",
    "Connection: Upgrade",
    `Sec-WebSocket-Accept: ${accept}`,
    "\r\n",
  ].join("\r\n"));

  const client = {
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
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 1_000).unref();
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
