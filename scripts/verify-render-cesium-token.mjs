const runningOnRender = process.env.RENDER === "true";
const forced = process.env.RENDER_CESIUM_PREFLIGHT === "1";

if (!runningOnRender && !forced) {
  console.log("Cesium Render token preflight skipped outside Render.");
  process.exit(0);
}

const token = process.env.VITE_CESIUM_ION_TOKEN?.trim();
const publicOrigin = process.env.CAS_PUBLIC_ORIGIN?.trim();

if (!token) {
  throw new Error("VITE_CESIUM_ION_TOKEN is required for the Render school build.");
}
if (!publicOrigin) {
  throw new Error("CAS_PUBLIC_ORIGIN is required for the Render Cesium token preflight.");
}

let referer;
try {
  const origin = new URL(publicOrigin);
  if (origin.protocol !== "https:") throw new Error("not HTTPS");
  referer = `${origin.origin}/`;
} catch {
  throw new Error("CAS_PUBLIC_ORIGIN must be a valid HTTPS origin.");
}

const requiredAssets = [
  { id: 1, label: "Cesium World Terrain" },
  { id: 2, label: "Cesium default world imagery" },
];

for (const asset of requiredAssets) {
  const endpoint = new URL(`https://api.cesium.com/v1/assets/${asset.id}/endpoint`);
  endpoint.searchParams.set("access_token", token);

  let response;
  try {
    response = await fetch(endpoint, {
      headers: {
        Referer: referer,
      },
      redirect: "follow",
      signal: AbortSignal.timeout(15_000),
    });
  } catch (error) {
    throw new Error(
      `Cesium ion preflight could not reach asset ${asset.id} (${asset.label}): ${error instanceof Error ? error.message : "network error"}`,
    );
  }

  if (!response.ok) {
    let errorCode = "UNKNOWN";
    try {
      const body = await response.json();
      if (body && typeof body.code === "string") errorCode = body.code;
    } catch {
      // Do not print response bodies or request URLs; the request URL contains the token.
    }
    throw new Error(
      `Cesium ion token preflight failed for asset ${asset.id} (${asset.label}): HTTP ${response.status} ${errorCode}`,
    );
  }

  await response.body?.cancel();
}

console.log("CESIUM_RENDER_TOKEN_PREFLIGHT PASS (assets 1, 2)");
