import { execFileSync } from "node:child_process";
import { access, mkdtemp, readFile, readdir, rm, stat, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";

const root = new URL("..", import.meta.url).pathname;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const TARGET_GATES = ["c4dProduction", "c5cDeploy", "c5cRollback", "finalMainCi"];

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
  const smoke = JSON.parse(await readFile(uniqueFile(files, "c4d-rated-smoke.txt", gate), "utf8"));
  assert(smoke?.ok === true, `${gate} rated-product smoke did not report ok=true`);
  assert(smoke?.gate === "C4D_PRODUCTION_RATED_PRODUCT_SMOKE", `${gate} has unexpected rated-product smoke gate`);
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

async function validateLineage(manifestPathInput, bindingIdOverride = null) {
  const manifestPath = resolve(process.cwd(), manifestPathInput);
  const manifestDirectory = dirname(manifestPath);
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  assert(/^[0-9a-f]{40}$/i.test(manifest.releaseSha ?? ""), "C5F lineage requires a full 40-character releaseSha");
  assert(manifest.evidence && typeof manifest.evidence === "object", "C5F lineage requires evidence object");

  const byGate = {};
  for (const gate of TARGET_GATES) byGate[gate] = await evidenceFiles(manifestDirectory, manifest.evidence[gate], gate);

  const provision = JSON.parse(await readFile(uniqueFile(byGate.c4dProduction, "c4d-provision.json", "c4dProduction"), "utf8"));
  assert(provision.gate === "C4D_PRODUCTION_D1", "c4dProduction has unexpected provisioning gate identifier");
  assert(provision.status === "PASS" && provision.provisioning === "PASS", "c4dProduction provisioning is not PASS");
  assert(provision.d1ReadAuthorization === "PASS", "c4dProduction D1 read authorization is not PASS");
  assert(provision.schema === "PASS", "c4dProduction D1 schema verification is not PASS");
  assert(provision.databaseName === "cas-simulator-accounts", "c4dProduction database name mismatch");
  assert(UUID_PATTERN.test(provision.databaseId ?? ""), "c4dProduction databaseId is not a valid D1 UUID");
  const boundDatabaseId = (bindingIdOverride ?? await currentAccountsDatabaseId()).toLowerCase();
  assert(provision.databaseId.toLowerCase() === boundDatabaseId, "C4D provisioned database ID does not match final ACCOUNTS binding");

  const deployMetadata = parseKeyValue(await readFile(uniqueFile(byGate.c5cDeploy, "metadata.txt", "c5cDeploy"), "utf8"));
  assert(deployMetadata.action === "deploy", "c5cDeploy metadata action must be deploy");
  assert(deployMetadata.git_sha === manifest.releaseSha, "c5cDeploy Git SHA does not match releaseSha");
  assert(deployMetadata.c4d_rated_production_gate === "enabled", "c5cDeploy rated production gate was not enabled");
  await assertRatedSmoke(byGate.c5cDeploy, "c5cDeploy");
  await assertCleanupZero(byGate.c5cDeploy, "c5cDeploy", "C4D_PRODUCTION_SMOKE_CLEANUP=PASS");

  const rollbackMetadata = parseKeyValue(await readFile(uniqueFile(byGate.c5cRollback, "metadata.txt", "c5cRollback"), "utf8"));
  assert(rollbackMetadata.action === "rollback", "c5cRollback metadata action must be rollback");
  assert(rollbackMetadata.governance_git_sha === manifest.releaseSha, "c5cRollback governance Git SHA does not match releaseSha");
  assert(rollbackMetadata.c4d_rated_production_gate === "enabled", "c5cRollback rated production gate was not enabled");
  assert(typeof rollbackMetadata.target_version_id === "string" && rollbackMetadata.target_version_id.trim(), "c5cRollback target_version_id is missing");
  await assertRatedSmoke(byGate.c5cRollback, "c5cRollback");
  await assertCleanupZero(byGate.c5cRollback, "c5cRollback", "C4D_ROLLBACK_SMOKE_CLEANUP=PASS");

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
    verified: TARGET_GATES,
  }, null, 2));
}

