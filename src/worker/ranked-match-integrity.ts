import type { D1DatabaseLike } from "./auth/repository";
import type { StoredCompetitionRuntime } from "./competition-runtime";
import { RankedMatch as BaseRankedMatch } from "./ranked-match";

interface DurableObjectId {}

interface DurableObjectStub {
  fetch(request: Request): Promise<Response>;
}

interface DurableObjectNamespace {
  idFromName(name: string): DurableObjectId;
  get(id: DurableObjectId): DurableObjectStub;
}

interface DurableObjectStorage {
  get<T>(key: string): Promise<T | undefined>;
  put(key: string, value: unknown): Promise<void>;
  setAlarm(scheduledTime: number): Promise<void>;
  deleteAlarm(): Promise<void>;
}

type HibernatableWebSocket = WebSocket & {
  serializeAttachment(value: unknown): void;
  deserializeAttachment(): unknown;
};

interface DurableObjectState {
  storage: DurableObjectStorage;
  acceptWebSocket(socket: HibernatableWebSocket): void;
  getWebSockets(): HibernatableWebSocket[];
}

type RankedMatchIntegrityEnv = Readonly<{
  ACCOUNTS?: D1DatabaseLike;
  MATCHMAKER: DurableObjectNamespace;
}>;

const STORAGE_KEY = "competition-runtime-v1";
const ACCOUNT_FINALIZED_KEY = "rating-finalized-v1";
const ACTIVE_MATCH_LOCK_RELEASED_KEY = "active-match-lock-released-v1";
const GLOBAL_MATCHMAKER_NAME = "ranked-global-v1";
const MATCH_COMPLETE_URL = "https://ranked-matchmaker.internal/__internal/match-complete";
const LOCK_RETRY_MS = 5_000;

/**
 * Release-hardening wrapper for the accepted RankedMatch runtime.
 *
 * The base class remains authoritative for competition state and D1 account
 * finalization. This wrapper only releases the global one-account/one-match
 * lock after the base finalization marker has been persisted. If release
 * fails, the same Durable Object alarm retries without replaying rating/W-L-D
 * mutations because the base ledger/finalization path is idempotent.
 */
export class RankedMatch extends BaseRankedMatch {
  constructor(
    private readonly integrityCtx: DurableObjectState,
    private readonly integrityEnv: RankedMatchIntegrityEnv,
  ) {
    super(integrityCtx, integrityEnv);
  }

  private async reconcileActiveMatchLock() {
    const state = await this.integrityCtx.storage.get<StoredCompetitionRuntime>(STORAGE_KEY);
    if (!state?.result) return;
    if (await this.integrityCtx.storage.get<boolean>(ACTIVE_MATCH_LOCK_RELEASED_KEY)) return;

    // Rating/W-L-D, NO CONTEST neutrality, and fixable-aircraft persistence are
    // completed by the base runtime before the global lock may be released.
    if (!(await this.integrityCtx.storage.get<boolean>(ACCOUNT_FINALIZED_KEY))) return;

    const [first, second] = state.participants;
    const firstUserId = first.accountUserId;
    const secondUserId = second.accountUserId;

    if (firstUserId === null && secondUserId === null) {
      // Legacy unrated C4C matches never acquire a global account lock.
      await this.integrityCtx.storage.put(ACTIVE_MATCH_LOCK_RELEASED_KEY, true);
      return;
    }

    if (!firstUserId || !secondUserId || firstUserId === secondUserId) {
      console.error(`[ranked-match] cannot release malformed account lock for ${state.matchId}`);
      await this.integrityCtx.storage.setAlarm(Date.now() + LOCK_RETRY_MS);
      return;
    }

    try {
      const id = this.integrityEnv.MATCHMAKER.idFromName(GLOBAL_MATCHMAKER_NAME);
      const response = await this.integrityEnv.MATCHMAKER.get(id).fetch(new Request(MATCH_COMPLETE_URL, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          matchId: state.matchId,
          userIds: [firstUserId, secondUserId],
        }),
      }));
      if (!response.ok) throw new Error(`matchmaker release returned HTTP ${response.status}`);
      await this.integrityCtx.storage.put(ACTIVE_MATCH_LOCK_RELEASED_KEY, true);
    } catch (error) {
      console.error(
        `[ranked-match] active-match lock release failed for ${state.matchId}: ${error instanceof Error ? error.message : String(error)}`,
      );
      await this.integrityCtx.storage.setAlarm(Date.now() + LOCK_RETRY_MS);
    }
  }

  async fetch(request: Request): Promise<Response> {
    const response = await super.fetch(request);
    await this.reconcileActiveMatchLock();
    return response;
  }

  async webSocketMessage(socket: HibernatableWebSocket, message: string | ArrayBuffer) {
    await super.webSocketMessage(socket, message);
    await this.reconcileActiveMatchLock();
  }

  async webSocketClose(socket: HibernatableWebSocket) {
    await super.webSocketClose(socket);
    await this.reconcileActiveMatchLock();
  }

  async alarm() {
    await super.alarm();
    await this.reconcileActiveMatchLock();
  }
}
