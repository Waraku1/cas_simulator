import { access, mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";

const root = new URL("..", import.meta.url).pathname;
const VERSION_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const EXPECTED_WORKER_NAME = "cas-flight-simulator";

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
  assert(entry && typeof entry === "object", `Missing C5C version-transition evidence gate: ${gate}`);
  assert(entry.status === "PASS", `C5C version transition requires ${gate}=PASS`);
  assert(Array.isArray(entry.files) && entry.files.length > 0, `${gate} requires retained local evidence files`);
  const files = [];
  for (const declared of entry.files) {
    assert(typeof declared === "string" && declared.trim(), `${gate}.files contains an empty path`);
    const path = resolve(manifestDirectory, declared);
    await access(path);
    files.push(...await collectFiles(path));
  }
  return files;
}

function uniqueFile(files, name, label) {
  const matches = files.filter((path) => basename(path) === name);
  assert(matches.length === 1, `${label} must contain exactly one ${name}; found ${matches.length}`);
  return matches[0];
}

async function deployArtifactByPurpose(files, purpose) {
  const matches = [];
  for (const path of files.filter((entry) => basename(entry) === "metadata.txt")) {
    const metadata = parseKeyValue(await readFile(path, "utf8"));
    if (metadata.action === "deploy" && metadata.deployment_purpose === purpose) {
      matches.push({ metadata, files: await collectFiles(dirname(path)) });
    }
  }
  assert(matches.length === 1, `c5cDeploy must contain exactly one ${purpose} artifact; found ${matches.length}`);
  return matches[0];
}

function liveVersionFromDeploymentStatus(payload, label) {
  const versions = Array.isArray(payload?.versions) ? payload.versions : [];
  assert(versions.length === 1, `${label} must contain exactly one live Worker version; found ${versions.length}`);
  const current = versions[0] ?? {};
  assert(Number(current.percentage) === 100, `${label} must route 100 percent traffic to one Worker version`);
  assert(VERSION_ID_PATTERN.test(current.version_id ?? ""), `${label} has invalid live Worker version_id`);
  return current.version_id.toLowerCase();
}

async function structuredDeployVersion(files, label) {
  const path = uniqueFile(files, "wrangler-deploy.ndjson", label);
  const entries = (await readFile(path, "utf8"))
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line, index) => {
      try {
        return JSON.parse(line);
      } catch (error) {
        throw new Error(`${label} wrangler-deploy.ndjson line ${index + 1} is invalid JSON: ${error instanceof Error ? error.message : String(error)}`);
      }
    });
  const deployEntries = entries.filter((entry) => entry?.type === "deploy");
  assert(deployEntries.length === 1, `${label} must contain exactly one Wrangler deploy output entry; found ${deployEntries.length}`);
  const deploy = deployEntries[0];
  assert(deploy.worker_name === EXPECTED_WORKER_NAME, `${label} Worker name mismatch`);
  assert(VERSION_ID_PATTERN.test(deploy.version_id ?? ""), `${label} structured deploy version_id is invalid`);
  return deploy.version_id.toLowerCase();
}

async function assertDeployVersion(artifact, purpose) {
  const label = `c5cDeploy.${purpose}`;
  const versionId = await structuredDeployVersion(artifact.files, label);
  const livePayload = JSON.parse(await readFile(uniqueFile(artifact.files, "deployments-after-mutation.json", label), "utf8"));
  const liveVersionId = liveVersionFromDeploymentStatus(livePayload, `${label} post-deploy state`);
  assert(liveVersionId === versionId, `${label} structured deploy version does not match 100 percent live version`);
  assert(typeof artifact.metadata.production_url === "string" && artifact.metadata.production_url.trim(), `${label} production_url is missing`);
  return { versionId, productionUrl: artifact.metadata.production_url };
}

