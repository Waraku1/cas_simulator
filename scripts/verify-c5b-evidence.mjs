import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const root = new URL("..", import.meta.url).pathname;
const templatePath = resolve(root, "docs/evidence/templates/c5b-performance.template.json");
const runbookPath = resolve(root, "docs/operations/C5B_PERFORMANCE_EVIDENCE.md");
const TARGET_FPS = 45;
const MINIMUM_FPS = 30;
const MAX_TRANSFER_MIB = 150;

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function nonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function finiteNumber(value) {
  return typeof value === "number" && Number.isFinite(value);
}

function validateSnapshot(snapshot, label, { minimumSeconds, benchmarkRequired = false } = {}) {
  assert(snapshot && typeof snapshot === "object", `${label} snapshot is required`);
  assert(nonEmptyString(snapshot.capturedAt) && Number.isFinite(Date.parse(snapshot.capturedAt)), `${label}.capturedAt must be a valid timestamp`);
  for (const key of ["fps", "averageFps", "minimumFps", "transferredMiB", "resourceCount", "opaqueCrossOriginResourceCount", "zeroTransferResourceCount", "sessionSeconds", "targetFps", "minimumRequiredFps", "targetTransferMiBPerPlayerSession"]) {
    assert(finiteNumber(snapshot[key]), `${label}.${key} must be a finite number`);
  }
  assert(snapshot.targetFps === TARGET_FPS, `${label}.targetFps must remain ${TARGET_FPS}`);
  assert(snapshot.minimumRequiredFps === MINIMUM_FPS, `${label}.minimumRequiredFps must remain ${MINIMUM_FPS}`);
  assert(snapshot.targetTransferMiBPerPlayerSession === MAX_TRANSFER_MIB, `${label}.targetTransferMiBPerPlayerSession must remain ${MAX_TRANSFER_MIB}`);
  assert(snapshot.averageFps >= TARGET_FPS, `${label}.averageFps is below ${TARGET_FPS}`);
  assert(snapshot.minimumFps >= MINIMUM_FPS, `${label}.minimumFps is below ${MINIMUM_FPS}`);
  assert(snapshot.transferredMiB <= MAX_TRANSFER_MIB, `${label}.transferredMiB exceeds ${MAX_TRANSFER_MIB}`);
  assert(snapshot.targetFpsMet === true, `${label}.targetFpsMet is not true`);
  assert(snapshot.minimumFpsMet === true, `${label}.minimumFpsMet is not true`);
  assert(snapshot.transferBudgetMet === true, `${label}.transferBudgetMet is not true`);
  assert(snapshot.sessionSeconds >= minimumSeconds, `${label}.sessionSeconds is below required ${minimumSeconds}`);
  if (benchmarkRequired) assert(snapshot.benchmarkComplete === true, `${label}.benchmarkComplete is not true`);
}

function validateCommon(record) {
  assert(record && typeof record === "object", "C5B evidence must be a JSON object");
  assert(record.gate === "C5B_PERFORMANCE_EVIDENCE", "Unexpected C5B evidence gate identifier");
  assert(record.environment && typeof record.environment === "object", "C5B environment metadata is required");
  assert(record.preflight && typeof record.preflight === "object", "C5B preflight evidence is required");
  assert(record.sustained && typeof record.sustained === "object", "C5B sustained evidence is required");
  assert(record.rankedProduct && typeof record.rankedProduct === "object", "C5B rankedProduct evidence is required");
  assert(typeof record.overallNotes === "string", "C5B overallNotes must be a string");
}

async function validateContract() {
  const template = JSON.parse(await readFile(templatePath, "utf8"));
  validateCommon(template);
  assert(template.releaseSha === "", "C5B template releaseSha must remain blank");
  assert(template.preflight.targetFpsMet === false, "C5B template preflight must not default to PASS");
  assert(template.sustained.benchmarkComplete === false, "C5B template sustained benchmark must not default complete");
  assert(template.rankedProduct.peerAircraftRendered === false, "C5B template ranked product observations must not default to PASS");

  const runbook = await readFile(runbookPath, "utf8");
  for (const token of ["c5b-performance.template.json", "C5B_EVIDENCE_FILE", "300 seconds", "30-minute sustained benchmark"]) {
    assert(runbook.includes(token), `C5B runbook missing structured evidence requirement: ${token}`);
  }
  console.log("C5B structured evidence contract PASS");
}

