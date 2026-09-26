import { isAircraftId } from "../shared/aircraft";
import { ARCADE_LOCK, gameCaptureAvailable } from "../shared/arcade-projectiles.mjs";
import type { CompetitionRoomInit, CompetitionSlot } from "../shared/competition";
import {
  isValidRoomCode,
  parseClientRoomMessage,
  type PoseSnapshot,
  type ServerRoomMessage,
} from "../shared/multiplayer";
import { D1AuthRepository, type D1DatabaseLike } from "./auth/repository";
import {
  advanceCompetitionRuntime,
  advanceCompetitionProjectiles,
  competitionSnapshot,
  createCompetitionRuntime,
  forfeitCompetition,
  groundContactCompetition,
  markCompetitionConnected,
  markCompetitionDisconnected,
  nextCompetitionDeadline,
  resolveCompetitionAction,
  type ServerPoseSample,
  type StoredCompetitionRuntime,
} from "./competition-runtime";
import { D1RatingRepository } from "./rating/repository";
import { weaponById } from "../shared/weapons";

interface DurableObjectStorage {
  get<T>(key: string): Promise<T | undefined>;
  put(key: string, value: unknown): Promise<void>;
  setAlarm(scheduledTime: number): Promise<void>;
  deleteAlarm(): Promise<void>;
}

interface DurableObjectState {
  storage: DurableObjectStorage;
  acceptWebSocket(socket: HibernatableWebSocket): void;
  getWebSockets(): HibernatableWebSocket[];
}

type HibernatableWebSocket = WebSocket & {
  serializeAttachment(value: unknown): void;
  deserializeAttachment(): unknown;
};

declare const WebSocketPair: {
  new (): { 0: HibernatableWebSocket; 1: HibernatableWebSocket };
};

type RankedSocketAttachment = Readonly<{
  playerId: string;
  slot: CompetitionSlot;
  joinToken: string;
  latestPose: PoseSnapshot | null;
  latestPoseReceivedAtMs: number | null;
  captureStartedAtMs?: number | null;
  captureLastAtMs?: number | null;
  lockNotified?: boolean;
}>;

type RankedMatchEnv = Readonly<{
  ACCOUNTS?: D1DatabaseLike;
}>;

const STORAGE_KEY = "competition-runtime-v1";
const RATING_FINALIZED_KEY = "rating-finalized-v1";
const RATING_RETRY_MS = 5_000;
const INIT_PATH = "/__internal/competition-init";

const json = (body: unknown, init: ResponseInit = {}) => {
  const headers = new Headers(init.headers);
  headers.set("cache-control", "no-store");
  return Response.json(body, { ...init, headers });
};

function attachmentOf(socket: HibernatableWebSocket): RankedSocketAttachment | null {
  const value = socket.deserializeAttachment();
  if (
    typeof value !== "object"
    || value === null
    || !("playerId" in value)
    || !("slot" in value)
    || !("joinToken" in value)
    || !("latestPose" in value)
    || !("latestPoseReceivedAtMs" in value)
    || typeof value.playerId !== "string"
    || (value.slot !== 1 && value.slot !== 2)
    || typeof value.joinToken !== "string"
  ) {
    return null;
  }
  return value as RankedSocketAttachment;
}

function validAccountUserId(value: unknown) {
  return typeof value === "string" && value.length >= 8 && value.length <= 128;
}

