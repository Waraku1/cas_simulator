const encoder = new TextEncoder();

export const PASSWORD_KDF_ITERATIONS = 100_000;

function toBase64Url(bytes: Uint8Array) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function fromBase64Url(value: string) {
  const padded = value.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(value.length / 4) * 4, "=");
  const binary = atob(padded);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

function randomBytes(length: number) {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  return bytes;
}

function constantTimeEqualBytes(a: Uint8Array, b: Uint8Array) {
  if (a.length !== b.length) return false;
  let difference = 0;
  for (let index = 0; index < a.length; index += 1) difference |= a[index] ^ b[index];
  return difference === 0;
}

export function createPasswordSalt() {
  return toBase64Url(randomBytes(16));
}

export async function derivePasswordHash(
  password: string,
  saltBase64Url: string,
  iterations: number,
) {
  if (!Number.isSafeInteger(iterations) || iterations <= 0) {
    throw new Error("Password iteration count must be a positive safe integer.");
  }
  if (iterations > PASSWORD_KDF_ITERATIONS) {
    throw new Error("Password iteration count exceeds the Cloudflare Workers PBKDF2 runtime limit.");
  }

  const passwordKey = await crypto.subtle.importKey(
    "raw",
    encoder.encode(password),
    "PBKDF2",
    false,
    ["deriveBits"],
  );
  const derived = await crypto.subtle.deriveBits(
    {
      name: "PBKDF2",
      hash: "SHA-256",
      salt: fromBase64Url(saltBase64Url),
      iterations,
    },
    passwordKey,
    256,
  );
  return toBase64Url(new Uint8Array(derived));
}

export async function verifyPasswordHash(
  password: string,
  saltBase64Url: string,
  iterations: number,
  expectedHashBase64Url: string,
) {
  const candidate = await derivePasswordHash(password, saltBase64Url, iterations);
  return constantTimeEqualBytes(fromBase64Url(candidate), fromBase64Url(expectedHashBase64Url));
}

export function createSessionToken() {
  return toBase64Url(randomBytes(32));
}

export async function hashSessionToken(token: string) {
  const digest = await crypto.subtle.digest("SHA-256", encoder.encode(token));
  return toBase64Url(new Uint8Array(digest));
}
