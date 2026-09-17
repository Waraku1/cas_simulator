import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const root = new URL("..", import.meta.url).pathname;
const templatePath = resolve(root, "docs/evidence/templates/c5d-managed-mac-observation.template.json");
const runbookPath = resolve(root, "docs/operations/C5D_SCHOOL_REGRESSION.md");
const requiredGateIds = ["c3_multiplayer", "c4b_matchmaking", "c4c_competition", "c4d_accounts", "c4d_ranked_product"];

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function nonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0;
}

async function validateContract() {
  const template = JSON.parse(await readFile(templatePath, "utf8"));
  assert(template.gate === "C5D_MANAGED_MAC_OBSERVATION", "Unexpected C5D observation gate identifier");
  assert(template.releaseSha === "", "C5D observation template releaseSha must remain blank");
  assert(template.observations && typeof template.observations === "object", "C5D observation template requires observations");
  assert(Object.values(template.observations).every((value) => value === false), "C5D observation template must not default any observation to PASS");

  const runbook = await readFile(runbookPath, "utf8");
  for (const token of ["c5d-managed-mac-observation.template.json", "C5D_REPORT_FILE", "C5D_OBSERVATION_FILE", "managed school Mac"]) {
    assert(runbook.includes(token), `C5D runbook missing structured managed-Mac evidence requirement: ${token}`);
  }
  console.log("C5D managed Mac evidence contract PASS");
}

async function validateEvidence(reportPathInput, observationPathInput, expectedReleaseSha = null) {
  const report = JSON.parse(await readFile(resolve(process.cwd(), reportPathInput), "utf8"));
  const observation = JSON.parse(await readFile(resolve(process.cwd(), observationPathInput), "utf8"));

  assert(report.gate === "C5D_SCHOOL_RELEASE_REGRESSION", "Unexpected C5D automated report gate identifier");
  assert(report.ok === true, "C5D automated report is not PASS");
  assert(report.environment && typeof report.environment === "object", "C5D automated report environment is missing");
  assert(/^[0-9a-f]{40}$/i.test(report.environment.gitSha ?? ""), "C5D automated report requires a full Git SHA");
  assert(report.environment.platform === "darwin", `C5D final evidence must come from managed macOS/darwin, got ${report.environment.platform ?? "<missing>"}`);
  assert(Array.isArray(report.gates), "C5D automated report gates are missing");
  assert(report.gates.length === requiredGateIds.length, `C5D automated report must contain ${requiredGateIds.length} gates`);
  const byId = new Map(report.gates.map((entry) => [entry?.id, entry]));
  for (const id of requiredGateIds) {
    const entry = byId.get(id);
    assert(entry && entry.passed === true && entry.exitCode === 0, `C5D automated gate is not PASS: ${id}`);
  }

  assert(observation.gate === "C5D_MANAGED_MAC_OBSERVATION", "Unexpected C5D managed-Mac observation gate identifier");
  assert(/^[0-9a-f]{40}$/i.test(observation.releaseSha ?? ""), "C5D observation requires a full releaseSha");
  assert(observation.releaseSha === report.environment.gitSha, "C5D observation releaseSha does not match automated report SHA");
  if (expectedReleaseSha) assert(observation.releaseSha === expectedReleaseSha, "C5D evidence does not match expected release SHA");
  assert(nonEmptyString(observation.tester), "C5D observation requires tester identity");
  assert(nonEmptyString(observation.capturedAt) && Number.isFinite(Date.parse(observation.capturedAt)), "C5D observation requires valid capturedAt");
  for (const key of ["browser", "browserVersion", "operatingSystem", "device"]) {
    assert(nonEmptyString(observation[key]), `C5D observation.${key} is required`);
  }
  const requiredObservations = [
    "devSchoolStarted",
    "browserOpenedLocalhost",
    "fiveAutomatedGatesPassed",
    "noSecurityBypassUsed",
    "flightInputUsable",
    "productUiUsable",
  ];
  assert(observation.observations && typeof observation.observations === "object", "C5D observations object is required");
  for (const key of requiredObservations) assert(observation.observations[key] === true, `C5D observation is not PASS: ${key}`);
  assert(nonEmptyString(observation.notes), "C5D observation notes are required");

  console.log(JSON.stringify({
    ok: true,
    gate: "C5D_MANAGED_MAC_RELEASE_EVIDENCE",
    releaseSha: observation.releaseSha,
    automatedGatesPassed: requiredGateIds.length,
    platform: report.environment.platform,
  }, null, 2));
}

async function expectFailure(label, callback) {
  try {
    await callback();
  } catch {
    console.log(`PASS C5D self-test rejects ${label}`);
    return;
  }
  throw new Error(`C5D self-test unexpectedly accepted ${label}`);
}

async function selfTest() {
  const releaseSha = "a".repeat(40);
  const temp = await mkdtemp(join(tmpdir(), "cas-c5d-evidence-"));
  try {
    const report = {
      gate: "C5D_SCHOOL_RELEASE_REGRESSION",
      ok: true,
      environment: { gitSha: releaseSha, platform: "darwin" },
      gates: requiredGateIds.map((id) => ({ id, passed: true, exitCode: 0 })),
    };
    const observation = {
      gate: "C5D_MANAGED_MAC_OBSERVATION",
      releaseSha,
      tester: "CI self-test",
      capturedAt: new Date().toISOString(),
      browser: "Browser",
      browserVersion: "1",
      operatingSystem: "macOS",
      device: "Managed Mac",
      observations: {
        devSchoolStarted: true,
        browserOpenedLocalhost: true,
        fiveAutomatedGatesPassed: true,
        noSecurityBypassUsed: true,
        flightInputUsable: true,
        productUiUsable: true,
      },
      notes: "Synthetic managed-Mac evidence self-test.",
    };
    const reportPath = join(temp, "c5d-school-regression.json");
    const observationPath = join(temp, "c5d-managed-mac-observation.json");
    await writeFile(reportPath, JSON.stringify(report, null, 2), "utf8");
    await writeFile(observationPath, JSON.stringify(observation, null, 2), "utf8");
    await validateEvidence(reportPath, observationPath, releaseSha);

    const linux = structuredClone(report);
    linux.environment.platform = "linux";
    await writeFile(reportPath, JSON.stringify(linux, null, 2), "utf8");
    await expectFailure("hosted Linux evidence as final managed-Mac evidence", () => validateEvidence(reportPath, observationPath, releaseSha));

    await writeFile(reportPath, JSON.stringify(report, null, 2), "utf8");
    await expectFailure("wrong release SHA", () => validateEvidence(reportPath, observationPath, "b".repeat(40)));
    console.log("C5D managed Mac evidence self-test PASS");
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
}

await validateContract();
if (process.env.C5D_REPORT_FILE || process.env.C5D_OBSERVATION_FILE) {
  assert(process.env.C5D_REPORT_FILE && process.env.C5D_OBSERVATION_FILE, "C5D_REPORT_FILE and C5D_OBSERVATION_FILE must be provided together");
  await validateEvidence(process.env.C5D_REPORT_FILE, process.env.C5D_OBSERVATION_FILE, process.env.C5_EXPECTED_RELEASE_SHA || null);
}
if (process.env.C5D_EVIDENCE_SELF_TEST === "1") await selfTest();