async function validateManifest(manifestPathInput) {
  const manifestPath = resolve(process.cwd(), manifestPathInput);
  const manifestDirectory = dirname(manifestPath);
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  assert(manifest.evidence && typeof manifest.evidence === "object", "C5C version transition requires manifest evidence object");

  const deployFiles = await evidenceFiles(manifestDirectory, manifest.evidence.c5cDeploy, "c5cDeploy");
  const rollbackFiles = await evidenceFiles(manifestDirectory, manifest.evidence.c5cRollback, "c5cRollback");
  const initialArtifact = await deployArtifactByPurpose(deployFiles, "initial_release");
  const restoreArtifact = await deployArtifactByPurpose(deployFiles, "restore_after_rollback");
  const initial = await assertDeployVersion(initialArtifact, "initial_release");
  const restore = await assertDeployVersion(restoreArtifact, "restore_after_rollback");

  const rollbackMetadata = parseKeyValue(await readFile(uniqueFile(rollbackFiles, "metadata.txt", "c5cRollback"), "utf8"));
  assert(rollbackMetadata.action === "rollback", "c5cRollback metadata action must be rollback");
  assert(typeof rollbackMetadata.production_url === "string" && rollbackMetadata.production_url.trim(), "c5cRollback production_url is missing");
  assert(VERSION_ID_PATTERN.test(rollbackMetadata.target_version_id ?? ""), "c5cRollback target_version_id is invalid");
  const targetVersionId = rollbackMetadata.target_version_id.toLowerCase();
  const beforePayload = JSON.parse(await readFile(uniqueFile(rollbackFiles, "deployments-before.json", "c5cRollback"), "utf8"));
  const afterPayload = JSON.parse(await readFile(uniqueFile(rollbackFiles, "deployments-after-mutation.json", "c5cRollback"), "utf8"));
  const beforeVersionId = liveVersionFromDeploymentStatus(beforePayload, "c5cRollback pre-rollback state");
  const afterVersionId = liveVersionFromDeploymentStatus(afterPayload, "c5cRollback post-rollback state");

  assert(beforeVersionId === initial.versionId, "Rollback did not start from the initial_release Worker version");
  assert(targetVersionId !== beforeVersionId, "Rollback target equals the currently live Worker version; no-op rollback evidence is not accepted");
  assert(afterVersionId === targetVersionId, "Rollback target did not become the 100 percent live Worker version");
  assert(restore.versionId !== targetVersionId, "Final restoration deploy did not move production away from the rollback target version");
  assert(initial.productionUrl === rollbackMetadata.production_url, "Initial deploy and rollback production_url differ");
  assert(restore.productionUrl === rollbackMetadata.production_url, "Restoration deploy and rollback production_url differ");

  console.log(JSON.stringify({
    ok: true,
    gate: "C5C_VERSION_TRANSITION",
    initialVersionId: initial.versionId,
    rollbackTargetVersionId: targetVersionId,
    restorationVersionId: restore.versionId,
    productionUrl: restore.productionUrl,
  }, null, 2));
}

async function validateCommittedContract() {
  const deploy = await readFile(resolve(root, ".github/workflows/deploy.yml"), "utf8");
  const rollback = await readFile(resolve(root, ".github/workflows/rollback.yml"), "utf8");
  const runbook = await readFile(resolve(root, "docs/operations/C5C_DEPLOY_ROLLBACK.md"), "utf8");
  assert(deploy.includes("WRANGLER_OUTPUT_FILE_PATH") && deploy.includes("wrangler-deploy.ndjson"), "Deploy workflow must retain Wrangler structured deploy output");
  assert(deploy.includes("deployments-after-mutation.json"), "Deploy workflow must capture immediate post-deploy state");
  assert(deploy.includes("production_url=$PRODUCTION_URL"), "Deploy workflow must bind evidence to production_url");
  assert(rollback.includes("Rollback target is already the 100 percent live Worker version"), "Rollback workflow must reject no-op rollback targets");
  assert(rollback.includes("deployments-after-mutation.json"), "Rollback workflow must verify immediate post-rollback state");
  assert(rollback.includes("production_url=$PRODUCTION_URL"), "Rollback workflow must bind evidence to production_url");
  for (const token of ["wrangler-deploy.ndjson", "no-op rollback", "100 percent live", "version transition"]) {
    assert(runbook.includes(token), `C5C runbook missing Worker version-transition requirement: ${token}`);
  }
  console.log("C5C Worker version-transition contract PASS");
}

async function expectFailure(label, callback) {
  try {
    await callback();
  } catch {
    console.log(`PASS version-transition self-test rejects ${label}`);
    return;
  }
  throw new Error(`Version-transition self-test unexpectedly accepted ${label}`);
}

function deploymentStatus(versionId) {
  return { id: "deployment", strategy: "percentage", versions: [{ version_id: versionId, percentage: 100 }] };
}