async function validateEvidence(path, expectedReleaseSha = null) {
  const record = JSON.parse(await readFile(resolve(process.cwd(), path), "utf8"));
  validateCommon(record);
  assert(/^[0-9a-f]{40}$/i.test(record.releaseSha ?? ""), "C5B evidence requires a full 40-character releaseSha");
  if (expectedReleaseSha) assert(record.releaseSha === expectedReleaseSha, "C5B evidence releaseSha does not match expected release SHA");
  assert(nonEmptyString(record.tester), "C5B evidence requires tester identity");
  assert(nonEmptyString(record.capturedAt) && Number.isFinite(Date.parse(record.capturedAt)), "C5B evidence requires valid capturedAt");
  for (const key of ["kind", "operatingSystem", "device", "browserA", "browserAVersion", "browserB", "browserBVersion"]) {
    assert(nonEmptyString(record.environment[key]), `C5B environment.${key} is required`);
  }

  validateSnapshot(record.preflight, "preflight", { minimumSeconds: 180 });
  validateSnapshot(record.sustained, "sustained", { minimumSeconds: 1800, benchmarkRequired: true });
  assert(finiteNumber(record.rankedProduct.durationSeconds) && record.rankedProduct.durationSeconds >= 300, "rankedProduct.durationSeconds must cover at least 300 seconds");
  validateSnapshot(record.rankedProduct.clientA, "rankedProduct.clientA", { minimumSeconds: 240 });
  validateSnapshot(record.rankedProduct.clientB, "rankedProduct.clientB", { minimumSeconds: 240 });
  assert(record.rankedProduct.peerAircraftRendered === true, "rankedProduct peer aircraft rendering observation is not PASS");
  assert(record.rankedProduct.hudResponsive === true, "rankedProduct HUD responsiveness observation is not PASS");
  assert(record.rankedProduct.serverAuthorityObserved === true, "rankedProduct server-authority observation is not PASS");
  assert(record.rankedProduct.visibleStutterObserved === false, "rankedProduct visible stutter was observed");
  assert(nonEmptyString(record.rankedProduct.notes), "rankedProduct notes are required");
  assert(nonEmptyString(record.overallNotes), "C5B overallNotes are required");

  console.log(JSON.stringify({
    ok: true,
    gate: "C5B_PERFORMANCE_EVIDENCE",
    releaseSha: record.releaseSha,
    preflightSeconds: record.preflight.sessionSeconds,
    sustainedSeconds: record.sustained.sessionSeconds,
    rankedProductSeconds: record.rankedProduct.durationSeconds,
  }, null, 2));
}

function validSnapshot(seconds, benchmarkComplete = false) {
  return {
    capturedAt: new Date().toISOString(),
    fps: 60,
    averageFps: 55,
    minimumFps: 42,
    transferredMiB: 80,
    resourceCount: 100,
    opaqueCrossOriginResourceCount: 10,
    zeroTransferResourceCount: 20,
    sessionSeconds: seconds,
    benchmarkComplete,
    usedHeapMiB: 100,
    targetFps: 45,
    minimumRequiredFps: 30,
    targetTransferMiBPerPlayerSession: 150,
    targetFpsMet: true,
    minimumFpsMet: true,
    transferBudgetMet: true,
  };
}

async function expectFailure(label, callback) {
  try {
    await callback();
  } catch {
    console.log(`PASS C5B self-test rejects ${label}`);
    return;
  }
  throw new Error(`C5B self-test unexpectedly accepted ${label}`);
}

async function selfTest() {
  const releaseSha = "a".repeat(40);
  const temp = await mkdtemp(join(tmpdir(), "cas-c5b-evidence-"));
  try {
    const record = {
      gate: "C5B_PERFORMANCE_EVIDENCE",
      releaseSha,
      tester: "CI self-test",
      capturedAt: new Date().toISOString(),
      environment: {
        kind: "synthetic",
        operatingSystem: "test",
        device: "test device",
        browserA: "browser A",
        browserAVersion: "1",
        browserB: "browser B",
        browserBVersion: "1",
      },
      preflight: validSnapshot(181, false),
      sustained: validSnapshot(1801, true),
      rankedProduct: {
        durationSeconds: 301,
        clientA: validSnapshot(299, false),
        clientB: validSnapshot(299, false),
        peerAircraftRendered: true,
        hudResponsive: true,
        serverAuthorityObserved: true,
        visibleStutterObserved: false,
        notes: "Synthetic ranked-product observation.",
      },
      overallNotes: "Synthetic C5B evidence self-test.",
    };
    const path = join(temp, "c5b-performance.json");
    await writeFile(path, JSON.stringify(record, null, 2), "utf8");
    await validateEvidence(path, releaseSha);

    const lowFps = structuredClone(record);
    lowFps.sustained.averageFps = 44.9;
    await writeFile(path, JSON.stringify(lowFps, null, 2), "utf8");
    await expectFailure("low sustained FPS", () => validateEvidence(path, releaseSha));

    await writeFile(path, JSON.stringify(record, null, 2), "utf8");
    await expectFailure("wrong release SHA", () => validateEvidence(path, "b".repeat(40)));
    console.log("C5B structured evidence self-test PASS");
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
}

await validateContract();
if (process.env.C5B_EVIDENCE_FILE) await validateEvidence(process.env.C5B_EVIDENCE_FILE, process.env.C5_EXPECTED_RELEASE_SHA || null);
if (process.env.C5B_EVIDENCE_SELF_TEST === "1") await selfTest();
