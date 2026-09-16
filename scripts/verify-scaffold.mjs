import { access, readFile } from "node:fs/promises";
import { join } from "node:path";

const root = new URL("..", import.meta.url).pathname;
const required = [
  "package.json",
  "vite.config.ts",
  "vite.client.config.ts",
  "vite.school.config.ts",
  "wrangler.jsonc",
  "index.html",
  "src/client/main.tsx",
  "src/client/components/EarthScene.tsx",
  "src/client/components/TheaterStatusPanel.tsx",
  "src/client/components/MultiplayerPanel.tsx",
  "src/client/diagnostics/useRuntimeDiagnostics.ts",
  "src/client/multiplayer/useMultiplayer.ts",
  "src/client/product/ProductPreview.tsx",
  "src/client/product/useMatchmaking.ts",
  "src/client/product/useRankedMatch.ts",
  "src/client/theater/model.ts",
  "src/client/c3.css",
  "src/worker/index.ts",
  "src/worker/ranked-match.ts",
  "src/worker/competition-runtime.ts",
  "src/shared/config.ts",
  "src/shared/multiplayer.ts",
  "src/shared/product.ts",
  "src/shared/aircraft.ts",
  "src/shared/aircraft-catalog.json",
  "src/shared/action-modules.ts",
  "src/shared/action-module-catalog.json",
  "src/shared/competition.ts",
  "src/shared/matchmaking.ts",
  "scripts/dev-school.mjs",
  "scripts/school-local-backend.mjs",
  "scripts/school-ranked-runtime.mjs",
  "scripts/verify-production-multiplayer.mjs",
  "scripts/verify-school-matchmaking.mjs",
  "scripts/verify-school-competition.mjs",
  "scripts/verify-c4c-runtime.mjs",
  "docs/architecture/C0_FOUNDATION.md",
  "docs/architecture/C1_FLIGHT.md",
  "docs/architecture/C2_WORLD_THEATER.md",
  "docs/architecture/C3_MULTIPLAYER.md",
  "docs/architecture/C4_PRODUCT_CONTRACT.md",
];

for (const relative of required) {
  await access(join(root, relative));
}

const pkg = JSON.parse(await readFile(join(root, "package.json"), "utf8"));
if (pkg.dependencies?.cesium !== "1.145.0") throw new Error("Unexpected Cesium version");
if (!pkg.scripts?.build || !pkg.scripts?.deploy) throw new Error("Missing build/deploy scripts");
if (!pkg.scripts?.["dev:school"]?.includes("scripts/dev-school.mjs")) {
  throw new Error("School mode must use the OS-compatible Node local relay launcher");
}
if (!pkg.scripts?.["verify:school"]) throw new Error("Missing school multiplayer verification script");
if (!pkg.scripts?.["verify:school:c4b"]) throw new Error("Missing C4B school matchmaking verification script");
if (!pkg.scripts?.["verify:school:c4c"] || !pkg.scripts?.["verify:c4c:runtime"]) {
  throw new Error("Missing C4C competition verification scripts");
}

const schoolConfig = await readFile(join(root, "vite.school.config.ts"), "utf8");
if (!schoolConfig.includes('target: "http://127.0.0.1:8787"') || !schoolConfig.includes("ws: true")) {
  throw new Error("School Vite config must proxy HTTP/WebSocket API traffic to the local relay");
}

const wrangler = await readFile(join(root, "wrangler.jsonc"), "utf8");
if (!wrangler.includes('"name": "ROOMS"')) throw new Error("Missing C3 Durable Object binding");
if (!wrangler.includes('"new_sqlite_classes": ["MultiplayerRoom"]')) {
  throw new Error("Missing C3 SQLite Durable Object migration");
}
if (!wrangler.includes('"name": "MATCHMAKER"') || !wrangler.includes('"new_sqlite_classes": ["RankedMatchmaker"]')) {
  throw new Error("Missing C4B ranked matchmaker Durable Object contract");
}
if (!wrangler.includes('"name": "MATCHES"') || !wrangler.includes('"new_sqlite_classes": ["RankedMatch"]')) {
  throw new Error("Missing C4C ranked match Durable Object contract");
}

const rankedClient = await readFile(join(root, "src/client/product/useRankedMatch.ts"), "utf8");
if (!rankedClient.includes("/api/matches/") || !rankedClient.includes("joinToken")) {
  throw new Error("C4C product client must use tokenized RankedMatch transport");
}

const deployWorkflow = await readFile(join(root, ".github/workflows/deploy.yml"), "utf8");
if (!deployWorkflow.includes("verify-production-multiplayer.mjs")) {
  throw new Error("Missing C3 production multiplayer deploy verification");
}

console.log(`Scaffold integrity OK (${required.length} required files).`);
