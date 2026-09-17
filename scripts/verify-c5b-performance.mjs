import { readFileSync } from "node:fs";

function read(path) {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
}

const config = read("src/shared/config.ts");
const diagnostics = read("src/client/diagnostics/useRuntimeDiagnostics.ts");
const probe = read("src/client/diagnostics/PerformanceEvidenceProbe.tsx");
const flightRuntime = read("src/client/FlightRuntime.tsx");
const earthScene = read("src/client/components/EarthScene.tsx");
const evidenceRunbook = read("docs/operations/C5B_PERFORMANCE_EVIDENCE.md");

const checks = [
  ["45 FPS target remains frozen", config.includes("targetFps: 45")],
  ["30 FPS floor remains frozen", config.includes("minimumFps: 30")],
  ["60 FPS runtime cap remains frozen", config.includes("runtimeFrameCapFps: 60")],
  ["3 minute preflight remains frozen", config.includes("preflightMinutes: 3")],
  ["30 minute benchmark remains frozen", config.includes("benchmarkMinutes: 30")],
  ["150 MiB observed-transfer target remains frozen", config.includes("targetTransferMiBPerPlayerSession: 150")],
  ["FPS is measured from Cesium rendered frames", earthScene.includes("postRender.addEventListener(recordRenderedFrame)")],
  ["product mode mounts a headless performance probe", flightRuntime.includes("!showDevelopmentPanels && <PerformanceEvidenceProbe />")],
  ["headless probe reuses canonical runtime diagnostics", probe.includes("useRuntimeDiagnostics()")],
  ["performance evidence is exposed for capture", diagnostics.includes("__CAS_PERFORMANCE_EVIDENCE__")],
  ["evidence records target and floor status", diagnostics.includes("targetFpsMet") && diagnostics.includes("minimumFpsMet")],
  ["evidence records observed transfer budget status", diagnostics.includes("transferBudgetMet")],
  ["background-tab throttling is excluded", diagnostics.includes('document.visibilityState === "visible"')],
  ["runbook requires C4 product-load evidence", evidenceRunbook.includes("two-browser ranked product run")],
  ["runbook requires the sustained C2 benchmark", evidenceRunbook.includes("30-minute sustained benchmark")],
  ["runbook preserves frozen product semantics", evidenceRunbook.includes("No C1-C4 product semantics are changed")],
];

const failures = checks.filter(([, passed]) => !passed);
for (const [label, passed] of checks) {
  console.log(`${passed ? "PASS" : "FAIL"} ${label}`);
}

if (failures.length > 0) {
  console.error(`C5B verification failed: ${failures.length} check(s).`);
  process.exit(1);
}

console.log(`C5B verification passed: ${checks.length} checks.`);
