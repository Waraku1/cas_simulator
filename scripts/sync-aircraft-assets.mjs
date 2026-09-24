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
  // Wrangler rejects individual Worker assets over 25 MiB. Reserve 1 MiB
  // for source metadata variance and the normalization JSON rewrite.
  maxBytes: 24 * 1024 * 1024,
  // Smithsonian object metadata: H 3.264 m × L 9.373 m × W 8.534 m.
  // The source GLB is a digitization asset whose coordinate units are not
  // guaranteed to be meters, so normalize the scene to the authoritative
  // longest physical dimension before Cesium renders it.
  targetLongestDimensionM: 9.373,
});


const GLB_JSON_CHUNK_TYPE = 0x4e4f534a;

function identityMatrix4() {
  return [
    1, 0, 0, 0,
    0, 1, 0, 0,
    0, 0, 1, 0,
    0, 0, 0, 1,
  ];
}

function multiplyMatrix4(a, b) {
  const out = new Array(16).fill(0);
  for (let column = 0; column < 4; column += 1) {
    for (let row = 0; row < 4; row += 1) {
      let value = 0;
      for (let k = 0; k < 4; k += 1) {
        value += a[k * 4 + row] * b[column * 4 + k];
      }
      out[column * 4 + row] = value;
    }
  }
  return out;
}

function nodeMatrix(node) {
  if (Array.isArray(node?.matrix) && node.matrix.length === 16) {
    return node.matrix.map(Number);
  }

  const translation = Array.isArray(node?.translation) ? node.translation.map(Number) : [0, 0, 0];
  const rotation = Array.isArray(node?.rotation) ? node.rotation.map(Number) : [0, 0, 0, 1];
  const scale = Array.isArray(node?.scale) ? node.scale.map(Number) : [1, 1, 1];
  const [x, y, z, w] = rotation;
  const [sx, sy, sz] = scale;

  const xx = x * x;
  const yy = y * y;
  const zz = z * z;
  const xy = x * y;
  const xz = x * z;
  const yz = y * z;
  const wx = w * x;
  const wy = w * y;
  const wz = w * z;

  return [
    (1 - 2 * (yy + zz)) * sx,
    (2 * (xy + wz)) * sx,
    (2 * (xz - wy)) * sx,
    0,
    (2 * (xy - wz)) * sy,
    (1 - 2 * (xx + zz)) * sy,
    (2 * (yz + wx)) * sy,
    0,
    (2 * (xz + wy)) * sz,
    (2 * (yz - wx)) * sz,
    (1 - 2 * (xx + yy)) * sz,
    0,
    translation[0],
    translation[1],
    translation[2],
    1,
  ];
}

function transformPoint(matrix, point) {
  const [x, y, z] = point;
  return [
    matrix[0] * x + matrix[4] * y + matrix[8] * z + matrix[12],
    matrix[1] * x + matrix[5] * y + matrix[9] * z + matrix[13],
    matrix[2] * x + matrix[6] * y + matrix[10] * z + matrix[14],
  ];
}

function parseGlb(buffer) {
  if (buffer.length < 20 || buffer.toString("utf8", 0, 4) !== "glTF") {
    throw new Error("Downloaded Bell X-1 asset is not a valid binary glTF container.");
  }
  const version = buffer.readUInt32LE(4);
  if (version !== 2) throw new Error(`Unsupported GLB version: ${version}`);

  const chunks = [];
  let offset = 12;
  while (offset + 8 <= buffer.length) {
    const length = buffer.readUInt32LE(offset);
    const type = buffer.readUInt32LE(offset + 4);
    const start = offset + 8;
    const end = start + length;
    if (end > buffer.length) throw new Error("GLB chunk length exceeds container length.");
    chunks.push({ type, data: buffer.subarray(start, end) });
    offset = end;
  }

  const jsonChunk = chunks.find((chunk) => chunk.type === GLB_JSON_CHUNK_TYPE);
  if (!jsonChunk) throw new Error("GLB has no JSON chunk.");
  const jsonText = jsonChunk.data.toString("utf8").replace(/[\u0000\u0020]+$/g, "");
  return { gltf: JSON.parse(jsonText), chunks };
}

