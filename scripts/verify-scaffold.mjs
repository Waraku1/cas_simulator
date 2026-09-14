import { access, readFile } from "node:fs/promises";
import { join } from "node:path";

const root = new URL("..", import.meta.url).pathname;
const required = [
  "package.json",
  "vite.config.ts",
  "wrangler.jsonc",
  "index.html",
  "src/client/main.tsx",
  "src/client/components/EarthScene.tsx",
  "src/client/diagnostics/useRuntimeDiagnostics.ts",
  "src/worker/index.ts",
  "src/shared/config.ts",
  "docs/architecture/C0_FOUNDATION.md",
];

for (const relative of required) {
  await access(join(root, relative));
}

const pkg = JSON.parse(await readFile(join(root, "package.json"), "utf8"));
if (pkg.dependencies?.cesium !== "1.145.0") throw new Error("Unexpected Cesium version");
if (!pkg.scripts?.build || !pkg.scripts?.deploy) throw new Error("Missing build/deploy scripts");

console.log(`Scaffold integrity OK (${required.length} required files).`);
