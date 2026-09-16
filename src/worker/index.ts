import { AIRCRAFT_CATALOG, isAircraftId } from "../shared/aircraft";
import type { CompetitionRoomInit } from "../shared/competition";
import {
  MATCHMAKING_ASSIGNMENT_REVEAL_MS,
  MATCHMAKING_COUNTDOWN_MS,
  MATCHMAKING_PATH,
  parseClientMatchmakingMessage,
  type ServerMatchmakingMessage,
  type SpawnSide,
} from "../shared/matchmaking";
import {
  generateRoomCode,
  isValidRoomCode,
  MAX_ROOM_PLAYERS,
  parseClientRoomMessage,
  type ServerRoomMessage,
} from "../shared/multiplayer";
import type { D1DatabaseLike } from "./auth/repository";
import { RankedMatch } from "./ranked-match";

export { RankedMatch };

interface DurableObjectId {}

interface DurableObjectStub {
  fetch(request: Request): Promise<Response>;
}

interface DurableObjectNamespace {
  idFromName(name: string): DurableObjectId;
  get(id: DurableObjectId): DurableObjectStub;
}

type HibernatableWebSocket = WebSocket & {
  serializeAttachment(value: unknown): void;
  deserializeAttachment(): unknown;
};

interface DurableObjectState {
  acceptWebSocket(socket: HibernatableWebSocket): void;
  getWebSockets(): HibernatableWebSocket[];
}

declare const WebSocketPair: {
  new (): { 0: HibernatableWebSocket; 1: HibernatableWebSocket };
};

interface Env {
  ASSETS: {
    fetch(request: Request): Promise<Response>;
  };
  ROOMS: DurableObjectNamespace;
  MATCHMAKER: DurableObjectNamespace;
  MATCHES: DurableObjectNamespace;
  ACCOUNTS?: D1DatabaseLike;
}

type SocketAttachment = Readonly<{
  playerId: string;
  slot: 1 | 2;
}>;

type MatchmakingAttachment = Readonly<{
  clientId: string;
  userId: string;
  state: "connected" | "waiting" | "matched" | "cancelled";
  queuedAtMs: number | null;
  fixedAircraftId: string | null;
}>;

