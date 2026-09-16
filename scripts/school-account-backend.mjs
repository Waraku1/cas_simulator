import { createServer } from "node:http";
import { createSchoolAccountStore } from "./school-account-store.mjs";

const HOST = "127.0.0.1";
const PORT = Number(process.env.SCHOOL_ACCOUNT_PORT ?? 8788);
const INTERNAL_TOKEN = process.env.SCHOOL_INTERNAL_TOKEN ?? "";
const store = createSchoolAccountStore();

if (!INTERNAL_TOKEN) {
  console.error("[school-account] SCHOOL_INTERNAL_TOKEN is required.");
  process.exit(1);
}

function cookieHeader(token) {
  return `cas_session=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${7 * 24 * 60 * 60}`;
}

function clearCookieHeader() {
  return "cas_session=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0";
}

function writeJson(response, status, body, extraHeaders = {}) {
  const payload = JSON.stringify(body);
  response.writeHead(status, {
    "cache-control": "no-store",
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(payload),
    ...extraHeaders,
  });
  response.end(payload);
}

async function readJson(request) {
  let text = "";
  for await (const chunk of request) {
    text += chunk;
    if (Buffer.byteLength(text) > 16_384) return null;
  }
  if (!text) return null;
  try {
    const value = JSON.parse(text);
    return typeof value === "object" && value !== null ? value : null;
  } catch {
    return null;
  }
}

function unauthorized(response) {
  writeJson(response, 401, { ok: false, code: "NOT_AUTHENTICATED", message: "No active session was found." });
}

function internalAuthorized(request) {
  return request.headers["x-cas-internal-token"] === INTERNAL_TOKEN;
}

const server = createServer(async (request, response) => {
  const url = new URL(request.url ?? "/", `http://${request.headers.host ?? `${HOST}:${PORT}`}`);

  if (url.pathname.startsWith("/__internal/")) {
    if (!internalAuthorized(request)) {
      writeJson(response, 403, { ok: false, error: "forbidden" });
      return;
    }

    if (url.pathname === "/__internal/session/resolve" && request.method === "POST") {
      const body = await readJson(request);
      const user = body && typeof body.cookie === "string" ? store.authenticateCookie(body.cookie) : null;
      if (!user) {
        writeJson(response, 401, { ok: false, error: "not_authenticated" });
        return;
      }
      writeJson(response, 200, { ok: true, user: store.publicProfile(user) });
      return;
    }

    if (url.pathname === "/__internal/assignment" && request.method === "POST") {
      const body = await readJson(request);
      if (!body || typeof body.userId !== "string" || typeof body.aircraftId !== "string" || typeof body.randomAssignment !== "boolean") {
        writeJson(response, 400, { ok: false, error: "invalid_assignment" });
        return;
      }
      if (body.randomAssignment) store.setFixableAircraft(body.userId, body.aircraftId);
      writeJson(response, 200, { ok: true });
      return;
    }

    if (url.pathname === "/__internal/rated-match" && request.method === "POST") {
      const body = await readJson(request);
      if (
        !body
        || typeof body.matchId !== "string"
        || typeof body.firstUserId !== "string"
        || typeof body.secondUserId !== "string"
        || !["win", "loss", "draw"].includes(body.firstOutcome)
        || typeof body.reason !== "string"
        || typeof body.completedAtMs !== "number"
      ) {
        writeJson(response, 400, { ok: false, error: "invalid_rated_match" });
        return;
      }
      try {
        const result = store.applyRatedMatch(body);
        writeJson(response, 200, { ok: true, result });
      } catch (error) {
        writeJson(response, 409, { ok: false, error: error instanceof Error ? error.message : "rating_failed" });
      }
      return;
    }

    writeJson(response, 404, { ok: false, error: "internal_not_found" });
    return;
  }

  if (url.pathname === "/api/auth/register" && request.method === "POST") {
    const body = await readJson(request);
    const result = body ? store.register(body) : { error: { code: "INVALID_INPUT", message: "Registration payload is invalid." } };
    if (result.error) {
      writeJson(response, result.error.code === "LOGIN_ID_TAKEN" ? 409 : 400, { ok: false, ...result.error });
      return;
    }
    writeJson(response, 200, { ok: true, user: store.publicProfile(result.user) }, { "set-cookie": cookieHeader(result.token) });
    return;
  }

  if (url.pathname === "/api/auth/login" && request.method === "POST") {
    const body = await readJson(request);
    const result = body ? store.login(body) : { error: { code: "INVALID_INPUT", message: "Login payload is invalid." } };
    if (result.error) {
      writeJson(response, result.error.code === "INVALID_CREDENTIALS" ? 401 : 400, { ok: false, ...result.error });
      return;
    }
    writeJson(response, 200, { ok: true, user: store.publicProfile(result.user) }, { "set-cookie": cookieHeader(result.token) });
    return;
  }

  if (url.pathname === "/api/auth/session" && request.method === "GET") {
    const user = store.authenticateCookie(request.headers.cookie);
    if (!user) {
      unauthorized(response);
      return;
    }
    writeJson(response, 200, { ok: true, user: store.publicProfile(user) });
    return;
  }

  if (url.pathname === "/api/auth/logout" && request.method === "POST") {
    store.logout(request.headers.cookie);
    writeJson(response, 200, { ok: true }, { "set-cookie": clearCookieHeader() });
    return;
  }

  if (url.pathname === "/api/account/fixed-aircraft" && request.method === "PUT") {
    const user = store.authenticateCookie(request.headers.cookie);
    if (!user) {
      unauthorized(response);
      return;
    }
    const body = await readJson(request);
    if (!body || !(body.aircraftId === null || typeof body.aircraftId === "string")) {
      writeJson(response, 400, { ok: false, code: "INVALID_INPUT", message: "Fixed-aircraft payload is invalid." });
      return;
    }
    const result = store.setFixedAircraft(user, body.aircraftId);
    if (result.error) {
      writeJson(response, 409, { ok: false, ...result.error });
      return;
    }
    writeJson(response, 200, { ok: true, user: store.publicProfile(result.user) });
    return;
  }

  if (url.pathname === "/api/leaderboard" && request.method === "GET") {
    writeJson(response, 200, { ok: true, entries: store.leaderboard() });
    return;
  }

  if (url.pathname === "/api/health") {
    writeJson(response, 200, { ok: true, runtime: "SCHOOL_ACCOUNT_LOCAL", persistence: "PROCESS_MEMORY" });
    return;
  }

  writeJson(response, 404, { error: "not_found" });
});

server.listen(PORT, HOST, () => {
  console.log(`[school-account] listening on http://${HOST}:${PORT}`);
});

const shutdown = () => server.close(() => process.exit(0));
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