function validInit(value: unknown): value is CompetitionRoomInit {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Partial<CompetitionRoomInit>;
  if (
    typeof candidate.matchId !== "string"
    || candidate.matchId.length < 8
    || typeof candidate.roomCode !== "string"
    || !isValidRoomCode(candidate.roomCode)
    || typeof candidate.activeAtMs !== "number"
    || !Number.isFinite(candidate.activeAtMs)
    || !Array.isArray(candidate.participants)
    || candidate.participants.length !== 2
  ) {
    return false;
  }

  const [first, second] = candidate.participants;
  const legacyIdentity = first.accountUserId === undefined
    && second.accountUserId === undefined
    && first.randomAssignment === undefined
    && second.randomAssignment === undefined;
  const ratedIdentity = validAccountUserId(first.accountUserId)
    && validAccountUserId(second.accountUserId)
    && first.accountUserId !== second.accountUserId
    && typeof first.randomAssignment === "boolean"
    && typeof second.randomAssignment === "boolean";

  return first.slot === 1
    && second.slot === 2
    && typeof first.joinToken === "string"
    && first.joinToken.length >= 16
    && typeof second.joinToken === "string"
    && second.joinToken.length >= 16
    && isAircraftId(first.aircraftId)
    && isAircraftId(second.aircraftId)
    && (first.spawnSide === "left" || first.spawnSide === "right")
    && (second.spawnSide === "left" || second.spawnSide === "right")
    && first.spawnSide !== second.spawnSide
    && (legacyIdentity || ratedIdentity);
}

export class RankedMatch {
  constructor(
    private readonly ctx: DurableObjectState,
    private readonly env: RankedMatchEnv,
  ) {}

  private openSockets(exclude?: HibernatableWebSocket) {
    return this.ctx.getWebSockets().filter(
      (socket) => socket !== exclude && socket.readyState === WebSocket.OPEN,
    );
  }

  private send(socket: HibernatableWebSocket, message: ServerRoomMessage) {
    if (socket.readyState !== WebSocket.OPEN) return;
    try {
      socket.send(JSON.stringify(message));
    } catch {
      // A browser may disappear between readyState inspection and send.
    }
  }

  private async loadState() {
    return (await this.ctx.storage.get<StoredCompetitionRuntime>(STORAGE_KEY)) ?? null;
  }

  private async saveState(state: StoredCompetitionRuntime) {
    await this.ctx.storage.put(STORAGE_KEY, state);
  }

  private async finalizeResult(state: StoredCompetitionRuntime, nowMs: number) {
    if (!state.result) return true;
    if (await this.ctx.storage.get<boolean>(RATING_FINALIZED_KEY)) return true;

    const [first, second] = state.participants;
    const firstUserId = first.accountUserId;
    const secondUserId = second.accountUserId;

    if (firstUserId === null && secondUserId === null) {
      // Legacy C4C matches remain valid but intentionally unrated.
      await this.ctx.storage.put(RATING_FINALIZED_KEY, true);
      return true;
    }

    if (!firstUserId || !secondUserId || firstUserId === secondUserId || !this.env.ACCOUNTS) {
      return false;
    }

    if (state.result.reason === "infrastructure-failure") {
      // NO CONTEST is deliberately account-neutral.
      await this.ctx.storage.put(RATING_FINALIZED_KEY, true);
      return true;
    }

    const firstOutcome = state.result.winnerSlot === null
      ? "draw"
      : state.result.winnerSlot === 1
        ? "win"
        : "loss";

    try {
      await new D1RatingRepository(this.env.ACCOUNTS).applyMatch({
        matchId: state.matchId,
        firstUserId,
        secondUserId,
        firstOutcome,
        reason: state.result.reason,
        completedAtMs: nowMs,
      });

      const accounts = new D1AuthRepository(this.env.ACCOUNTS);
      const fixableUpdates: Promise<void>[] = [];
      if (first.randomAssignment) {
        fixableUpdates.push(accounts.updateFixableAircraft(firstUserId, first.aircraftId, nowMs));
      }
      if (second.randomAssignment) {
        fixableUpdates.push(accounts.updateFixableAircraft(secondUserId, second.aircraftId, nowMs));
      }
      await Promise.all(fixableUpdates);

      await this.ctx.storage.put(RATING_FINALIZED_KEY, true);
      return true;
    } catch (error) {
      console.error(
        `[ranked-match] account finalization failed for ${state.matchId}: ${error instanceof Error ? error.message : String(error)}`,
      );
      return false;
    }
  }