const ROOM_SOCKET_ROUTE = /^\/api\/rooms\/([ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{6})\/ws$/;
const RANKED_MATCH_SOCKET_ROUTE = /^\/api\/matches\/([0-9a-f-]{36})\/ws$/i;
const MATCH_INIT_URL = "https://ranked-match.internal/__internal/competition-init";
const AUTHENTICATED_USER_HEADER = "x-cas-user-id";
const FIXED_AIRCRAFT_HEADER = "x-cas-fixed-aircraft-id";

const json = (body: unknown, init: ResponseInit = {}) => {
  const headers = new Headers(init.headers);
  headers.set("cache-control", "no-store");

  return Response.json(body, {
    ...init,
    headers,
  });
};

const encodeRoom = (message: ServerRoomMessage) => JSON.stringify(message);
const encodeMatchmaking = (message: ServerMatchmakingMessage) => JSON.stringify(message);

function attachmentOf(socket: HibernatableWebSocket): SocketAttachment | null {
  const value = socket.deserializeAttachment();
  if (
    typeof value !== "object"
    || value === null
    || !("playerId" in value)
    || !("slot" in value)
    || typeof value.playerId !== "string"
    || (value.slot !== 1 && value.slot !== 2)
  ) {
    return null;
  }
  return { playerId: value.playerId, slot: value.slot };
}

function matchmakingAttachmentOf(socket: HibernatableWebSocket): MatchmakingAttachment | null {
  const value = socket.deserializeAttachment();
  if (
    typeof value !== "object"
    || value === null
    || !("clientId" in value)
    || !("userId" in value)
    || !("state" in value)
    || !("queuedAtMs" in value)
    || !("fixedAircraftId" in value)
    || typeof value.clientId !== "string"
    || typeof value.userId !== "string"
    || value.userId.length < 8
    || !["connected", "waiting", "matched", "cancelled"].includes(String(value.state))
    || (value.queuedAtMs !== null && typeof value.queuedAtMs !== "number")
    || (value.fixedAircraftId !== null && !isAircraftId(value.fixedAircraftId))
  ) {
    return null;
  }
  return value as MatchmakingAttachment;
}

function randomIndex(maxExclusive: number) {
  const values = new Uint32Array(1);
  crypto.getRandomValues(values);
  return values[0] % maxExclusive;
}

function assignedAircraftId(fixedAircraftId: string | null) {
  if (fixedAircraftId && isAircraftId(fixedAircraftId)) return fixedAircraftId;
  return AIRCRAFT_CATALOG[randomIndex(AIRCRAFT_CATALOG.length)].aircraftId;
}

export class RankedMatchmaker {
  constructor(private readonly ctx: DurableObjectState, private readonly env: Env) {}

  private send(socket: HibernatableWebSocket, message: ServerMatchmakingMessage) {
    if (socket.readyState !== WebSocket.OPEN) return;
    try {
      socket.send(encodeMatchmaking(message));
    } catch {
      // The queue client may disappear between selection and send.
    }
  }

  private async initializeMatch(init: CompetitionRoomInit) {
    const id = this.env.MATCHES.idFromName(init.matchId);
    return this.env.MATCHES.get(id).fetch(new Request(MATCH_INIT_URL, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(init),
    }));
  }

  private async tryMatch() {
    const waiting = this.ctx.getWebSockets()
      .filter((socket) => socket.readyState === WebSocket.OPEN)
      .map((socket) => ({ socket, attachment: matchmakingAttachmentOf(socket) }))
      .filter((entry): entry is { socket: HibernatableWebSocket; attachment: MatchmakingAttachment } =>
        entry.attachment !== null && entry.attachment.state === "waiting")
      .sort((a, b) => (a.attachment.queuedAtMs ?? 0) - (b.attachment.queuedAtMs ?? 0));

    while (waiting.length >= 2) {
      const first = waiting.shift();
      if (!first) return;
      const secondIndex = waiting.findIndex((entry) => entry.attachment.userId !== first.attachment.userId);
      if (secondIndex < 0) return;
      const [second] = waiting.splice(secondIndex, 1);
      if (!second) return;

      const matchedAtMs = Date.now();
      const assignmentEndsAtMs = matchedAtMs + MATCHMAKING_ASSIGNMENT_REVEAL_MS;
      const activeAtMs = assignmentEndsAtMs + MATCHMAKING_COUNTDOWN_MS;
      const matchId = crypto.randomUUID();
      const roomCode = generateRoomCode();
      const firstJoinToken = crypto.randomUUID();
      const secondJoinToken = crypto.randomUUID();
      const firstAircraftId = assignedAircraftId(first.attachment.fixedAircraftId);
      const secondAircraftId = assignedAircraftId(second.attachment.fixedAircraftId);
      const firstSide: SpawnSide = randomIndex(2) === 0 ? "left" : "right";
      const secondSide: SpawnSide = firstSide === "left" ? "right" : "left";

      first.socket.serializeAttachment({ ...first.attachment, state: "matched" });
      second.socket.serializeAttachment({ ...second.attachment, state: "matched" });

      const init: CompetitionRoomInit = {
        matchId,
        roomCode,
        activeAtMs,
        participants: [
          {
            slot: 1,
            joinToken: firstJoinToken,
            aircraftId: firstAircraftId,
            spawnSide: firstSide,
            accountUserId: first.attachment.userId,
            randomAssignment: first.attachment.fixedAircraftId === null,
          },
          {
            slot: 2,
            joinToken: secondJoinToken,
            aircraftId: secondAircraftId,
            spawnSide: secondSide,
            accountUserId: second.attachment.userId,
            randomAssignment: second.attachment.fixedAircraftId === null,
          },
        ],
      };
      const initialized = await this.initializeMatch(init);
      if (!initialized.ok) {
        const failure: ServerMatchmakingMessage = {
          type: "error",
          code: "match_init_failed",
          message: "The ranked match authority could not be initialized.",
        };
        this.send(first.socket, failure);
        this.send(second.socket, failure);
        first.socket.close(1011, "match init failed");
        second.socket.close(1011, "match init failed");
        continue;
      }

      this.send(first.socket, {
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
      this.send(second.socket, {
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

  async fetch(request: Request): Promise<Response> {
    if (!this.env.ACCOUNTS) {
      return json({ error: "account_storage_unavailable" }, { status: 503 });
    }
    if (request.headers.get("Upgrade")?.toLowerCase() !== "websocket") {
      return json({ error: "websocket_required" }, { status: 426 });
    }

    const userId = request.headers.get(AUTHENTICATED_USER_HEADER) ?? "";
    const fixedAircraftHeader = request.headers.get(FIXED_AIRCRAFT_HEADER) ?? "";
    if (userId.length < 8) {
      return json({ error: "authenticated_identity_required" }, { status: 401 });
    }
    if (fixedAircraftHeader !== "" && !isAircraftId(fixedAircraftHeader)) {
      return json({ error: "invalid_fixed_aircraft" }, { status: 400 });
    }

    const pair = new WebSocketPair();
    const client = pair[0];
    const server = pair[1];
    const attachment: MatchmakingAttachment = {
      clientId: crypto.randomUUID(),
      userId,
      state: "connected",
      queuedAtMs: null,
      fixedAircraftId: fixedAircraftHeader === "" ? null : fixedAircraftHeader,
    };
    server.serializeAttachment(attachment);
    this.ctx.acceptWebSocket(server);

    const responseInit: ResponseInit & { webSocket: WebSocket } = {
      status: 101,
      webSocket: client,
    };
    return new Response(null, responseInit);
  }

  async webSocketMessage(socket: HibernatableWebSocket, message: string | ArrayBuffer) {
    if (typeof message !== "string") {
      this.send(socket, { type: "error", code: "binary_unsupported", message: "Only bounded JSON text messages are accepted." });
      return;
    }

    const parsed = parseClientMatchmakingMessage(message);
    const attachment = matchmakingAttachmentOf(socket);
    if (!parsed || !attachment) {
      this.send(socket, { type: "error", code: "invalid_message", message: "Matchmaking request failed validation." });
      return;
    }

    if (parsed.type === "cancel") {
      socket.serializeAttachment({ ...attachment, state: "cancelled" });
      socket.close(1000, "queue cancelled");
      return;
    }

    if (attachment.state === "matched") {
      this.send(socket, { type: "error", code: "already_matched", message: "This queue connection already has a match." });
      return;
    }

    const queuedAtMs = Date.now();
    const nextAttachment: MatchmakingAttachment = {
      ...attachment,
      state: "waiting",
      queuedAtMs,
    };
    socket.serializeAttachment(nextAttachment);
    this.send(socket, { type: "queued", queuedAtMs });
    await this.tryMatch();
  }

  webSocketClose() {}
  webSocketError() {}
}

export class MultiplayerRoom {
  constructor(private readonly ctx: DurableObjectState, private readonly env: Env) {
    void env;
  }

  private openSockets(exclude?: HibernatableWebSocket) {
    return this.ctx.getWebSockets().filter(
      (socket) => socket !== exclude && socket.readyState === WebSocket.OPEN,
    );
  }

  private send(socket: HibernatableWebSocket, message: ServerRoomMessage) {
    if (socket.readyState !== WebSocket.OPEN) return;
    try {
      socket.send(encodeRoom(message));
    } catch {
      // A peer may disappear between readyState inspection and send.
    }
  }

  private broadcastPresence(exclude?: HibernatableWebSocket) {
    const sockets = this.openSockets(exclude);
    const message: ServerRoomMessage = {
      type: "presence",
      playerCount: sockets.length,
      peerConnected: sockets.length >= 2,
    };
    for (const socket of sockets) this.send(socket, message);
  }

  async fetch(request: Request): Promise<Response> {
    if (request.headers.get("Upgrade")?.toLowerCase() !== "websocket") {
      return json({ error: "websocket_required" }, { status: 426 });
    }

    const roomCode = new URL(request.url).pathname.match(ROOM_SOCKET_ROUTE)?.[1] ?? "";
    if (!isValidRoomCode(roomCode)) {
      return json({ error: "invalid_room_code" }, { status: 400 });
    }

    const existing = this.openSockets();
    if (existing.length >= MAX_ROOM_PLAYERS) {
      return json({ error: "room_full" }, { status: 409 });
    }

    const pair = new WebSocketPair();
    const client = pair[0];
    const server = pair[1];
    const slot = (existing.length + 1) as 1 | 2;
    const attachment: SocketAttachment = {
      playerId: crypto.randomUUID(),
      slot,
    };

    server.serializeAttachment(attachment);
    this.ctx.acceptWebSocket(server);

    this.send(server, {
      type: "welcome",
      roomCode,
      playerId: attachment.playerId,
      slot,
      peerConnected: existing.length === 1,
    });
    this.broadcastPresence();

    const responseInit: ResponseInit & { webSocket: WebSocket } = {
      status: 101,
      webSocket: client,
    };
    return new Response(null, responseInit);
  }

  webSocketMessage(socket: HibernatableWebSocket, message: string | ArrayBuffer) {
    if (typeof message !== "string") {
      this.send(socket, {
        type: "error",
        code: "binary_unsupported",
        message: "Only bounded JSON text messages are accepted.",
      });
      return;
    }

    const parsed = parseClientRoomMessage(message);
    if (!parsed || parsed.type !== "pose") {
      this.send(socket, {
        type: "error",
        code: "invalid_message",
        message: "Snapshot payload failed protocol validation.",
      });
      return;
    }

    const sender = attachmentOf(socket);
    if (!sender) {
      this.send(socket, {
        type: "error",
        code: "missing_identity",
        message: "Connection identity could not be restored.",
      });
      socket.close(1011, "missing identity");
      return;
    }

    const relay: ServerRoomMessage = {
      type: "peer_pose",
      playerId: sender.playerId,
      serverTimeMs: Date.now(),
      pose: parsed.pose,
    };

    for (const peer of this.openSockets(socket)) this.send(peer, relay);
  }

  webSocketClose(socket: HibernatableWebSocket) {
    this.broadcastPresence(socket);
  }

  webSocketError(socket: HibernatableWebSocket) {
    this.broadcastPresence(socket);
  }
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/api/health") {
      return json({
        ok: true,
        stage: "C0_FOUNDATION",
        service: "cas-flight-simulator",
        features: {
          multiplayer: "C3_FOUNDATION",
          matchmaking: "C4B_FOUNDATION",
          competition: "C4C_FOUNDATION",
        },
        timestamp: new Date().toISOString(),
      });
    }

    if (url.pathname === MATCHMAKING_PATH) {
      const id = env.MATCHMAKER.idFromName("ranked-global-v1");
      return env.MATCHMAKER.get(id).fetch(request);
    }

    const rankedMatch = url.pathname.match(RANKED_MATCH_SOCKET_ROUTE);
    if (rankedMatch) {
      const matchId = rankedMatch[1];
      const id = env.MATCHES.idFromName(matchId);
      return env.MATCHES.get(id).fetch(request);
    }

    const roomMatch = url.pathname.match(ROOM_SOCKET_ROUTE);
    if (roomMatch) {
      const roomCode = roomMatch[1];
      const id = env.ROOMS.idFromName(roomCode);
      return env.ROOMS.get(id).fetch(request);
    }

    if (url.pathname.startsWith("/api/")) {
      return json({ error: "not_found" }, { status: 404 });
    }

    return env.ASSETS.fetch(request);
  },
};
