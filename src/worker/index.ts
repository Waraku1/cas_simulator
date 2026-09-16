import {
  isValidRoomCode,
  MAX_ROOM_PLAYERS,
  parseClientRoomMessage,
  type ServerRoomMessage,
} from "../shared/multiplayer";

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
}

type SocketAttachment = Readonly<{
  playerId: string;
  slot: 1 | 2;
}>;

const ROOM_SOCKET_ROUTE = /^\/api\/rooms\/([ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{6})\/ws$/;

const json = (body: unknown, init: ResponseInit = {}) => {
  const headers = new Headers(init.headers);
  headers.set("cache-control", "no-store");

  return Response.json(body, {
    ...init,
    headers,
  });
};

const encode = (message: ServerRoomMessage) => JSON.stringify(message);

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
      socket.send(encode(message));
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
    if (!parsed) {
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
        features: { multiplayer: "C3_FOUNDATION" },
        timestamp: new Date().toISOString(),
      });
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