  private async schedule(state: StoredCompetitionRuntime, nowMs: number) {
    if (state.result) {
      const finalized = await this.finalizeResult(state, nowMs);
      if (finalized) {
        await this.ctx.storage.deleteAlarm();
      } else {
        await this.ctx.storage.setAlarm(nowMs + RATING_RETRY_MS);
      }
      return;
    }

    const deadline = nextCompetitionDeadline(state, nowMs);
    if (deadline === null) {
      await this.ctx.storage.deleteAlarm();
      return;
    }
    await this.ctx.storage.setAlarm(deadline);
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

  private broadcastMatchState(state: StoredCompetitionRuntime, nowMs: number) {
    const message: ServerRoomMessage = {
      type: "match_state",
      state: competitionSnapshot(state, nowMs),
    };
    for (const socket of this.openSockets()) this.send(socket, message);
  }

  private socketForSlot(slot: CompetitionSlot, exclude?: HibernatableWebSocket) {
    return this.openSockets(exclude).find((socket) => attachmentOf(socket)?.slot === slot) ?? null;
  }

  private poseForSlot(slot: CompetitionSlot): ServerPoseSample | null {
    const socket = this.socketForSlot(slot);
    if (!socket) return null;
    const attachment = attachmentOf(socket);
    if (!attachment?.latestPose || attachment.latestPoseReceivedAtMs === null) return null;
    return {
      pose: attachment.latestPose,
      receivedAtMs: attachment.latestPoseReceivedAtMs,
    };
  }

  private updateCaptureForSlot(slot: CompetitionSlot, state: StoredCompetitionRuntime, nowMs: number) {
    const socket = this.socketForSlot(slot);
    if (!socket) return;
    const attachment = attachmentOf(socket);
    if (!attachment) return;
    const own = this.poseForSlot(slot);
    const otherSlot = slot === 1 ? 2 : 1;
    const peer = this.poseForSlot(otherSlot);
    const range = weaponById("missile")?.activationRadiusM ?? 0;
    const capturing = (state.phase === "active" || state.phase === "overtime")
      && state.participants.every((participant) => participant.connected)
      && own !== null && peer !== null
      && own.pose.view?.weaponId === "missile"
      && nowMs - own.receivedAtMs <= ARCADE_LOCK.sampleGapMs
      && nowMs - peer.receivedAtMs <= ARCADE_LOCK.sampleGapMs
      && gameCaptureAvailable(own.pose, peer.pose, range);
    const continuous = capturing && attachment.captureLastAtMs !== null
      && attachment.captureLastAtMs !== undefined
      && nowMs - attachment.captureLastAtMs <= ARCADE_LOCK.sampleGapMs;
    const startedAtMs = capturing
      ? continuous ? attachment.captureStartedAtMs ?? nowMs : nowMs
      : null;
    const locked = startedAtMs !== null && nowMs - startedAtMs >= ARCADE_LOCK.holdMs;
    socket.serializeAttachment({
      ...attachment,
      captureStartedAtMs: startedAtMs,
      captureLastAtMs: capturing ? nowMs : null,
      lockNotified: locked,
    } satisfies RankedSocketAttachment);
    if (Boolean(attachment.lockNotified) !== locked) {
      const peerSocket = this.socketForSlot(otherSlot);
      if (peerSocket) this.send(peerSocket, { type: "lock_alert", sourceSlot: slot, locked });
    }
  }

  private lockForSlot(slot: CompetitionSlot, nowMs: number) {
    const own = this.poseForSlot(slot);
    // Older pose clients retain the existing instantaneous arcade rule.
    if (!own?.pose.view) return false;
    const peer = this.poseForSlot(slot === 1 ? 2 : 1);
    const attachment = this.socketForSlot(slot);
    const capture = attachment ? attachmentOf(attachment) : null;
    const range = weaponById("missile")?.activationRadiusM ?? 0;
    return Boolean(
      peer && capture?.captureStartedAtMs !== null
      && capture?.captureStartedAtMs !== undefined
      && capture.captureLastAtMs !== null && capture.captureLastAtMs !== undefined
      && nowMs - own.receivedAtMs <= ARCADE_LOCK.sampleGapMs
      && nowMs - peer.receivedAtMs <= ARCADE_LOCK.sampleGapMs
      && nowMs - capture.captureLastAtMs <= ARCADE_LOCK.sampleGapMs
      && nowMs - capture.captureStartedAtMs >= ARCADE_LOCK.holdMs
      && own.pose.view.weaponId === "missile"
      && gameCaptureAvailable(own.pose, peer.pose, range),
    );
  }

  private async persist(state: StoredCompetitionRuntime, nowMs: number, broadcast = true) {
    const moved = advanceCompetitionProjectiles(state, nowMs, (slot) => this.poseForSlot(slot));
    const advanced = advanceCompetitionRuntime(moved, nowMs);
    await this.saveState(advanced);
    await this.schedule(advanced, nowMs);
    if (broadcast) this.broadcastMatchState(advanced, nowMs);
    return advanced;
  }

  private async initialize(request: Request) {
    let value: unknown;
    try {
      value = await request.json();
    } catch {
      return json({ error: "invalid_match_init" }, { status: 400 });
    }
    if (!validInit(value)) return json({ error: "invalid_match_init" }, { status: 400 });

    const existing = await this.loadState();
    if (existing) {
      if (existing.matchId === value.matchId) return json({ ok: true, idempotent: true });
      return json({ error: "match_already_initialized" }, { status: 409 });
    }

    const nowMs = Date.now();
    const state = createCompetitionRuntime(value);
    await this.saveState(state);
    await this.schedule(state, nowMs);
    return json({ ok: true, matchId: state.matchId });
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === INIT_PATH && request.method === "POST") return this.initialize(request);

    if (request.headers.get("Upgrade")?.toLowerCase() !== "websocket") {
      return json({ error: "websocket_required" }, { status: 426 });
    }

    let state = await this.loadState();
    if (!state) return json({ error: "match_not_initialized" }, { status: 404 });

    const joinToken = url.searchParams.get("token") ?? "";
    const participant = state.participants.find((entry) => entry.joinToken === joinToken);
    if (!participant) return json({ error: "invalid_join_token" }, { status: 403 });

    if (participant.accountUserId !== null) {
      const authenticatedUserId = request.headers.get("x-cas-user-id") ?? "";
      if (authenticatedUserId !== participant.accountUserId) {
        return json({ error: "invalid_participant_identity" }, { status: 403 });
      }
    }

    for (const existingSocket of this.openSockets()) {
      if (attachmentOf(existingSocket)?.slot === participant.slot) {
        try {
          existingSocket.close(4001, "participant reconnected");
        } catch {
          // Old socket may already be closing.
        }
      }
    }

    const pair = new WebSocketPair();
    const client = pair[0];
    const server = pair[1];
    const attachment: RankedSocketAttachment = {
      playerId: crypto.randomUUID(),
      slot: participant.slot,
      joinToken,
      latestPose: null,
      latestPoseReceivedAtMs: null,
      captureStartedAtMs: null,
      captureLastAtMs: null,
      lockNotified: false,
    };
    server.serializeAttachment(attachment);
    this.ctx.acceptWebSocket(server);

    const nowMs = Date.now();
    state = markCompetitionConnected(state, participant.slot, nowMs);
    state = await this.persist(state, nowMs, false);

    this.send(server, {
      type: "welcome",
      roomCode: state.roomCode,
      playerId: attachment.playerId,
      slot: participant.slot,
      peerConnected: this.openSockets(server).length >= 1,
    });
    this.broadcastPresence();
    this.broadcastMatchState(state, nowMs);

    const responseInit: ResponseInit & { webSocket: WebSocket } = {
      status: 101,
      webSocket: client,
    };
    return new Response(null, responseInit);
  }