function defaultSceneRoots(gltf) {
  if (Array.isArray(gltf.scenes) && gltf.scenes.length > 0) {
    const index = Number.isInteger(gltf.scene) ? gltf.scene : 0;
    const scene = gltf.scenes[index];
    if (scene && Array.isArray(scene.nodes)) return [...scene.nodes];
  }

  const referenced = new Set();
  for (const node of gltf.nodes ?? []) {
    for (const child of node?.children ?? []) referenced.add(child);
  }
  return (gltf.nodes ?? []).map((_, index) => index).filter((index) => !referenced.has(index));
}

function sceneBounds(gltf) {
  const minimum = [Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY];
  const maximum = [Number.NEGATIVE_INFINITY, Number.NEGATIVE_INFINITY, Number.NEGATIVE_INFINITY];
  let positionAccessorCount = 0;

  const includePoint = (point) => {
    for (let axis = 0; axis < 3; axis += 1) {
      minimum[axis] = Math.min(minimum[axis], point[axis]);
      maximum[axis] = Math.max(maximum[axis], point[axis]);
    }
  };

  const visit = (nodeIndex, parentMatrix, path) => {
    if (path.has(nodeIndex)) throw new Error("GLB node hierarchy contains a cycle.");
    const node = gltf.nodes?.[nodeIndex];
    if (!node) return;

    const nextPath = new Set(path);
    nextPath.add(nodeIndex);
    const world = multiplyMatrix4(parentMatrix, nodeMatrix(node));

    if (Number.isInteger(node.mesh)) {
      const mesh = gltf.meshes?.[node.mesh];
      for (const primitive of mesh?.primitives ?? []) {
        const accessorIndex = primitive?.attributes?.POSITION;
        const accessor = Number.isInteger(accessorIndex) ? gltf.accessors?.[accessorIndex] : null;
        if (!accessor || !Array.isArray(accessor.min) || !Array.isArray(accessor.max)) continue;
        if (accessor.min.length < 3 || accessor.max.length < 3) continue;
        positionAccessorCount += 1;
        const [minX, minY, minZ] = accessor.min.map(Number);
        const [maxX, maxY, maxZ] = accessor.max.map(Number);
        for (const x of [minX, maxX]) {
          for (const y of [minY, maxY]) {
            for (const z of [minZ, maxZ]) includePoint(transformPoint(world, [x, y, z]));
          }
        }
      }
    }

    for (const child of node.children ?? []) visit(child, world, nextPath);
  };

  for (const rootNode of defaultSceneRoots(gltf)) {
    visit(rootNode, identityMatrix4(), new Set());
  }

  if (
    positionAccessorCount === 0
    || minimum.some((value) => !Number.isFinite(value))
    || maximum.some((value) => !Number.isFinite(value))
  ) {
    throw new Error("Could not derive Bell X-1 scene bounds from POSITION accessors.");
  }

  const span = maximum.map((value, axis) => value - minimum[axis]);
  const center = maximum.map((value, axis) => (value + minimum[axis]) / 2);
  const longest = Math.max(...span);
  if (!(longest > 0)) throw new Error("Bell X-1 scene bounds are degenerate.");

  return { minimum, maximum, span, center, longest, positionAccessorCount };
}

function normalizationMatrix(scale, center) {
  return [
    scale, 0, 0, 0,
    0, scale, 0, 0,
    0, 0, scale, 0,
    -scale * center[0],
    -scale * center[1],
    -scale * center[2],
    1,
  ];
}

