import { pbkdf2Sync } from "node:crypto";

const CLIENT_ITERATIONS = 600_000;
const CREDENTIAL_VERSION = "cas-auth-v1";

export function deriveAuthCredential(loginId, password) {
  const normalizedLoginId = String(loginId).trim().toLowerCase();
  return pbkdf2Sync(
    String(password),
    `${CREDENTIAL_VERSION}:${normalizedLoginId}`,
    CLIENT_ITERATIONS,
    32,
    "sha256",
  ).toString("base64url");
}
