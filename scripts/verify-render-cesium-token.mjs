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


async function requestIonJson(path, label) {
  const endpoint = new URL(`https://api.cesium.com${path}`);
  endpoint.searchParams.set("access_token", token);

  let response;
  try {
    response = await fetch(endpoint, {
      headers: { Referer: referer },
      redirect: "follow",
      signal: AbortSignal.timeout(15_000),
    });
  } catch (error) {
    throw new Error(
      `Cesium ion preflight could not reach ${label}: ${error instanceof Error ? error.message : "network error"}`,
    );
  }

  let body = null;
  try {
    body = await response.clone().json();
  } catch {
    // Keep diagnostics bounded; never print response bodies or token-bearing URLs.
  }

  return {
    response,
    code: body && typeof body.code === "string" ? body.code : "UNKNOWN",
  };
}

const defaultsCheck = await requestIonJson("/v1/defaults", "server defaults");
if (!defaultsCheck.response.ok) {
  throw new Error(
    `CESIUM_RENDER_TOKEN_DIAGNOSTIC TOKEN_OR_URL_RESTRICTION_FAILED: HTTP ${defaultsCheck.response.status} ${defaultsCheck.code}. Check that the token is active and Allowed URLs includes exactly https://cas-simulator-school.onrender.com.`,
  );
}
await defaultsCheck.response.body?.cancel();
console.log("CESIUM_RENDER_TOKEN_DIAGNOSTIC TOKEN_AND_REFERER_ACCEPTED");

const requiredAssets = [
  { id: 1, label: "Cesium World Terrain" },
  { id: 2, label: "Cesium default world imagery" },
];

for (const asset of requiredAssets) {
  const check = await requestIonJson(
    `/v1/assets/${asset.id}/endpoint`,
    `asset ${asset.id} (${asset.label})`,
  );

  if (!check.response.ok) {
    if (check.response.status === 403) {
      throw new Error(
        `CESIUM_RENDER_TOKEN_DIAGNOSTIC ASSET_AUTHORIZATION_FAILED: asset ${asset.id} (${asset.label}) returned HTTP 403 ${check.code}. Token and Referer were accepted by /v1/defaults; verify assets:read and the token's Asset Restrictions include asset ${asset.id} (or temporarily choose All assets for diagnosis).`,
      );
    }
    throw new Error(
      `Cesium ion token preflight failed for asset ${asset.id} (${asset.label}): HTTP ${check.response.status} ${check.code}`,
    );
  }

  await check.response.body?.cancel();
}

console.log("CESIUM_RENDER_TOKEN_PREFLIGHT PASS (assets 1, 2)");
