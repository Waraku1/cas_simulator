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
  "src/client/theater/model.ts",
  "src/client/c3.css",
  "src/worker/index.ts",
  "src/shared/config.ts",
  "src/shared/multiplayer.ts",
  "scripts/dev-school.mjs",
  "scripts/school-local-backend.mjs",
  "scripts/verify-production-multiplayer.mjs",
  "docs/architecture/C0_FOUNDATION.md",
  "docs/architecture/C1_FLIGHT.md",
  "docs/architecture/C2_WORLD_THEATER.md",
  "docs/architecture/C3_MULTIPLAYER.md",
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

const schoolConfig = await readFile(join(root, "vite.school.config.ts"), "utf8");
if (!schoolConfig.includes('target: "http://127.0.0.1:8787"') || !schoolConfig.includes("ws: true")) {
  throw new Error("School Vite config must proxy HTTP/WebSocket API traffic to the local relay");
}

const wrangler = await readFile(join(root, "wrangler.jsonc"), "utf8");
if (!wrangler.includes('"name": "ROOMS"')) throw new Error("Missing C3 Durable Object binding");
if (!wrangler.includes('"new_sqlite_classes": ["MultiplayerRoom"]')) {
  throw new Error("Missing C3 SQLite Durable Object migration");
}

const deployWorkflow = await readFile(join(root, ".github/workflows/deploy.yml"), "utf8");
if (!deployWorkflow.includes("verify-production-multiplayer.mjs")) {
  throw new Error("Missing C3 production multiplayer deploy verification");
}

console.log(`Scaffold integrity OK (${required.length} required files).`);
