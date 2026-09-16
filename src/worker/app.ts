import { ACCOUNT_API } from "../shared/auth";
import coreWorker, { MultiplayerRoom, RankedMatch, RankedMatchmaker } from "./index";
import { D1AuthRepository, type D1DatabaseLike } from "./auth/repository";
import { handleAccountApi } from "./auth/service";

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

function storageUnavailable() {
  return Response.json(
    { ok: false, code: "STORAGE_UNAVAILABLE", message: "Account persistence is not configured on this deployment." },
    { status: 503, headers: { "cache-control": "no-store" } },
  );
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const path = new URL(request.url).pathname;
    if (accountPaths.has(path)) {
      if (!env.ACCOUNTS) return storageUnavailable();
      const accountResponse = await handleAccountApi(
        request,
        new D1AuthRepository(env.ACCOUNTS),
        new URL(request.url).protocol === "https:",
      );
      if (accountResponse) return accountResponse;
    }
    return coreWorker.fetch(request, env);
  },
};
