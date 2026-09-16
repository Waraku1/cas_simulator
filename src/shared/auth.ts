export const AUTH_CONTRACT = Object.freeze({
  sessionCookieName: "cas_session",
  minimumPasswordLength: 10,
  maximumPasswordLength: 128,
  minimumLoginIdLength: 3,
  maximumLoginIdLength: 24,
  minimumDisplayNameLength: 2,
  maximumDisplayNameLength: 24,
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
}>;

export type RegisterRequest = Readonly<{
  loginId: string;
  displayName: string;
  password: string;
}>;

export type LoginRequest = Readonly<{
  loginId: string;
  password: string;
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
  | "RATE_LIMITED"
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
