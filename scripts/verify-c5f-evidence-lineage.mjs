import { execFileSync } from "node:child_process";
import { access, mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";

const root = new URL("..", import.meta.url).pathname;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const REQUIRED_GATES = [
  "c4dProduction",
  "c5bPerformance",
  "c5cDeploy",
  "c5cRollback",
  "c5dSchool",
  "c5eHumanQa",
  "finalMainCi",
];

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function parseKeyValue(text) {
  const values = {};
  for (const line of text.split(/\r?\n/)) {
    const separator = line.indexOf("=");
    if (separator <= 0) continue;
    values[line.slice(0, separator)] = line.slice(separator + 1);
  }
  return values;
}

function timestamp(value, label) {
  const parsed = Date.parse(value ?? "");
  assert(Number.isFinite(parsed), `${label} must be a valid timestamp`);
  return parsed;
}

function parseJsonFromLog(text, label) {
  try {
    return JSON.parse(text);
  } catch {
    const start = text.indexOf("{");
    const end = text.lastIndexOf("}");
    assert(start >= 0 && end > start, `${label} does not contain a JSON object`);
    try {
      return JSON.parse(text.slice(start, end + 1));
    } catch (error) {
      throw new Error(`${label} contains an invalid JSON payload: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
}

async function collectFiles(path) {
  const info = await stat(path);
  if (info.isFile()) return [path];
  if (!info.isDirectory()) return [];
  const entries = await readdir(path, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const child = join(path, entry.name);
    if (entry.isDirectory()) files.push(...await collectFiles(child));
    else if (entry.isFile()) files.push(child);
  }
  return files;
}

async function evidenceFiles(manifestDirectory, entry, gate) {
  assert(entry && typeof entry === "object", `Missing C5F evidence gate: ${gate}`);
  assert(entry.status === "PASS", `C5F lineage requires ${gate}=PASS`);
  assert(Array.isArray(entry.files) && entry.files.length > 0, `${gate} requires retained local evidence files for lineage verification`);
  const files = [];
  for (const declared of entry.files) {
    assert(typeof declared === "string" && declared.trim(), `${gate}.files contains an empty path`);
    const path = resolve(manifestDirectory, declared);
    await access(path);
    files.push(...await collectFiles(path));
  }
  return files;
}

function uniqueFile(files, name, gate) {
  const matches = files.filter((path) => basename(path) === name);
  assert(matches.length === 1, `${gate} must contain exactly one ${name}; found ${matches.length}`);
  return matches[0];
}

async function uniqueJsonByGate(files, expectedGate, label) {
  const matches = [];
  for (const path of files.filter((entry) => entry.endsWith(".json"))) {
    try {
      const value = JSON.parse(await readFile(path, "utf8"));
      if (value?.gate === expectedGate) matches.push({ path, value });
    } catch {
      // Unrelated JSON is allowed to remain in retained evidence.
    }
  }
  assert(matches.length === 1, `${label} must contain exactly one JSON record with gate=${expectedGate}; found ${matches.length}`);
  return matches[0];
}

async function deployEvidenceByPurpose(files, purpose) {
  const matches = [];
  for (const path of files.filter((entry) => basename(entry) === "metadata.txt")) {
    const metadata = parseKeyValue(await readFile(path, "utf8"));
    if (metadata.action === "deploy" && metadata.deployment_purpose === purpose) {
      matches.push({ path, metadata, files: await collectFiles(dirname(path)) });
    }
  }
  assert(matches.length === 1, `c5cDeploy must contain exactly one ${purpose} deployment artifact; found ${matches.length}`);
  return matches[0];
}

function d1Rows(payload) {
  if (Array.isArray(payload)) return payload.flatMap((entry) => entry?.results ?? []);
  return payload?.results ?? [];
}

async function assertCleanupZero(files, gate, passMarker) {
  const cleanupPath = uniqueFile(files, "c4d-cleanup-verification.json", gate);
  const payload = JSON.parse(await readFile(cleanupPath, "utf8"));
  const row = d1Rows(payload)[0] ?? {};
  for (const key of ["users_remaining", "sessions_remaining", "rated_matches_remaining"]) {
    assert(Number(row[key]) === 0, `${gate} cleanup is not zero-count for ${key}`);
  }
  const marker = await readFile(uniqueFile(files, "c4d-cleanup.txt", gate), "utf8");
  assert(marker.includes(passMarker), `${gate} is missing cleanup PASS marker ${passMarker}`);
}

async function assertRatedSmoke(files, gate) {
  const path = uniqueFile(files, "c4d-rated-smoke.txt", gate);
  const smoke = parseJsonFromLog(await readFile(path, "utf8"), `${gate} rated-product smoke`);
  assert(smoke?.ok === true, `${gate} rated-product smoke did not report ok=true`);
  assert(smoke?.gate === "C4D_PRODUCTION_RATED_PRODUCT_SMOKE", `${gate} has unexpected rated-product smoke gate`);
}

async function assertDeployEvidence(deployEvidence, releaseSha, purpose) {
  const { metadata, files } = deployEvidence;
  const label = `c5cDeploy.${purpose}`;
  assert(metadata.action === "deploy", `${label} metadata action must be deploy`);
  assert(metadata.deployment_purpose === purpose, `${label} deployment purpose mismatch`);
  assert(metadata.git_sha === releaseSha, `${label} Git SHA does not match releaseSha`);
  assert(metadata.c4d_rated_production_gate === "enabled", `${label} rated production gate was not enabled`);
  const started = timestamp(metadata.started_at, `${label}.started_at`);
  const finished = timestamp(metadata.finished_at, `${label}.finished_at`);
  assert(finished >= started, `${label} finished before it started`);
  await assertRatedSmoke(files, label);
  await assertCleanupZero(files, label, "C4D_PRODUCTION_SMOKE_CLEANUP=PASS");
  return { started, finished };
}

async function currentAccountsDatabaseId() {
  const output = execFileSync(process.execPath, [resolve(root, "scripts/verify-c4d-production-binding.mjs")], {
    cwd: root,
    env: { ...process.env, C4D_BINDING_REQUIRED: "1", C4D_BINDING_SELF_TEST: "0" },
    encoding: "utf8",
  });
  const match = output.match(/C4D_PRODUCTION_BINDING=PASS[^\n]*database_id=([0-9a-f-]{36})/i);
  assert(match, "Unable to resolve reviewed ACCOUNTS D1 database_id from production binding validator");
  return match[1].toLowerCase();
}

function runValidator(script, env) {
  execFileSync(process.execPath, [resolve(root, script)], {
    cwd: root,
    env: { ...process.env, ...env },
    stdio: "inherit",
  });
}

async function validateLineage(manifestPathInput, bindingIdOverride = null) {
  const manifestPath = resolve(process.cwd(), manifestPathInput);
  const manifestDirectory = dirname(manifestPath);
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  assert(/^[0-9a-f]{40}$/i.test(manifest.releaseSha ?? ""), "C5F lineage requires a full 40-character releaseSha");
  assert(manifest.evidence && typeof manifest.evidence === "object", "C5F lineage requires evidence object");

  const byGate = {};
  for (const gate of REQUIRED_GATES) byGate[gate] = await evidenceFiles(manifestDirectory, manifest.evidence[gate], gate);

  const provision = JSON.parse(await readFile(uniqueFile(byGate.c4dProduction, "c4d-provision.json", "c4dProduction"), "utf8"));
  assert(provision.gate === "C4D_PRODUCTION_D1", "c4dProduction has unexpected provisioning gate identifier");
  assert(provision.status === "PASS" && provision.provisioning === "PASS", "c4dProduction provisioning is not PASS");
  assert(provision.d1ReadAuthorization === "PASS", "c4dProduction D1 read authorization is not PASS");
  assert(provision.schema === "PASS", "c4dProduction D1 schema verification is not PASS");
  assert(provision.databaseName === "cas-simulator-accounts", "c4dProduction database name mismatch");
  assert(UUID_PATTERN.test(provision.databaseId ?? ""), "c4dProduction databaseId is not a valid D1 UUID");
  const boundDatabaseId = (bindingIdOverride ?? await currentAccountsDatabaseId()).toLowerCase();
  assert(provision.databaseId.toLowerCase() === boundDatabaseId, "C4D provisioned database ID does not match final ACCOUNTS binding");

  const c5b = await uniqueJsonByGate(byGate.c5bPerformance, "C5B_PERFORMANCE_EVIDENCE", "c5bPerformance");
  runValidator("scripts/verify-c5b-evidence.mjs", {
    C5B_EVIDENCE_FILE: c5b.path,
    C5_EXPECTED_RELEASE_SHA: manifest.releaseSha,
    C5B_EVIDENCE_SELF_TEST: "0",
  });

  const initialDeploy = await deployEvidenceByPurpose(byGate.c5cDeploy, "initial_release");
  const restoreDeploy = await deployEvidenceByPurpose(byGate.c5cDeploy, "restore_after_rollback");
  const initialTiming = await assertDeployEvidence(initialDeploy, manifest.releaseSha, "initial_release");
  const restoreTiming = await assertDeployEvidence(restoreDeploy, manifest.releaseSha, "restore_after_rollback");

  const rollbackMetadataPath = uniqueFile(byGate.c5cRollback, "metadata.txt", "c5cRollback");
  const rollbackMetadata = parseKeyValue(await readFile(rollbackMetadataPath, "utf8"));
  assert(rollbackMetadata.action === "rollback", "c5cRollback metadata action must be rollback");
  assert(rollbackMetadata.governance_git_sha === manifest.releaseSha, "c5cRollback governance Git SHA does not match releaseSha");
  assert(rollbackMetadata.c4d_rated_production_gate === "enabled", "c5cRollback rated production gate was not enabled");
  assert(typeof rollbackMetadata.target_version_id === "string" && rollbackMetadata.target_version_id.trim(), "c5cRollback target_version_id is missing");
  const rollbackStarted = timestamp(rollbackMetadata.started_at, "c5cRollback.started_at");
  const rollbackFinished = timestamp(rollbackMetadata.finished_at, "c5cRollback.finished_at");
  assert(rollbackFinished >= rollbackStarted, "c5cRollback finished before it started");
  await assertRatedSmoke(byGate.c5cRollback, "c5cRollback");
  await assertCleanupZero(byGate.c5cRollback, "c5cRollback", "C4D_ROLLBACK_SMOKE_CLEANUP=PASS");

  assert(initialTiming.finished < rollbackStarted, "C5C lineage requires initial_release deploy to finish before rollback starts");
  assert(rollbackFinished < restoreTiming.started, "C5C lineage requires rollback to finish before restore_after_rollback deploy starts");

  const c5dReport = await uniqueJsonByGate(byGate.c5dSchool, "C5D_SCHOOL_RELEASE_REGRESSION", "c5dSchool");
  const c5dObservation = await uniqueJsonByGate(byGate.c5dSchool, "C5D_MANAGED_MAC_OBSERVATION", "c5dSchool");
  runValidator("scripts/verify-c5d-managed-evidence.mjs", {
    C5D_REPORT_FILE: c5dReport.path,
    C5D_OBSERVATION_FILE: c5dObservation.path,
    C5_EXPECTED_RELEASE_SHA: manifest.releaseSha,
    C5D_EVIDENCE_SELF_TEST: "0",
  });

  const c5e = await uniqueJsonByGate(byGate.c5eHumanQa, "C5E_HUMAN_QA_VISUAL_SIGNOFF", "c5eHumanQa");
  assert(c5e.value.releaseSha === manifest.releaseSha, "C5E human-QA releaseSha does not match final C5F releaseSha");

  const finalCi = JSON.parse(await readFile(uniqueFile(byGate.finalMainCi, "c5-final-ci.json", "finalMainCi"), "utf8"));
  assert(finalCi.gate === "C5_FINAL_MAIN_CI", "finalMainCi has unexpected gate identifier");
  assert(finalCi.gitSha === manifest.releaseSha, "finalMainCi Git SHA does not match releaseSha");
  assert(finalCi.event === "push", "finalMainCi evidence must come from a push run");
  assert(finalCi.gitRef === "refs/heads/main", "finalMainCi evidence must come from refs/heads/main");
  assert(finalCi.verificationStepsPassed === true, "finalMainCi verificationStepsPassed is not true");

  console.log(JSON.stringify({
    ok: true,
    gate: "C5F_EVIDENCE_LINEAGE",
    releaseSha: manifest.releaseSha,
    databaseId: boundDatabaseId,
    finalProductionState: "restore_after_rollback",
    verified: REQUIRED_GATES,
  }, null, 2));
}

async function validateCommittedContract() {
  const provisionWorkflow = await readFile(resolve(root, ".github/workflows/c4d-provision-d1.yml"), "utf8");
  const deployWorkflow = await readFile(resolve(root, ".github/workflows/deploy.yml"), "utf8");
  const ciWorkflow = await readFile(resolve(root, ".github/workflows/ci.yml"), "utf8");
  const packageJson = await readFile(resolve(root, "package.json"), "utf8");
  const runbook = await readFile(resolve(root, "docs/operations/C5F_CAS_EVIDENCE_PACKAGE.md"), "utf8");
  assert(provisionWorkflow.includes("c4d-provision.json") && provisionWorkflow.includes("c4d-d1-provision-"), "C4D provisioning workflow must retain machine-readable lineage evidence");
  assert(deployWorkflow.includes("deployment_purpose") && deployWorkflow.includes("initial_release") && deployWorkflow.includes("restore_after_rollback"), "Deploy workflow must distinguish initial release and final restoration evidence");
  assert(ciWorkflow.includes("c5-final-ci.json"), "Project CI must retain final-main lineage metadata");
  assert(ciWorkflow.includes("C5B_EVIDENCE_SELF_TEST=1") && ciWorkflow.includes("C5D_EVIDENCE_SELF_TEST=1"), "Project CI must self-test C5B/C5D structured evidence validators");
  assert(packageJson.includes('"verify:c5b:evidence"') && packageJson.includes('"verify:c5d:evidence"'), "package scripts must expose C5B/C5D evidence validators");
  for (const token of ["c4d-provision.json", "c5b-performance.json", "c4d-cleanup-verification.json", "c5d-managed-mac-observation.json", "C5E", "c5-final-ci.json", "all seven", "same release SHA", "initial_release", "restore_after_rollback", "final production state"]) {
    assert(runbook.includes(token), `C5F runbook missing lineage requirement: ${token}`);
  }
  console.log("C5F evidence lineage contract PASS");
}

async function expectFailure(label, callback) {
  try {
    await callback();
  } catch {
    console.log(`PASS lineage self-test rejects ${label}`);
    return;
  }
  throw new Error(`Lineage self-test unexpectedly accepted ${label}.`);
}

function performanceSnapshot(seconds, benchmarkComplete = false) {
  return {
    capturedAt: new Date().toISOString(), fps: 60, averageFps: 55, minimumFps: 42, transferredMiB: 80,
    resourceCount: 100, opaqueCrossOriginResourceCount: 10, zeroTransferResourceCount: 20,
    sessionSeconds: seconds, benchmarkComplete, usedHeapMiB: 100, targetFps: 45,
    minimumRequiredFps: 30, targetTransferMiBPerPlayerSession: 150,
    targetFpsMet: true, minimumFpsMet: true, transferBudgetMet: true,
  };
}

async function writeDeployEvidence(directory, releaseSha, purpose, startedAt, finishedAt, cleanup, smoke) {
  await mkdir(directory, { recursive: true });
  await writeFile(join(directory, "metadata.txt"), `action=deploy\ndeployment_purpose=${purpose}\ngit_sha=${releaseSha}\nc4d_rated_production_gate=enabled\nstarted_at=${startedAt}\nfinished_at=${finishedAt}\n`, "utf8");
  await writeFile(join(directory, "c4d-rated-smoke.txt"), smoke, "utf8");
  await writeFile(join(directory, "c4d-cleanup-verification.json"), cleanup, "utf8");
  await writeFile(join(directory, "c4d-cleanup.txt"), "C4D_PRODUCTION_SMOKE_CLEANUP=PASS\n", "utf8");
}

async function selfTest() {
  const releaseSha = "a".repeat(40);
  const databaseId = "123e4567-e89b-42d3-a456-426614174000";
  const temp = await mkdtemp(join(tmpdir(), "cas-c5f-lineage-"));
  try {
    for (const directory of ["provision", "performance", "rollback", "school", "human", "ci"]) await mkdir(join(temp, directory), { recursive: true });
    await writeFile(join(temp, "provision/c4d-provision.json"), JSON.stringify({
      gate: "C4D_PRODUCTION_D1", status: "PASS", provisioning: "PASS", d1ReadAuthorization: "PASS", schema: "PASS",
      databaseName: "cas-simulator-accounts", databaseId,
    }), "utf8");

    const c5b = {
      gate: "C5B_PERFORMANCE_EVIDENCE", releaseSha, tester: "C5F self-test", capturedAt: new Date().toISOString(),
      environment: { kind: "synthetic", operatingSystem: "test", device: "test", browserA: "A", browserAVersion: "1", browserB: "B", browserBVersion: "1" },
      preflight: performanceSnapshot(181, false), sustained: performanceSnapshot(1801, true),
      rankedProduct: { durationSeconds: 301, clientA: performanceSnapshot(299, false), clientB: performanceSnapshot(299, false), peerAircraftRendered: true, hudResponsive: true, serverAuthorityObserved: true, visibleStutterObserved: false, notes: "Synthetic." },
      overallNotes: "Synthetic C5F lineage record.",
    };
    await writeFile(join(temp, "performance/c5b-performance.json"), JSON.stringify(c5b, null, 2), "utf8");

    const cleanup = JSON.stringify([{ results: [{ users_remaining: 0, sessions_remaining: 0, rated_matches_remaining: 0 }] }]);
    const smokePayload = JSON.stringify({ ok: true, gate: "C4D_PRODUCTION_RATED_PRODUCT_SMOKE" }, null, 2);
    const smoke = `> cas-flight-simulator@0.1.0 verify:production:c4d\n> node scripts/verify-production-rated-product.mjs\n\n${smokePayload}\n`;
    await writeDeployEvidence(join(temp, "deploy-initial"), releaseSha, "initial_release", "2026-01-01T00:00:00Z", "2026-01-01T00:01:00Z", cleanup, smoke);
    await writeFile(join(temp, "rollback/metadata.txt"), `action=rollback\ngovernance_git_sha=${releaseSha}\ntarget_version_id=version-1\nc4d_rated_production_gate=enabled\nstarted_at=2026-01-01T00:02:00Z\nfinished_at=2026-01-01T00:03:00Z\n`, "utf8");
    await writeFile(join(temp, "rollback/c4d-rated-smoke.txt"), smoke, "utf8");
    await writeFile(join(temp, "rollback/c4d-cleanup-verification.json"), cleanup, "utf8");
    await writeFile(join(temp, "rollback/c4d-cleanup.txt"), "C4D_ROLLBACK_SMOKE_CLEANUP=PASS\n", "utf8");
    await writeDeployEvidence(join(temp, "deploy-restore"), releaseSha, "restore_after_rollback", "2026-01-01T00:04:00Z", "2026-01-01T00:05:00Z", cleanup, smoke);

    const schoolReport = {
      gate: "C5D_SCHOOL_RELEASE_REGRESSION", ok: true,
      environment: { gitSha: releaseSha, platform: "darwin" },
      gates: ["c3_multiplayer", "c4b_matchmaking", "c4c_competition", "c4d_accounts", "c4d_ranked_product"].map((id) => ({ id, passed: true, exitCode: 0 })),
    };
    const schoolObservation = {
      gate: "C5D_MANAGED_MAC_OBSERVATION", releaseSha, tester: "C5F self-test", capturedAt: new Date().toISOString(),
      browser: "Browser", browserVersion: "1", operatingSystem: "macOS", device: "Managed Mac",
      observations: { devSchoolStarted: true, browserOpenedLocalhost: true, fiveAutomatedGatesPassed: true, noSecurityBypassUsed: true, flightInputUsable: true, productUiUsable: true },
      notes: "Synthetic.",
    };
    await writeFile(join(temp, "school/c5d-school-regression.json"), JSON.stringify(schoolReport, null, 2), "utf8");
    await writeFile(join(temp, "school/c5d-managed-mac-observation.json"), JSON.stringify(schoolObservation, null, 2), "utf8");

    const c5e = { gate: "C5E_HUMAN_QA_VISUAL_SIGNOFF", releaseSha };
    await writeFile(join(temp, "human/c5e.json"), JSON.stringify(c5e, null, 2), "utf8");
    await writeFile(join(temp, "ci/c5-final-ci.json"), JSON.stringify({
      gate: "C5_FINAL_MAIN_CI", gitSha: releaseSha, gitRef: "refs/heads/main", event: "push", verificationStepsPassed: true,
    }), "utf8");

    const manifest = {
      releaseSha,
      evidence: {
        c4dProduction: { status: "PASS", files: ["provision"] },
        c5bPerformance: { status: "PASS", files: ["performance"] },
        c5cDeploy: { status: "PASS", files: ["deploy-initial", "deploy-restore"] },
        c5cRollback: { status: "PASS", files: ["rollback"] },
        c5dSchool: { status: "PASS", files: ["school"] },
        c5eHumanQa: { status: "PASS", files: ["human"] },
        finalMainCi: { status: "PASS", files: ["ci"] },
      },
    };
    const manifestPath = join(temp, "manifest.json");
    await writeFile(manifestPath, JSON.stringify(manifest), "utf8");
    await validateLineage(manifestPath, databaseId);

    await expectFailure("wrong restoration deploy SHA", async () => {
      await writeDeployEvidence(join(temp, "deploy-restore"), "b".repeat(40), "restore_after_rollback", "2026-01-01T00:04:00Z", "2026-01-01T00:05:00Z", cleanup, smoke);
      await validateLineage(manifestPath, databaseId);
    });
    await writeDeployEvidence(join(temp, "deploy-restore"), releaseSha, "restore_after_rollback", "2026-01-01T00:04:00Z", "2026-01-01T00:05:00Z", cleanup, smoke);

    await expectFailure("restoration deploy before rollback finished", async () => {
      await writeDeployEvidence(join(temp, "deploy-restore"), releaseSha, "restore_after_rollback", "2026-01-01T00:02:30Z", "2026-01-01T00:05:00Z", cleanup, smoke);
      await validateLineage(manifestPath, databaseId);
    });
    await writeDeployEvidence(join(temp, "deploy-restore"), releaseSha, "restore_after_rollback", "2026-01-01T00:04:00Z", "2026-01-01T00:05:00Z", cleanup, smoke);

    await expectFailure("non-zero restoration cleanup", async () => {
      await writeFile(join(temp, "deploy-restore/c4d-cleanup-verification.json"), JSON.stringify([{ results: [{ users_remaining: 1, sessions_remaining: 0, rated_matches_remaining: 0 }] }]), "utf8");
      await validateLineage(manifestPath, databaseId);
    });
    await writeFile(join(temp, "deploy-restore/c4d-cleanup-verification.json"), cleanup, "utf8");

    await expectFailure("provision/binding mismatch", () => validateLineage(manifestPath, "223e4567-e89b-42d3-a456-426614174000"));

    await writeFile(join(temp, "human/c5e.json"), JSON.stringify({ ...c5e, releaseSha: "b".repeat(40) }, null, 2), "utf8");
    await expectFailure("C5E evidence from another release", () => validateLineage(manifestPath, databaseId));
    console.log("C5F all-gate evidence lineage self-test PASS");
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
}

await validateCommittedContract();
if (process.env.C5F_MANIFEST_FILE) await validateLineage(process.env.C5F_MANIFEST_FILE);
if (process.env.C5F_LINEAGE_SELF_TEST === "1") await selfTest();
