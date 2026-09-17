import { isAircraftId } from "../../shared/aircraft";
import {
  ACCOUNT_API,
  AUTH_CONTRACT,
  isValidCredential,
  isValidDisplayName,
  isValidLoginId,
  normalizeDisplayName,
  normalizeLoginId,
  type AuthErrorCode,
  type AuthErrorResponse,
  type PublicUserProfile,
} from "../../shared/auth";
import { RATING_RULES } from "../../shared/rating";
import {
  createPasswordSalt,
  createSessionToken,
  derivePasswordHash,
  hashSessionToken,
  verifyPasswordHash,
} from "./crypto";
import type { AuthRepository, StoredUser } from "./repository";

const SERVER_KDF_ITERATIONS = AUTH_CONTRACT.serverPbkdf2Iterations;
const SESSION_LIFETIME_SECONDS = 7 * 24 * 60 * 60;

function profile(user: StoredUser): PublicUserProfile {
  return {
    userId: user.userId,
    loginId: user.loginId,
    displayName: user.displayName,
    rating: user.rating,
    wins: user.wins,
    losses: user.losses,
    draws: user.draws,
    fixedAircraftId: user.fixedAircraftId,
    fixableAircraftId: user.fixableAircraftId,
  };
}

function response(body: unknown, status = 200, headers?: HeadersInit) {
  const output = new Headers(headers);
  output.set("content-type", "application/json; charset=utf-8");
  output.set("cache-control", "no-store");
  return new Response(JSON.stringify(body), { status, headers: output });
}

function error(code: AuthErrorCode, message: string, status: number) {
  const body: AuthErrorResponse = { ok: false, code, message };
  return response(body, status);
}