  async webSocketMessage(socket: HibernatableWebSocket, message: string | ArrayBuffer) {
    if (typeof message !== "string") {
      this.send(socket, {
        type: "error",
        code: "binary_unsupported",
        message: "Only bounded JSON text messages are accepted.",
      });
      return;
    }

    const parsed = parseClientRoomMessage(message);
    const sender = attachmentOf(socket);
    if (!parsed || !sender) {
      this.send(socket, {
        type: "error",
        code: "invalid_message",
        message: "Ranked match payload failed protocol validation.",
      });
      return;
    }

    let state = await this.loadState();
    if (!state) {
      this.send(socket, { type: "error", code: "missing_match", message: "Match state is unavailable." });
      socket.close(1011, "missing match");
      return;
    }

    const nowMs = Date.now();
    if (parsed.type === "pose") {
      const advanced = advanceCompetitionRuntime(state, nowMs);
      socket.serializeAttachment({
        ...sender,
        latestPose: parsed.pose,
        latestPoseReceivedAtMs: nowMs,
      } satisfies RankedSocketAttachment);
      const withGround = groundContactCompetition(advanced, sender.slot, parsed.pose, nowMs);
      if (withGround.result && !advanced.result) {
        await this.persist(withGround, nowMs);
        return;
      }
      this.updateCaptureForSlot(sender.slot, withGround, nowMs);
      this.updateCaptureForSlot(sender.slot === 1 ? 2 : 1, withGround, nowMs);
      const relay: ServerRoomMessage = {
        type: "peer_pose",
        playerId: sender.playerId,
        serverTimeMs: nowMs,
        pose: parsed.pose,
      };
      for (const peer of this.openSockets(socket)) this.send(peer, relay);
      // Advance once with this fresh pose. A duplicate broadcast with the
      // previous pose makes moving projectiles appear to hesitate.
      if (state.projectiles?.length || withGround !== state) await this.persist(withGround, nowMs);
      return;
    }

    if (state.projectiles?.length) {
      state = await this.persist(state, nowMs);
    } else {
      const advanced = advanceCompetitionRuntime(state, nowMs);
      if (advanced !== state) state = await this.persist(advanced, nowMs);
    }

    if (parsed.type === "leave_match") {
      state = forfeitCompetition(state, sender.slot, nowMs);
      await this.persist(state, nowMs);
      socket.close(1000, "match forfeited");
      return;
    }

    const resolution = resolveCompetitionAction(
      state,
      sender.slot,
      nowMs,
      this.poseForSlot(sender.slot),
      this.poseForSlot(sender.slot === 1 ? 2 : 1),
      parsed.weaponId ?? "missile",
      this.lockForSlot(sender.slot, nowMs),
    );
    state = await this.persist(resolution.state, nowMs);
    this.send(socket, {
      type: "action_feedback",
      accepted: resolution.accepted,
      code: resolution.code,
      nextActionAtMs: resolution.nextActionAtMs,
      weaponId: resolution.weaponId,
      locked: resolution.locked,
    });
  }

  async webSocketClose(socket: HibernatableWebSocket) {
    this.broadcastPresence(socket);
    const attachment = attachmentOf(socket);
    if (!attachment) return;
    // A reconnect replaces the old socket for the same participant. The old
    // close callback must not start a disconnect grace period for the new link.
    if (this.socketForSlot(attachment.slot, socket)) return;
    const state = await this.loadState();
    if (!state || state.result) return;
    const nowMs = Date.now();
    this.updateCaptureForSlot(attachment.slot === 1 ? 2 : 1, state, nowMs);
    await this.persist(markCompetitionDisconnected(state, attachment.slot, nowMs), nowMs);
  }

  async webSocketError(socket: HibernatableWebSocket) {
    await this.webSocketClose(socket);
  }

  async alarm() {
    const state = await this.loadState();
    if (!state) return;
    const nowMs = Date.now();
    await this.persist(state, nowMs);
  }
}
