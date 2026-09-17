import { AUTH_CONTRACT, isValidPassword, normalizeLoginId } from "./auth";

const encoder = new TextEncoder();

function base64Url(bytes: ArrayBuffer) {
  const view = new Uint8Array(bytes);
  let binary = "";
  for (const byte of view) binary += String.fromCharCode(byte);
  return btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

export async function deriveAuthCredential(loginId: string, password: string) {
  if (!isValidPassword(password)) {
    throw new Error("Password does not satisfy the account contract.");
  }

  const normalizedLoginId = normalizeLoginId(loginId);
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(password),
    "PBKDF2",
    false,
    ["deriveBits"],
  );
  const bits = await crypto.subtle.deriveBits(
    {
      name: "PBKDF2",
      hash: "SHA-256",
      salt: encoder.encode(`${AUTH_CONTRACT.credentialVersion}:${normalizedLoginId}`),
      iterations: AUTH_CONTRACT.clientPbkdf2Iterations,
    },
    key,
    AUTH_CONTRACT.credentialByteLength * 8,
  );

  return base64Url(bits);
}
