import { execFileSync } from "node:child_process";
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
  "migrations/0001_c4a_accounts.sql",
  "migrations/0002_c4d_rating.sql",
  "src/client/main.tsx",
  "src/client/App.tsx",
  "src/client/components/EarthScene.tsx",
  "src/client/components/TheaterStatusPanel.tsx",
  "src/client/components/MultiplayerPanel.tsx",
  "src/client/diagnostics/useRuntimeDiagnostics.ts",
  "src/client/multiplayer/useMultiplayer.ts",
  "src/client/product/ProductPreview.tsx",
  "src/client/product/ProductLive.tsx",
  "src/client/product/useAccount.ts",
  "src/client/product/useMatchmaking.ts",
  "src/client/product/useRankedMatch.ts",
  "src/client/theater/model.ts",
  "src/client/c3.css",
  "src/worker/app.ts",
  "src/worker/index.ts",
  "src/worker/ranked-match.ts",
  "src/worker/ranked-match-integrity.ts",
  "src/worker/competition-runtime.ts",
  "src/worker/auth/crypto.ts",
  "src/worker/auth/repository.ts",
  "src/worker/auth/service.ts",
  "src/worker/rating/repository.ts",
  "src/shared/auth.ts",
  "src/shared/config.ts",
  "src/shared/multiplayer.ts",
  "src/shared/product.ts",
  "src/shared/rating.ts",
  "src/shared/aircraft.ts",
  "src/shared/aircraft-catalog.json",
  "src/shared/aircraft-visuals.ts",
  "src/shared/action-modules.ts",
  "src/shared/action-module-catalog.json",
  "src/shared/competition.ts",
  "src/shared/matchmaking.ts",
  "scripts/dev-school.mjs",
  "scripts/sync-aircraft-assets.mjs",
  "scripts/render-school-gateway.mjs",
  "scripts/verify-render-school-gateway.mjs",
  "scripts/verify-render-cesium-token.mjs",
  "render.yaml",
  "docs/operations/RENDER_SCHOOL_GATEWAY.md",
  "scripts/school-local-backend.mjs",
  "scripts/school-account-backend.mjs",
  "scripts/school-account-store.mjs",
  "scripts/school-ranked-runtime.mjs",
  "scripts/school-ranked-product-backend.mjs",
  "scripts/verify-production-multiplayer.mjs",
  "scripts/verify-production-rated-product.mjs",
  "scripts/verify-school-matchmaking.mjs",
  "scripts/verify-school-competition.mjs",
  "scripts/verify-school-accounts.mjs",
  "scripts/verify-school-rated-product.mjs",
  "scripts/verify-c4c-runtime.mjs",
  "docs/architecture/C0_FOUNDATION.md",
  "docs/architecture/C1_FLIGHT.md",
  "docs/architecture/C2_WORLD_THEATER.md",
  "docs/architecture/C3_MULTIPLAYER.md",
  "docs/architecture/C4_PRODUCT_CONTRACT.md",
  "docs/architecture/C4D_RATING.md",
];

for (const relative of required) {
  await access(join(root, relative));
}

execFileSync(process.execPath, ["--check", join(root, "scripts/verify-production-rated-product.mjs")], {
  stdio: "inherit",
});

const pkg = JSON.parse(await readFile(join(root, "package.json"), "utf8"));
if (pkg.dependencies?.cesium !== "1.145.0") throw new Error("Unexpected Cesium version");
if (!pkg.scripts?.build || !pkg.scripts?.deploy) throw new Error("Missing build/deploy scripts");
if (!pkg.scripts?.["sync:aircraft"]?.includes("sync-aircraft-assets.mjs")) {
  throw new Error("Missing authoritative aircraft asset synchronization script");
}
for (const scriptName of ["predev", "dev:school", "prebuild", "build:render"]) {
  if (!pkg.scripts?.[scriptName]?.includes("sync:aircraft")) {
    throw new Error(`${scriptName} must synchronize aircraft assets before serving/building`);
  }
}
if (!pkg.scripts?.["dev:school"]?.includes("scripts/dev-school.mjs")) {
  throw new Error("School mode must use the OS-compatible Node local relay launcher");
}
if (!pkg.scripts?.["verify:school"]) throw new Error("Missing school multiplayer verification script");
if (!pkg.scripts?.["verify:school:c4b"]) throw new Error("Missing C4B school matchmaking verification script");
if (!pkg.scripts?.["verify:school:c4c"] || !pkg.scripts?.["verify:c4c:runtime"]) {
  throw new Error("Missing C4C competition verification scripts");
}
if (!pkg.scripts?.["verify:school:c4d"] || !pkg.scripts?.["verify:school:c4d:ranked"]) {
  throw new Error("Missing C4D school account/rated-product verification scripts");
}
if (!pkg.scripts?.["build:render"] || !pkg.scripts?.["start:render"] || !pkg.scripts?.["verify:render:school"]) {
  throw new Error("Missing Render multi-device school gateway scripts");
}
if (!pkg.scripts?.["verify:production:c4d"]?.includes("verify-production-rated-product.mjs")) {
  throw new Error("Missing C4D production rated-product verification command");
}

