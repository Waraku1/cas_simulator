const encoder = new TextEncoder();
const supportedIterations = new Set([
  100_000,
  110_000,
  120_000,
  130_000,
  140_000,
  150_000,
  160_000,
  170_000,
  180_000,
  190_000,
  200_000,
]);
const passwordBytes = encoder.encode("CAS-KDF-BENCHMARK-NOT-A-REAL-PASSWORD");
const salt = new Uint8Array([
  0x43, 0x41, 0x53, 0x2d, 0x4b, 0x44, 0x46, 0x2d,
  0x42, 0x45, 0x4e, 0x43, 0x48, 0x2d, 0x30, 0x31,
]);

export default {
  async fetch(request) {
    const url = new URL(request.url);
    if (request.method !== "GET" || url.pathname !== "/benchmark") {
      return Response.json({ ok: false, error: "not_found" }, { status: 404 });
    }

    const iterations = Number(url.searchParams.get("iterations"));
    if (!Number.isSafeInteger(iterations) || !supportedIterations.has(iterations)) {
      return Response.json(
        { ok: false, error: "unsupported_iterations", supported: [...supportedIterations] },
        { status: 400 },
      );
    }

    const passwordKey = await crypto.subtle.importKey(
      "raw",
      passwordBytes,
      "PBKDF2",
      false,
      ["deriveBits"],
    );
    await crypto.subtle.deriveBits(
      {
        name: "PBKDF2",
        hash: "SHA-256",
        salt,
        iterations,
      },
      passwordKey,
      256,
    );

    return Response.json({
      ok: true,
      algorithm: "PBKDF2-HMAC-SHA256",
      iterations,
      derivedBits: 256,
    }, {
      headers: {
        "cache-control": "no-store",
      },
    });
  },
};
