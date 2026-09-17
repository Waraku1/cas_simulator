export const AUTH_CONTRACT = Object.freeze({
  sessionCookieName: "cas_session",
  minimumPasswordLength: 10,
  maximumPasswordLength: 128,
  minimumLoginIdLength: 3,
  maximumLoginIdLength: 24,
  minimumDisplayNameLength: 2,
  maximumDisplayNameLength: 24,
  credentialVersion: "cas-auth-v1",
  clientPbkdf2Iterations: 600_000,
  serverPbkdf2Iterations: 100_000,
  credentialByteLength: 32,
  credentialBase64UrlLength: 43,
});

export const ACCOUNT_API = Object.freeze({
  register: "/api/auth/register",
  login: "/api/auth/login",
  session: "/api/auth/session",
  logout: "/api/auth/logout",
  fixedAircraft: "/api/account/fixed-aircraft",
  leaderboard: "/api/leaderboard",
});

export type PublicUserProfile = Readonly<{
  userId: string;
  loginId: string;
  displayName: string;
  rating: number;
  wins: number;
  losses: number;
  draws: number;
  fixedAircraftId: string | null;
  fixableAircraftId: string | null;
}>;

export type RegisterRequest = Readonly<{
  loginId: string;
  displayName: string;
  credential: string;
}>;

export type LoginRequest = Readonly<{
  loginId: string;
  credential: string;
}>;

export type FixedAircraftRequest = Readonly<{
  aircraftId: string | null;
}>;

export type LeaderboardProfile = Readonly<{
  rank: number;
  userId: string;
  displayName: string;
  rating: number;
  wins: number;
  losses: number;
  draws: number;
}>;

export type LeaderboardResponse = Readonly<{
  ok: true;
  entries: readonly LeaderboardProfile[];
}>;

export type AuthSuccessResponse = Readonly<{
  ok: true;
  user: PublicUserProfile;
}>;

export type AuthErrorCode =
  | "INVALID_INPUT"
  | "LOGIN_ID_TAKEN"
  | "INVALID_CREDENTIALS"
  | "NOT_AUTHENTICATED"
  | "AIRCRAFT_NOT_FIXABLE"
  | "RATE_LIMITED"
  | "STORAGE_UNAVAILABLE"
  | "INTERNAL_ERROR";

export type AuthErrorResponse = Readonly<{
  ok: false;
  code: AuthErrorCode;
  message: string;
}>;

export type AuthResponse = AuthSuccessResponse | AuthErrorResponse;

export function normalizeLoginId(value: string) {
  return value.trim().toLowerCase();
}

export function normalizeDisplayName(value: string) {
  return value.trim().replace(/\s+/g, " ");
}

export function isValidLoginId(value: string) {
  const normalized = normalizeLoginId(value);
  return normalized.length >= AUTH_CONTRACT.minimumLoginIdLength
    && normalized.length <= AUTH_CONTRACT.maximumLoginIdLength
    && /^[a-z0-9][a-z0-9_-]*$/.test(normalized);
}

export function isValidDisplayName(value: string) {
  const normalized = normalizeDisplayName(value);
  return normalized.length >= AUTH_CONTRACT.minimumDisplayNameLength
    && normalized.length <= AUTH_CONTRACT.maximumDisplayNameLength;
}

export function isValidPassword(value: string) {
  return value.length >= AUTH_CONTRACT.minimumPasswordLength
    && value.length <= AUTH_CONTRACT.maximumPasswordLength;
}

export function isValidCredential(value: string) {
  return value.length === AUTH_CONTRACT.credentialBase64UrlLength
    && /^[A-Za-z0-9_-]+$/.test(value);
}
