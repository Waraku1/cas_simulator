import { createServer } from "node:http";
import { createSchoolAccountStore } from "./school-account-store.mjs";

const HOST = "127.0.0.1";
const PORT = Number(process.env.SCHOOL_ACCOUNT_PORT ?? 8788);
const store = createSchoolAccountStore();

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

const server = createServer(async (request, response) => {
  const url = new URL(request.url ?? "/", `http://${request.headers.host ?? `${HOST}:${PORT}`}`);

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