function normalizeGlbToLongestDimension(buffer, targetLongestDimensionM) {
  const { gltf, chunks } = parseGlb(buffer);
  const sourceBounds = sceneBounds(gltf);
  const scale = targetLongestDimensionM / sourceBounds.longest;
  if (!Number.isFinite(scale) || scale <= 0 || scale > 10) {
    throw new Error(`Computed Bell X-1 normalization scale is invalid: ${scale}`);
  }

  const roots = defaultSceneRoots(gltf);
  const normalize = normalizationMatrix(scale, sourceBounds.center);
  for (const rootIndex of new Set(roots)) {
    const node = gltf.nodes?.[rootIndex];
    if (!node) continue;
    node.matrix = multiplyMatrix4(normalize, nodeMatrix(node));
    delete node.translation;
    delete node.rotation;
    delete node.scale;
  }

  const json = Buffer.from(JSON.stringify(gltf), "utf8");
  const jsonPadding = (4 - (json.length % 4)) % 4;
  const paddedJson = Buffer.concat([json, Buffer.alloc(jsonPadding, 0x20)]);

  const rebuiltChunks = chunks.map((chunk) => (
    chunk.type === GLB_JSON_CHUNK_TYPE ? { type: chunk.type, data: paddedJson } : chunk
  ));
  const totalLength = 12 + rebuiltChunks.reduce((sum, chunk) => sum + 8 + chunk.data.length, 0);
  const output = Buffer.alloc(totalLength);
  output.write("glTF", 0, "ascii");
  output.writeUInt32LE(2, 4);
  output.writeUInt32LE(totalLength, 8);

  let offset = 12;
  for (const chunk of rebuiltChunks) {
    output.writeUInt32LE(chunk.data.length, offset);
    output.writeUInt32LE(chunk.type, offset + 4);
    chunk.data.copy(output, offset + 8);
    offset += 8 + chunk.data.length;
  }

  const normalizedBounds = {
    spanM: sourceBounds.span.map((value) => value * scale),
    longestM: sourceBounds.longest * scale,
  };

  return {
    buffer: output,
    sourceBounds,
    normalizedBounds,
    scale,
  };
}

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
  const deployable = candidates.filter((candidate) => (
    candidate.orientationCompliant && (candidate.bytes <= BELL_X1.maxBytes || !Number.isFinite(candidate.bytes))
  ));

  if (deployable.length === 0) {
    throw new Error(
      `No potentially deployable orientation-compliant Bell X-1 GLB fits the ${Math.round(BELL_X1.maxBytes / 1024 / 1024)} MiB Worker asset budget. Candidate sizes (MiB): ${candidates.map((candidate) => Math.round(candidate.bytes / 1024 / 1024)).join(", ")}.`,
    );
  }

  deployable.sort((a, b) => {
    const scoreDelta = candidateScore(a) - candidateScore(b);
    if (scoreDelta !== 0) return scoreDelta;
    return a.bytes - b.bytes;
  });

  return deployable;
}

async function downloadGlb(candidate) {
  const response = await fetchWithRetry(candidate.uri);
  const contentLength = Number(response.headers.get("content-length") ?? "0");
  if (Number.isFinite(contentLength) && contentLength > BELL_X1.maxBytes) {
    await response.body?.cancel();
    return null;
  }

  if (!response.body) throw new Error("Bell X-1 GLB response has no body.");
  const reader = response.body.getReader();
  const chunks = [];
  let totalBytes = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    totalBytes += value.byteLength;
    if (totalBytes > BELL_X1.maxBytes) {
      await reader.cancel();
      return null;
    }
    chunks.push(Buffer.from(value));
  }
  const bytes = Buffer.concat(chunks, totalBytes);
  if (bytes.byteLength < 12 || bytes.toString("utf8", 0, 4) !== "glTF") {
    throw new Error("Downloaded Bell X-1 asset is not a valid binary glTF container.");
  }
  return bytes;
}

await mkdir(outputDir, { recursive: true });
const candidates = await discoverBellX1();
let chosen = null;
for (const candidate of candidates) {
  const sourceBytes = await downloadGlb(candidate);
  if (!sourceBytes) {
    console.log(`Bell X-1 candidate skipped (over 24 MiB): ${candidate.quality || "unspecified"}`);
    continue;
  }
  const normalized = normalizeGlbToLongestDimension(
    sourceBytes,
    BELL_X1.targetLongestDimensionM,
  );
  if (normalized.buffer.byteLength > BELL_X1.maxBytes) {
    console.log(`Normalized Bell X-1 GLB exceeds the 24 MiB Worker asset budget: ${candidate.quality || "unspecified"}`);
    continue;
  }
  chosen = { candidate, sourceBytes, normalized };
  break;
}
if (!chosen) {
  throw new Error("No official orientation-compliant Bell X-1 GLB fits the 24 MiB Worker asset budget.");
}
const { candidate, sourceBytes, normalized } = chosen;
const bytes = normalized.buffer;

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
    sourceByteLength: sourceBytes.byteLength,
    sourceBounds: normalized.sourceBounds,
    normalizationScale: normalized.scale,
    normalizedBoundsM: normalized.normalizedBounds,
    targetLongestDimensionM: BELL_X1.targetLongestDimensionM,
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
  sourceLongestUnits: normalized.sourceBounds.longest,
  sourceSpanUnits: normalized.sourceBounds.span,
  normalizationScale: normalized.scale,
  normalizedSpanM: normalized.normalizedBounds.spanM,
  normalizedLongestM: normalized.normalizedBounds.longestM,
}, null, 2));
