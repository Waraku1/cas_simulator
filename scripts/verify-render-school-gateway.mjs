import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

const root = new URL("..", import.meta.url).pathname;
const gatewayPath = resolve(root, "scripts/render-school-gateway.mjs");
const renderPath = resolve(root, "render.yaml");
const packagePath = resolve(root, "package.json");

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const [gateway, renderYaml, packageText] = await Promise.all([
  readFile(gatewayPath, "utf8"),
  readFile(renderPath, "utf8"),
  readFile(packagePath, "utf8"),
]);

execFileSync(process.execPath, ["--check", gatewayPath], { cwd: root, stdio: "inherit" });

for (const token of [
  'const HOST = "0.0.0.0"',
  "process.env.PORT",
  "CAS_UPSTREAM_ORIGIN",
  'upstream.protocol !== "https:"',
  "browserOriginAllowed",
  'headers.origin = upstream.origin',
  'server.on("upgrade"',
  "tls.connect",
  'pathname.startsWith("/api/")',
  "GATEWAY_ORIGIN_REJECTED",
  '"referrer-policy": "strict-origin-when-cross-origin"',
]) {
  assert(gateway.includes(token), `Render school gateway missing security/runtime contract: ${token}`);
}

assert(!gateway.includes('"referrer-policy": "no-referrer"'), "Render document must preserve an origin Referer for Cesium ion Allowed URLs");
assert(!gateway.includes("request.headers.cookie") || !gateway.includes("console.log(request.headers.cookie)"), "Gateway must not log Cookie headers");
assert(!gateway.includes("console.log(request.url"), "Gateway must not log request URLs because ranked join tokens can appear in query strings");

for (const token of [
  "type: web",
  "runtime: node",
  "NODE_VERSION",
  "22.16.0",
  "corepack enable",
  "pnpm build:render",
  "pnpm start:render",
  "healthCheckPath: /gateway-health",
  "CAS_UPSTREAM_ORIGIN",
  "CAS_PUBLIC_ORIGIN",
  "https://cas-simulator-school.onrender.com",
  "VITE_CESIUM_ION_TOKEN",
  "sync: false",
]) {
  assert(renderYaml.includes(token), `render.yaml missing required school gateway contract: ${token}`);
}

assert(!renderYaml.includes("corepack prepare"), "Render build must not depend on the deprecated corepack prepare flow");

const pkg = JSON.parse(packageText);
assert(pkg.engines?.node === ">=22.12.0 <23", "Node engine range must stay bounded to Node 22 for Render/Corepack reproducibility");
assert(pkg.scripts?.["build:render"]?.includes("vite build --config vite.client.config.ts"), "Missing client-only Render build script");
assert(pkg.scripts?.["start:render"] === "node scripts/render-school-gateway.mjs", "Missing Render gateway start script");
assert(pkg.scripts?.["verify:render:school"] === "node scripts/verify-render-school-gateway.mjs", "Missing Render gateway verifier script");

console.log(JSON.stringify({
  ok: true,
  gate: "RENDER_SCHOOL_GATEWAY_CONTRACT",
  upstreamHttpsOnly: true,
  sameOriginBrowserBoundary: true,
  httpProxy: true,
  websocketProxy: true,
}, null, 2));