async function writeDeployArtifact(directory, purpose, versionId, productionUrl) {
  await mkdir(directory, { recursive: true });
  await writeFile(join(directory, "metadata.txt"), `action=deploy\ndeployment_purpose=${purpose}\nproduction_url=${productionUrl}\n`, "utf8");
  await writeFile(join(directory, "wrangler-deploy.ndjson"), [
    JSON.stringify({ type: "wrangler-session", version: 1, wrangler_version: "4.131.2" }),
    JSON.stringify({ type: "deploy", version: 1, worker_name: EXPECTED_WORKER_NAME, worker_tag: "worker-tag", version_id: versionId, targets: [productionUrl] }),
  ].join("\n") + "\n", "utf8");
  await writeFile(join(directory, "deployments-after-mutation.json"), JSON.stringify(deploymentStatus(versionId), null, 2), "utf8");
}

async function selfTest() {
  const temp = await mkdtemp(join(tmpdir(), "cas-c5c-version-transition-"));
  const initialVersion = "11111111-1111-4111-8111-111111111111";
  const rollbackVersion = "22222222-2222-4222-8222-222222222222";
  const restoreVersion = "33333333-3333-4333-8333-333333333333";
  const otherVersion = "44444444-4444-4444-8444-444444444444";
  const productionUrl = "https://example.invalid";
  try {
    await writeDeployArtifact(join(temp, "deploy-initial"), "initial_release", initialVersion, productionUrl);
    await writeDeployArtifact(join(temp, "deploy-restore"), "restore_after_rollback", restoreVersion, productionUrl);
    await mkdir(join(temp, "rollback"), { recursive: true });
    await writeFile(join(temp, "rollback/metadata.txt"), `action=rollback\ntarget_version_id=${rollbackVersion}\nproduction_url=${productionUrl}\n`, "utf8");
    await writeFile(join(temp, "rollback/deployments-before.json"), JSON.stringify(deploymentStatus(initialVersion), null, 2), "utf8");
    await writeFile(join(temp, "rollback/deployments-after-mutation.json"), JSON.stringify(deploymentStatus(rollbackVersion), null, 2), "utf8");
    const manifestPath = join(temp, "manifest.json");
    await writeFile(manifestPath, JSON.stringify({ evidence: {
      c5cDeploy: { status: "PASS", files: ["deploy-initial", "deploy-restore"] },
      c5cRollback: { status: "PASS", files: ["rollback"] },
    } }, null, 2), "utf8");

    await validateManifest(manifestPath);

    await writeFile(join(temp, "rollback/metadata.txt"), `action=rollback\ntarget_version_id=${initialVersion}\nproduction_url=${productionUrl}\n`, "utf8");
    await expectFailure("no-op rollback target", () => validateManifest(manifestPath));
    await writeFile(join(temp, "rollback/metadata.txt"), `action=rollback\ntarget_version_id=${rollbackVersion}\nproduction_url=${productionUrl}\n`, "utf8");

    await writeFile(join(temp, "rollback/deployments-before.json"), JSON.stringify(deploymentStatus(otherVersion), null, 2), "utf8");
    await expectFailure("rollback not starting from initial release version", () => validateManifest(manifestPath));
    await writeFile(join(temp, "rollback/deployments-before.json"), JSON.stringify(deploymentStatus(initialVersion), null, 2), "utf8");

    await writeFile(join(temp, "rollback/deployments-after-mutation.json"), JSON.stringify(deploymentStatus(otherVersion), null, 2), "utf8");
    await expectFailure("rollback target not becoming live", () => validateManifest(manifestPath));
    await writeFile(join(temp, "rollback/deployments-after-mutation.json"), JSON.stringify(deploymentStatus(rollbackVersion), null, 2), "utf8");

    await writeFile(join(temp, "deploy-restore/deployments-after-mutation.json"), JSON.stringify(deploymentStatus(otherVersion), null, 2), "utf8");
    await expectFailure("restoration structured version not becoming live", () => validateManifest(manifestPath));
    await writeFile(join(temp, "deploy-restore/deployments-after-mutation.json"), JSON.stringify(deploymentStatus(restoreVersion), null, 2), "utf8");

    await writeFile(join(temp, "rollback/metadata.txt"), `action=rollback\ntarget_version_id=${rollbackVersion}\nproduction_url=https://different.invalid\n`, "utf8");
    await expectFailure("production environment mismatch", () => validateManifest(manifestPath));
    console.log("C5C Worker version-transition self-test PASS");
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
}

await validateCommittedContract();
if (process.env.C5F_MANIFEST_FILE) await validateManifest(process.env.C5F_MANIFEST_FILE);
if (process.env.C5C_VERSION_TRANSITION_SELF_TEST === "1") await selfTest();
