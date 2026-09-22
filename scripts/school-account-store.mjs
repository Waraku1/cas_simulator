import { pbkdf2Sync, randomBytes, randomUUID, createHash } from "node:crypto";
import aircraftCatalog from "../src/shared/aircraft-catalog.json" with { type: "json" };

const SESSION_COOKIE = "cas_session";
const SESSION_LIFETIME_MS = 7 * 24 * 60 * 60 * 1_000;
const PASSWORD_ITERATIONS = 100_000;
const AIRCRAFT_IDS = new Set(aircraftCatalog.map((aircraft) => aircraft.aircraftId));

function base64url(buffer) {
  return Buffer.from(buffer).toString("base64url");
}

function passwordHash(password, salt) {
  return base64url(pbkdf2Sync(password, Buffer.from(salt, "base64url"), PASSWORD_ITERATIONS, 32, "sha256"));
}

function tokenHash(token) {
  return createHash("sha256").update(token).digest("base64url");
}

function cookieValue(header, name) {
  for (const part of String(header ?? "").split(";")) {
    const [key, ...rest] = part.trim().split("=");
    if (key === name) return rest.join("=");
  }
  return null;
}

function publicProfile(user) {
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

export function createSchoolAccountStore() {
  const usersById = new Map();
  const usersByLogin = new Map();
  const sessions = new Map();
  const ratedMatches = new Map();

  const normalizeLogin = (value) => String(value ?? "").trim().toLowerCase();
  const normalizeDisplay = (value) => String(value ?? "").trim().replace(/\s+/g, " ");
  const validLogin = (value) => value.length >= 3 && value.length <= 24 && /^[a-z0-9][a-z0-9_-]*$/.test(value);
  const validDisplay = (value) => value.length >= 2 && value.length <= 24;
  const validPassword = (value) => typeof value === "string" && value.length >= 10 && value.length <= 128;

  function createSession(user) {
    const token = base64url(randomBytes(32));
    sessions.set(tokenHash(token), { userId: user.userId, expiresAtMs: Date.now() + SESSION_LIFETIME_MS });
    return token;
  }

  function authenticateCookie(cookieHeader) {
    const token = cookieValue(cookieHeader, SESSION_COOKIE);
    if (!token) return null;
    const session = sessions.get(tokenHash(token));
    if (!session) return null;
    if (session.expiresAtMs <= Date.now()) {
      sessions.delete(tokenHash(token));
      return null;
    }
    const user = usersById.get(session.userId) ?? null;
    return user && user.deletedAtMs === null ? user : null;
  }

  function register({ loginId, displayName, password }) {
    const normalizedLogin = normalizeLogin(loginId);
    const normalizedDisplay = normalizeDisplay(displayName);
    if (!validLogin(normalizedLogin) || !validDisplay(normalizedDisplay) || !validPassword(password)) {
      return { error: { code: "INVALID_INPUT", message: "Registration fields do not satisfy the account contract." } };
    }
    if (usersByLogin.has(normalizedLogin)) {
      return { error: { code: "LOGIN_ID_TAKEN", message: "That user ID is already registered." } };
    }
    const nowMs = Date.now();
    const salt = base64url(randomBytes(16));
    const user = {
      userId: randomUUID(),
      loginId: normalizedLogin,
      displayName: normalizedDisplay,
      passwordSalt: salt,
      passwordHash: passwordHash(password, salt),
      rating: 1200,
      wins: 0,
      losses: 0,
      draws: 0,
      fixedAircraftId: null,
      fixableAircraftId: null,
      createdAtMs: nowMs,
      updatedAtMs: nowMs,
      deletedAtMs: null,
    };
    usersById.set(user.userId, user);
    usersByLogin.set(user.loginId, user);
    return { user, token: createSession(user) };
  }

  function login({ loginId, password }) {
    const user = usersByLogin.get(normalizeLogin(loginId));
    if (!user || user.deletedAtMs !== null || !validPassword(password) || passwordHash(password, user.passwordSalt) !== user.passwordHash) {
      return { error: { code: "INVALID_CREDENTIALS", message: "User ID or password is incorrect." } };
    }
    return { user, token: createSession(user) };
  }

  function logout(cookieHeader) {
    const token = cookieValue(cookieHeader, SESSION_COOKIE);
    if (token) sessions.delete(tokenHash(token));
  }

  function setFixedAircraft(user, aircraftId) {
    if (user.deletedAtMs !== null) return { error: { code: "NOT_AUTHENTICATED", message: "Account is deleted." } };
    if (aircraftId !== null && (!AIRCRAFT_IDS.has(aircraftId) || user.fixableAircraftId !== aircraftId)) {
      return { error: { code: "AIRCRAFT_NOT_FIXABLE", message: "Only the most recently assigned random aircraft can be fixed." } };
    }
    user.fixedAircraftId = aircraftId;
    user.updatedAtMs = Date.now();
    return { user };
  }

  function setFixableAircraft(userId, aircraftId) {
    const user = usersById.get(userId);
    if (!user || user.deletedAtMs !== null || !AIRCRAFT_IDS.has(aircraftId)) return;
    user.fixableAircraftId = aircraftId;
    user.updatedAtMs = Date.now();
  }

  function deleteAccount(cookieHeader, { password, confirmation } = {}) {
    const user = authenticateCookie(cookieHeader);
    if (!user) return { error: { code: "NOT_AUTHENTICATED", message: "Sign in before deleting the account." } };
    if (confirmation !== "DELETE" || typeof password !== "string") {
      return { error: { code: "INVALID_INPUT", message: "Account deletion requires password confirmation and the exact word DELETE." } };
    }
    if (!validPassword(password) || passwordHash(password, user.passwordSalt) !== user.passwordHash) {
      return { error: { code: "INVALID_CREDENTIALS", message: "Password confirmation failed." } };
    }
    usersByLogin.delete(user.loginId);
    for (const [hash, session] of sessions) {
      if (session.userId === user.userId) sessions.delete(hash);
    }
    user.loginId = `deleted_${user.userId.replace(/[^a-zA-Z0-9]/g, "")}`;
    user.displayName = "Deleted Pilot";
    user.passwordHash = "";
    user.passwordSalt = "";
    user.fixedAircraftId = null;
    user.fixableAircraftId = null;
    user.updatedAtMs = Date.now();
    user.deletedAtMs = user.updatedAtMs;
    return { ok: true, userId: user.userId };
  }

  function leaderboard(limit = 50) {
    return [...usersById.values()]
      .filter((user) => user.deletedAtMs === null)
      .sort((a, b) => b.rating - a.rating || b.wins - a.wins || a.userId.localeCompare(b.userId))
      .slice(0, limit)
      .map((user, index) => ({
        rank: index + 1,
        userId: user.userId,
        displayName: user.displayName,
        rating: user.rating,
        wins: user.wins,
        losses: user.losses,
        draws: user.draws,
      }));
  }

  function applyRatedMatch({ matchId, firstUserId, secondUserId, firstOutcome, reason, completedAtMs }) {
    if (ratedMatches.has(matchId)) return ratedMatches.get(matchId);
    const first = usersById.get(firstUserId);
    const second = usersById.get(secondUserId);
    if (!first || !second) throw new Error("Unknown rated-match user.");
    const expected = (own, other) => 1 / (1 + 10 ** ((other - own) / 400));
    const firstScore = firstOutcome === "win" ? 1 : firstOutcome === "loss" ? 0 : 0.5;
    const secondScore = 1 - firstScore;
    const firstBefore = first.rating;
    const secondBefore = second.rating;
    const firstAfter = Math.max(0, Math.round(firstBefore + 32 * (firstScore - expected(firstBefore, secondBefore))));
    const secondAfter = Math.max(0, Math.round(secondBefore + 32 * (secondScore - expected(secondBefore, firstBefore))));
    first.rating = firstAfter;
    second.rating = secondAfter;
    if (firstOutcome === "win") { first.wins += 1; second.losses += 1; }
    else if (firstOutcome === "loss") { first.losses += 1; second.wins += 1; }
    else { first.draws += 1; second.draws += 1; }
    first.updatedAtMs = completedAtMs;
    second.updatedAtMs = completedAtMs;
    const ledger = { matchId, reason, firstBefore, firstAfter, secondBefore, secondAfter, completedAtMs };
    ratedMatches.set(matchId, ledger);
    return ledger;
  }

  return {
    register,
    login,
    logout,
    deleteAccount,
    authenticateCookie,
    publicProfile,
    setFixedAircraft,
    setFixableAircraft,
    leaderboard,
    applyRatedMatch,
    sessionCookieName: SESSION_COOKIE,
  };
}
