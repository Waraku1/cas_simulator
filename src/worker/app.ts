import { ACCOUNT_API } from "../shared/auth";
import { MATCHMAKING_PATH } from "../shared/matchmaking";
import coreWorker, { MultiplayerRoom, RankedMatchmaker } from "./index";
import { D1AuthRepository, type D1DatabaseLike } from "./auth/repository";
import { authenticateRequest, handleAccountApi } from "./auth/service";
import { RankedMatch } from "./ranked-match-integrity";

export { MultiplayerRoom, RankedMatch, RankedMatchmaker };

type CoreEnv = Parameters<typeof coreWorker.fetch>[1];
type Env = CoreEnv & Readonly<{
  ACCOUNTS?: D1DatabaseLike;
}>;

const accountPaths = new Set<string>([
  ACCOUNT_API.register,
  ACCOUNT_API.login,
  ACCOUNT_API.session,
  ACCOUNT_API.logout,
  ACCOUNT_API.fixedAircraft,
  ACCOUNT_API.leaderboard,
]);
const RANKED_MATCH_SOCKET_ROUTE = /^\/api\/matches\/[0-9a-f-]{36}\/ws$/i;
const AUTHENTICATED_USER_HEADER = "x-cas-user-id";
const FIXED_AIRCRAFT_HEADER = "x-cas-fixed-aircraft-id";

function storageUnavailable() {
  return Response.json(
    { ok: false, code: "STORAGE_UNAVAILABLE", message: "Account persistence is not configured on this deployment." },
    { status: 503, headers: { "cache-control": "no-store" } },
  );
}

function authenticationRequired() {
  return Response.json(
    { ok: false, code: "NOT_AUTHENTICATED", message: "Sign in before entering ranked matchmaking." },
    { status: 401, headers: { "cache-control": "no-store" } },
  );
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;
    const accounts = env.ACCOUNTS ? new D1AuthRepository(env.ACCOUNTS) : null;

    if (accountPaths.has(path)) {
      if (!accounts) return storageUnavailable();
      const accountResponse = await handleAccountApi(
        request,
        accounts,
        url.protocol === "https:",
      );
      if (accountResponse) return accountResponse;
    }

    const rankedTransport = path === MATCHMAKING_PATH || RANKED_MATCH_SOCKET_ROUTE.test(path);
    if (rankedTransport) {
      if (!accounts) return storageUnavailable();
      const user = await authenticateRequest(request, accounts);
      if (!user) return authenticationRequired();

      const headers = new Headers(request.headers);
      // Never trust identity-like headers supplied by the public client.
      headers.set(AUTHENTICATED_USER_HEADER, user.userId);
      headers.set(FIXED_AIRCRAFT_HEADER, user.fixedAircraftId ?? "");
      const authenticatedRequest = new Request(request, { headers });
      return coreWorker.fetch(authenticatedRequest, env);
    }

    return coreWorker.fetch(request, env);
  },
};