async function validateCommittedContract() {
  const provisionWorkflow = await readFile(resolve(root, ".github/workflows/c4d-provision-d1.yml"), "utf8");
  const ciWorkflow = await readFile(resolve(root, ".github/workflows/ci.yml"), "utf8");
  const runbook = await readFile(resolve(root, "docs/operations/C5F_CAS_EVIDENCE_PACKAGE.md"), "utf8");
  assert(provisionWorkflow.includes("c4d-provision.json") && provisionWorkflow.includes("c4d-d1-provision-"), "C4D provisioning workflow must retain machine-readable lineage evidence");
  assert(ciWorkflow.includes("c5-final-ci.json"), "Project CI must retain final-main lineage metadata");
  for (const token of ["c4d-provision.json", "c4d-cleanup-verification.json", "c5-final-ci.json", "same release SHA"]) {
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
  throw new Error(`Lineage self-test unexpectedly accepted ${label}`);
}

async function selfTest() {
  const releaseSha = "a".repeat(40);
  const databaseId = "123e4567-e89b-42d3-a456-426614174000";
  const temp = await mkdtemp(join(tmpdir(), "cas-c5f-lineage-"));
  try {
    for (const directory of ["provision", "deploy", "rollback", "ci"]) await mkdir(join(temp, directory), { recursive: true });
    await writeFile(join(temp, "provision/c4d-provision.json"), JSON.stringify({
      gate: "C4D_PRODUCTION_D1", status: "PASS", provisioning: "PASS", d1ReadAuthorization: "PASS", schema: "PASS",
      databaseName: "cas-simulator-accounts", databaseId,
    }), "utf8");
    const cleanup = JSON.stringify([{ results: [{ users_remaining: 0, sessions_remaining: 0, rated_matches_remaining: 0 }] }]);
    const smoke = JSON.stringify({ ok: true, gate: "C4D_PRODUCTION_RATED_PRODUCT_SMOKE" });
    await writeFile(join(temp, "deploy/metadata.txt"), `action=deploy\ngit_sha=${releaseSha}\nc4d_rated_production_gate=enabled\n`, "utf8");
    await writeFile(join(temp, "deploy/c4d-rated-smoke.txt"), smoke, "utf8");
    await writeFile(join(temp, "deploy/c4d-cleanup-verification.json"), cleanup, "utf8");
    await writeFile(join(temp, "deploy/c4d-cleanup.txt"), "C4D_PRODUCTION_SMOKE_CLEANUP=PASS\n", "utf8");
    await writeFile(join(temp, "rollback/metadata.txt"), `action=rollback\ngovernance_git_sha=${releaseSha}\ntarget_version_id=version-1\nc4d_rated_production_gate=enabled\n`, "utf8");
    await writeFile(join(temp, "rollback/c4d-rated-smoke.txt"), smoke, "utf8");
    await writeFile(join(temp, "rollback/c4d-cleanup-verification.json"), cleanup, "utf8");
    await writeFile(join(temp, "rollback/c4d-cleanup.txt"), "C4D_ROLLBACK_SMOKE_CLEANUP=PASS\n", "utf8");
    await writeFile(join(temp, "ci/c5-final-ci.json"), JSON.stringify({
      gate: "C5_FINAL_MAIN_CI", gitSha: releaseSha, gitRef: "refs/heads/main", event: "push", verificationStepsPassed: true,
    }), "utf8");
    const manifest = {
      releaseSha,
      evidence: {
        c4dProduction: { status: "PASS", files: ["provision"] },
        c5cDeploy: { status: "PASS", files: ["deploy"] },
        c5cRollback: { status: "PASS", files: ["rollback"] },
        finalMainCi: { status: "PASS", files: ["ci"] },
      },
    };
    const manifestPath = join(temp, "manifest.json");
    await writeFile(manifestPath, JSON.stringify(manifest), "utf8");
    await validateLineage(manifestPath, databaseId);

    await expectFailure("wrong deploy SHA", async () => {
      await writeFile(join(temp, "deploy/metadata.txt"), `action=deploy\ngit_sha=${"b".repeat(40)}\nc4d_rated_production_gate=enabled\n`, "utf8");
      await validateLineage(manifestPath, databaseId);
    });
    await writeFile(join(temp, "deploy/metadata.txt"), `action=deploy\ngit_sha=${releaseSha}\nc4d_rated_production_gate=enabled\n`, "utf8");

    await expectFailure("non-zero cleanup", async () => {
      await writeFile(join(temp, "deploy/c4d-cleanup-verification.json"), JSON.stringify([{ results: [{ users_remaining: 1, sessions_remaining: 0, rated_matches_remaining: 0 }] }]), "utf8");
      await validateLineage(manifestPath, databaseId);
    });
    await writeFile(join(temp, "deploy/c4d-cleanup-verification.json"), cleanup, "utf8");

    await expectFailure("provision/binding mismatch", () => validateLineage(manifestPath, "223e4567-e89b-42d3-a456-426614174000"));
    console.log("C5F evidence lineage self-test PASS");
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
}

await validateCommittedContract();
if (process.env.C5F_MANIFEST_FILE) await validateLineage(process.env.C5F_MANIFEST_FILE);
if (process.env.C5F_LINEAGE_SELF_TEST === "1") await selfTest();