const appShell = await readFile(join(root, "src/client/App.tsx"), "utf8");
if (!appShell.includes('const devFlight = params.get("devFlight") === "1";')) {
  throw new Error("Raw flight development UI must require explicit ?devFlight=1 opt-in");
}
if (!appShell.includes("if (devFlight) return <FlightRuntime />;")) {
  throw new Error("Explicit devFlight route must render the raw FlightRuntime");
}
if (!appShell.includes("{staticPreview ? <ProductPreview /> : <ProductLive />}")) {
  throw new Error("Normal application entrypoint must default to ProductLive");
}
if (appShell.includes('const productPreview = params.get("productPreview") === "1";')) {
  throw new Error("ProductLive must not remain hidden behind the legacy productPreview query gate");
}

const schoolConfig = await readFile(join(root, "vite.school.config.ts"), "utf8");
if (!schoolConfig.includes('target: "http://127.0.0.1:8787"') || !schoolConfig.includes("ws: true")) {
  throw new Error("School Vite config must retain the C3/C4C legacy relay path");
}
if (!schoolConfig.includes('target: "http://127.0.0.1:8788"')) {
  throw new Error("School Vite config must proxy account API traffic to the local account adapter");
}
if (!schoolConfig.includes('target: "http://127.0.0.1:8789"') || !schoolConfig.includes('"/api/matchmaking"')) {
  throw new Error("School Vite config must route product matchmaking/matches through authenticated ranked backend");
}

const launcher = await readFile(join(root, "scripts/dev-school.mjs"), "utf8");
if (!launcher.includes("school-ranked-product-backend.mjs") || !launcher.includes("SCHOOL_INTERNAL_TOKEN")) {
  throw new Error("School launcher must start the authenticated ranked backend with an internal-only token");
}

const wrangler = await readFile(join(root, "wrangler.jsonc"), "utf8");
if (!wrangler.includes('"main": "./src/worker/app.ts"')) throw new Error("Worker must use the account-aware app entry");
if (!wrangler.includes('"name": "ROOMS"')) throw new Error("Missing C3 Durable Object binding");
if (!wrangler.includes('"new_sqlite_classes": ["MultiplayerRoom"]')) throw new Error("Missing C3 SQLite Durable Object migration");
if (!wrangler.includes('"name": "MATCHMAKER"') || !wrangler.includes('"new_sqlite_classes": ["RankedMatchmaker"]')) throw new Error("Missing C4B ranked matchmaker Durable Object contract");
if (!wrangler.includes('"name": "MATCHES"') || !wrangler.includes('"new_sqlite_classes": ["RankedMatch"]')) throw new Error("Missing C4C ranked match Durable Object contract");

const rankedClient = await readFile(join(root, "src/client/product/useRankedMatch.ts"), "utf8");
if (!rankedClient.includes("/api/matches/") || !rankedClient.includes("joinToken")) throw new Error("C4C product client must use tokenized RankedMatch transport");

const accountClient = await readFile(join(root, "src/client/product/useAccount.ts"), "utf8");
if (!accountClient.includes("/api/auth") && !accountClient.includes("ACCOUNT_API")) throw new Error("C4D product client must use live account APIs");

const workerApp = await readFile(join(root, "src/worker/app.ts"), "utf8");
if (!workerApp.includes("authenticateRequest") || !workerApp.includes('headers.set(AUTHENTICATED_USER_HEADER, user.userId)')) {
  throw new Error("C4D production Worker must authenticate ranked transport and overwrite public identity headers");
}
if (!workerApp.includes('headers.set(FIXED_AIRCRAFT_HEADER, user.fixedAircraftId ?? "")')) {
  throw new Error("C4D production Worker must inject fixed-aircraft state from the authenticated account");
}
if (!workerApp.includes('from "./ranked-match-integrity"')) {
  throw new Error("C4D production Worker must export the active-match integrity wrapped RankedMatch");
}

