import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");
const outputDir = join(root, "public", "aircraft");

const BELL_X1 = Object.freeze({
  key: "bell-x1",
  title: "Bell X-1",
  packageId: "6c69a6bb-55e6-4356-8725-120ff7f8d652",
  sourcePage: "https://3d.si.edu/object/3d/6c69a6bb-55e6-4356-8725-120ff7f8d652",
  api: "https://3d-api.si.edu/api/v1.0/content/file/search",
  rights: "CC0",
  maxBytes: 48 * 1024 * 1024,
});

const QUALITY_RANK = new Map([
  ["Medium", 0],
  ["Medium_resolution", 1],
  ["Low", 2],
  ["Low_resolution", 3],
  ["High", 4],
  ["Full_resolution", 5],
  ["Thumb", 6],
]);

function timeoutSignal(milliseconds) {
  return AbortSignal.timeout(milliseconds);
}

async function fetchWithRetry(url, options = {}, attempts = 3) {
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const response = await fetch(url, {
        ...options,
        signal: timeoutSignal(30_000),
      });
      if (response.ok) return response;
      lastError = new Error(`HTTP ${response.status}`);
      if (response.status >= 400 && response.status < 500) break;
    } catch (error) {
      lastError = error;
    }
    if (attempt < attempts) {
      await new Promise((resolve) => setTimeout(resolve, attempt * 750));
    }
  }
  throw new Error(`Smithsonian 3D request failed: ${lastError instanceof Error ? lastError.message : "unknown error"}`);
}

function normalizeBoolean(value) {
  return value === true || value === "true";
}

function normalizeSize(value) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : Number.POSITIVE_INFINITY;
}

function candidateFromRow(row) {
  const content = row && typeof row === "object" ? row.content : null;
  if (!content || typeof content !== "object") return null;
  if (typeof content.uri !== "string" || !content.uri.startsWith("https://")) return null;
  const fileType = String(content.file_type ?? "").toLowerCase();
  if (fileType !== "glb" && !content.uri.toLowerCase().endsWith(".glb")) return null;

  return {
    uri: content.uri,
    quality: String(content.quality ?? ""),
    bytes: normalizeSize(content.file_size),
    draco: normalizeBoolean(content.draco_compressed),
    orientationCompliant: normalizeBoolean(content.gltf_orientation_compliant),
  };
}

function candidateScore(candidate) {
  const qualityRank = QUALITY_RANK.get(candidate.quality) ?? 20;
  const orientationPenalty = candidate.orientationCompliant ? 0 : 100;
  const dracoPenalty = candidate.draco ? 0 : 20;
  const oversizePenalty = candidate.bytes > BELL_X1.maxBytes ? 10_000 : 0;
  return oversizePenalty + orientationPenalty + dracoPenalty + qualityRank;
}

async function discoverBellX1() {
  const query = new URL(BELL_X1.api);
  query.searchParams.set("model_url", BELL_X1.packageId);
  query.searchParams.set("file_type", "glb");
  query.searchParams.set("rows", "100");

  const response = await fetchWithRetry(query);
  const payload = await response.json();
  const rows = Array.isArray(payload?.rows) ? payload.rows : [];
  const candidates = rows.map(candidateFromRow).filter(Boolean);

  if (candidates.length === 0) {
    throw new Error("Smithsonian 3D API returned no Bell X-1 GLB candidates.");
  }

  candidates.sort((a, b) => {
    const scoreDelta = candidateScore(a) - candidateScore(b);
    if (scoreDelta !== 0) return scoreDelta;
    return a.bytes - b.bytes;
  });

  const selected = candidates[0];
  if (selected.bytes > BELL_X1.maxBytes) {
    throw new Error(
      `Best Bell X-1 GLB is larger than the ${Math.round(BELL_X1.maxBytes / 1024 / 1024)} MiB web budget.`,
    );
  }
  return selected;
}

async function downloadGlb(candidate) {
  const response = await fetchWithRetry(candidate.uri);
  const contentLength = Number(response.headers.get("content-length") ?? "0");
  if (Number.isFinite(contentLength) && contentLength > BELL_X1.maxBytes) {
    throw new Error("Bell X-1 GLB exceeds the web asset budget.");
  }

  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.byteLength > BELL_X1.maxBytes) {
    throw new Error("Bell X-1 GLB exceeds the web asset budget.");
  }
  if (
    bytes.byteLength < 12
    || bytes[0] !== 0x67
    || bytes[1] !== 0x6c
    || bytes[2] !== 0x54
    || bytes[3] !== 0x46
  ) {
    throw new Error("Downloaded Bell X-1 asset is not a valid binary glTF container.");
  }
  return bytes;
}

await mkdir(outputDir, { recursive: true });
const candidate = await discoverBellX1();
const bytes = await downloadGlb(candidate);

await writeFile(join(outputDir, "bell-x1.glb"), bytes);
await writeFile(
  join(outputDir, "bell-x1.source.json"),
  `${JSON.stringify({
    key: BELL_X1.key,
    title: BELL_X1.title,
    source: "Smithsonian Institution, National Air and Space Museum",
    sourcePage: BELL_X1.sourcePage,
    packageId: BELL_X1.packageId,
    rights: BELL_X1.rights,
    selectedQuality: candidate.quality || null,
    dracoCompressed: candidate.draco,
    gltfOrientationCompliant: candidate.orientationCompliant,
    byteLength: bytes.byteLength,
  }, null, 2)}\n`,
);

console.log(JSON.stringify({
  ok: true,
  gate: "AIRCRAFT_ASSET_SYNC",
  aircraft: BELL_X1.title,
  rights: BELL_X1.rights,
  quality: candidate.quality || "unspecified",
  draco: candidate.draco,
  orientationCompliant: candidate.orientationCompliant,
  bytes: bytes.byteLength,
}, null, 2));