function sessionCookie(token: string, secure: boolean) {
  return [
    `${AUTH_CONTRACT.sessionCookieName}=${token}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    `Max-Age=${SESSION_LIFETIME_SECONDS}`,
    secure ? "Secure" : "",
  ].filter(Boolean).join("; ");
}

function clearSessionCookie(secure: boolean) {
  return [
    `${AUTH_CONTRACT.sessionCookieName}=`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    "Max-Age=0",
    secure ? "Secure" : "",
  ].filter(Boolean).join("; ");
}

function cookieValue(request: Request, name: string) {
  const cookie = request.headers.get("cookie") ?? "";
  for (const part of cookie.split(";")) {
    const [key, ...rest] = part.trim().split("=");
    if (key === name) return rest.join("=");
  }
  return null;
}

async function jsonBody(request: Request): Promise<Record<string, unknown> | null> {
  try {
    const value: unknown = await request.json();
    return typeof value === "object" && value !== null ? value as Record<string, unknown> : null;
  } catch {
    return null;
  }
}

async function authenticatedUser(request: Request, repository: AuthRepository) {
  const token = cookieValue(request, AUTH_CONTRACT.sessionCookieName);
  if (!token) return null;
  const hash = await hashSessionToken(token);
  return repository.findUserBySessionHash(hash, Date.now());
}

async function issueSession(user: StoredUser, repository: AuthRepository, secure: boolean) {
  const nowMs = Date.now();
  const token = createSessionToken();
  const sessionTokenHash = await hashSessionToken(token);
  await repository.createSession({
    sessionTokenHash,
    userId: user.userId,
    createdAtMs: nowMs,
    expiresAtMs: nowMs + SESSION_LIFETIME_SECONDS * 1_000,
  });
  return response(
    { ok: true, user: profile(user) },
    200,
    { "set-cookie": sessionCookie(token, secure) },
  );
}

export async function handleAccountApi(
  request: Request,
  repository: AuthRepository,
  secureCookie: boolean,
): Promise<Response | null> {
  const url = new URL(request.url);

  if (url.pathname === ACCOUNT_API.register && request.method === "POST") {
    const body = await jsonBody(request);
    if (!body || typeof body.loginId !== "string" || typeof body.displayName !== "string" || typeof body.credential !== "string") {
      return error("INVALID_INPUT", "Registration payload is invalid.", 400);
    }
    const loginId = normalizeLoginId(body.loginId);
    const displayName = normalizeDisplayName(body.displayName);
    if (!isValidLoginId(loginId) || !isValidDisplayName(displayName) || !isValidCredential(body.credential)) {
      return error("INVALID_INPUT", "Registration fields do not satisfy the account contract.", 400);
    }
    if (await repository.findUserByLoginId(loginId)) {
      return error("LOGIN_ID_TAKEN", "That user ID is already registered.", 409);
    }

    const nowMs = Date.now();
    const passwordSalt = createPasswordSalt();
    const passwordHash = await derivePasswordHash(body.credential, passwordSalt, SERVER_KDF_ITERATIONS);
    const user: StoredUser = {
      userId: crypto.randomUUID(),
      loginId,
      displayName,
      passwordHash,
      passwordSalt,
      passwordIterations: SERVER_KDF_ITERATIONS,
      rating: RATING_RULES.initialRating,
      wins: 0,
      losses: 0,
      draws: 0,
      fixedAircraftId: null,
      fixableAircraftId: null,
      createdAtMs: nowMs,
      updatedAtMs: nowMs,
    };
    try {
      await repository.createUser(user);
    } catch {
      if (await repository.findUserByLoginId(loginId)) {
        return error("LOGIN_ID_TAKEN", "That user ID is already registered.", 409);
      }
      return error("INTERNAL_ERROR", "Account storage failed.", 500);
    }
    return issueSession(user, repository, secureCookie);
  }

  if (url.pathname === ACCOUNT_API.login && request.method === "POST") {
    const body = await jsonBody(request);
    if (!body || typeof body.loginId !== "string" || typeof body.credential !== "string" || !isValidCredential(body.credential)) {
      return error("INVALID_INPUT", "Login payload is invalid.", 400);
    }
    const user = await repository.findUserByLoginId(normalizeLoginId(body.loginId));
    if (!user || !(await verifyPasswordHash(body.credential, user.passwordSalt, user.passwordIterations, user.passwordHash))) {
      return error("INVALID_CREDENTIALS", "User ID or password is incorrect.", 401);
    }
    return issueSession(user, repository, secureCookie);
  }

  if (url.pathname === ACCOUNT_API.session && request.method === "GET") {
    const user = await authenticatedUser(request, repository);
    if (!user) return error("NOT_AUTHENTICATED", "No active session was found.", 401);
    return response({ ok: true, user: profile(user) });
  }

  if (url.pathname === ACCOUNT_API.logout && request.method === "POST") {
    const token = cookieValue(request, AUTH_CONTRACT.sessionCookieName);
    if (token) await repository.deleteSession(await hashSessionToken(token));
    return response({ ok: true }, 200, { "set-cookie": clearSessionCookie(secureCookie) });
  }

  if (url.pathname === ACCOUNT_API.leaderboard && request.method === "GET") {
    const entries = await repository.listLeaderboard(RATING_RULES.leaderboardLimit);
    return response({ ok: true, entries });
  }

  if (url.pathname === ACCOUNT_API.fixedAircraft && request.method === "PUT") {
    const user = await authenticatedUser(request, repository);
    if (!user) return error("NOT_AUTHENTICATED", "Sign in before changing the fixed aircraft.", 401);
    const body = await jsonBody(request);
    if (!body || !(body.aircraftId === null || typeof body.aircraftId === "string")) {
      return error("INVALID_INPUT", "Fixed-aircraft payload is invalid.", 400);
    }
    if (body.aircraftId !== null) {
      if (!isAircraftId(body.aircraftId) || user.fixableAircraftId !== body.aircraftId) {
        return error("AIRCRAFT_NOT_FIXABLE", "Only the most recently assigned random aircraft can be fixed.", 409);
      }
    }
    await repository.updateFixedAircraft(user.userId, body.aircraftId, Date.now());
    const updated = await repository.findUserById(user.userId);
    if (!updated) return error("INTERNAL_ERROR", "Updated account could not be loaded.", 500);
    return response({ ok: true, user: profile(updated) });
  }

  return null;
}

export async function authenticateRequest(request: Request, repository: AuthRepository) {
  return authenticatedUser(request, repository);
}