const matchmaker = await readFile(join(root, "src/worker/index.ts"), "utf8");
if (!matchmaker.includes("accountUserId: first.attachment.userId") || !matchmaker.includes("randomAssignment:")) {
  throw new Error("C4D production match init must carry server-only account/provenance metadata");
}
if (matchmaker.includes("fixedAircraftId: parsed.fixedAircraftId")) {
  throw new Error("C4D production matchmaking must not trust client-supplied fixedAircraftId");
}
if (!matchmaker.includes("entry.attachment.userId !== first.attachment.userId")) {
  throw new Error("C4D production matchmaking must reject same-account pairing");
}
if (!matchmaker.includes("ACTIVE_MATCHES_KEY") || !matchmaker.includes("account_in_active_match") || !matchmaker.includes("MATCH_COMPLETE_PATH")) {
  throw new Error("C4D production matchmaking must enforce and release one active rated match per account");
}

const rankedAuthority = await readFile(join(root, "src/worker/ranked-match.ts"), "utf8");
if (!rankedAuthority.includes("D1RatingRepository") || !rankedAuthority.includes("RATING_FINALIZED_KEY") || !rankedAuthority.includes("RATING_RETRY_MS")) {
  throw new Error("C4D RankedMatch must contain idempotent D1 result finalization with retry scheduling");
}
if (!rankedAuthority.includes("updateFixableAircraft") || !rankedAuthority.includes("invalid_participant_identity")) {
  throw new Error("C4D RankedMatch must enforce participant identity and post-match fixable-aircraft persistence");
}

const rankedIntegrity = await readFile(join(root, "src/worker/ranked-match-integrity.ts"), "utf8");
if (!rankedIntegrity.includes("ACCOUNT_FINALIZED_KEY") || !rankedIntegrity.includes("ACTIVE_MATCH_LOCK_RELEASED_KEY")) {
  throw new Error("C4D RankedMatch integrity wrapper must wait for account finalization and persist lock-release completion");
}
if (!rankedIntegrity.includes("MATCH_COMPLETE_URL") || !rankedIntegrity.includes("setAlarm(Date.now() + LOCK_RETRY_MS)")) {
  throw new Error("C4D active-match lock release must retry through Durable Object alarms");
}

const competitionRuntime = await readFile(join(root, "src/worker/competition-runtime.ts"), "utf8");
const snapshotSource = competitionRuntime.split("export function competitionSnapshot")[1]?.split("export function nextCompetitionDeadline")[0] ?? "";
if (!competitionRuntime.includes("accountUserId: string | null") || !competitionRuntime.includes("randomAssignment: boolean")) {
  throw new Error("C4D competition runtime must persist server-only account/provenance metadata");
}
if (snapshotSource.includes("accountUserId") || snapshotSource.includes("randomAssignment")) {
  throw new Error("C4D server-only account/provenance metadata must not appear in client competition snapshots");
}
if (!competitionRuntime.includes("disconnectDeadlineMs: init.activeAtMs + disconnectGraceMs")) {
  throw new Error("C4D production runtime must bound the initial participant connection window");
}

const schoolRuntime = await readFile(join(root, "scripts/school-ranked-runtime.mjs"), "utf8");
if (!schoolRuntime.includes("disconnectDeadlineMs: init.activeAtMs + DISCONNECT_GRACE_MS")) {
  throw new Error("C4D school runtime must mirror the production initial connection grace");
}

const productionRatedSmoke = await readFile(join(root, "scripts/verify-production-rated-product.mjs"), "utf8");
for (const evidence of [
  "account_in_active_match",
  "fixableAircraftId === null",
  "duplicateResultIgnored",
  "activeMatchLockReleased",
  "fixedAircraftRematchPersisted",
  "C4D_PRODUCTION_RATED_PRODUCT_SMOKE",
]) {
  if (!productionRatedSmoke.includes(evidence)) {
    throw new Error(`C4D production rated smoke is missing evidence: ${evidence}`);
  }
}

const deployWorkflow = await readFile(join(root, ".github/workflows/deploy.yml"), "utf8");
if (!deployWorkflow.includes("verify-production-multiplayer.mjs")) throw new Error("Missing C3 production multiplayer deploy verification");
if (!deployWorkflow.includes("C4D_RATED_PRODUCTION_GATE") || !deployWorkflow.includes("verify:production:c4d")) {
  throw new Error("C4D production rated smoke must be gated into the deploy workflow");
}
if (!deployWorkflow.includes("C4D_PRODUCTION_SMOKE_CLEANUP=PASS") || !deployWorkflow.includes("DELETE FROM rated_matches")) {
  throw new Error("C4D production smoke must clean up rated-match and account test rows");
}

console.log(`Scaffold integrity OK (${required.length} required files).`);
