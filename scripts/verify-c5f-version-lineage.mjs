import { access, mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";

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
  assert(entry.status === "PASS", `C5F version lineage requires ${gate}=PASS`);
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

async function deployByPurpose(files, purpose) {
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

async function deployState(deploy, purpose) {
  const label = `c5cDeploy.${purpose}`;
  const state = JSON.parse(await readFile(uniqueFile(deploy.files, "c5c-deploy-version-state.json", label), "utf8"));
  assert(state.gate === "C5C_DEPLOY_VERSION_STATE" && state.status === "PASS", `${label} version-state record is not PASS`);
  assert(state.deploymentPurpose === purpose, `${label} version-state purpose mismatch`);
  assert(typeof state.productionUrl === "string" && state.productionUrl, `${label} productionUrl is missing`);
  assert(typeof state.workerName === "string" && state.workerName, `${label} workerName is missing`);
  assert(typeof state.workerTag === "string" && state.workerTag, `${label} workerTag is missing`);
  assert(typeof state.deployedVersionId === "string" && state.deployedVersionId, `${label} deployedVersionId is missing`);
  assert(state.afterLiveVersionId === state.deployedVersionId, `${label} deployed version is not the final 100% live version`);
  assert(deploy.metadata.production_url === state.productionUrl, `${label} production URL differs between metadata and version-state record`);
  return state;
}

async function validateVersionLineage(manifestPathInput) {
  const manifestPath = resolve(process.cwd(), manifestPathInput);
  const manifestDirectory = dirname(manifestPath);
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  assert(/^[0-9a-f]{40}$/i.test(manifest.releaseSha ?? ""), "C5F version lineage requires a full releaseSha");

  const deployFiles = await evidenceFiles(manifestDirectory, manifest.evidence?.c5cDeploy, "c5cDeploy");
  const rollbackFiles = await evidenceFiles(manifestDirectory, manifest.evidence?.c5cRollback, "c5cRollback");
  const initial = await deployByPurpose(deployFiles, "initial_release");
  const restore = await deployByPurpose(deployFiles, "restore_after_rollback");
  const initialState = await deployState(initial, "initial_release");
  const restoreState = await deployState(restore, "restore_after_rollback");

  const rollbackMetadata = parseKeyValue(await readFile(uniqueFile(rollbackFiles, "metadata.txt", "c5cRollback"), "utf8"));
  const rollbackState = JSON.parse(await readFile(uniqueFile(rollbackFiles, "c5c-rollback-version-state.json", "c5cRollback"), "utf8"));
  assert(rollbackState.gate === "C5C_ROLLBACK_VERSION_STATE" && rollbackState.status === "PASS", "c5cRollback version-state record is not PASS");
  assert(typeof rollbackState.productionUrl === "string" && rollbackState.productionUrl, "c5cRollback productionUrl is missing");
  assert(rollbackMetadata.production_url === rollbackState.productionUrl, "c5cRollback production URL differs between metadata and version-state record");
  assert(rollbackMetadata.target_version_id === rollbackState.targetVersionId, "c5cRollback target version differs between metadata and version-state record");
  assert(rollbackState.beforeLiveVersionId !== rollbackState.targetVersionId, "c5cRollback evidence is a no-op rollback");
  assert(rollbackState.afterLiveVersionId === rollbackState.targetVersionId, "c5cRollback target did not become the final 100% live version");

  assert(initialState.deployedVersionId === rollbackState.beforeLiveVersionId, "Rollback did not start from the initial release Worker version");
  assert(restoreState.beforeLiveVersionId === rollbackState.targetVersionId, "Restoration did not start from the rollback target Worker version");
  assert(restoreState.deployedVersionId !== rollbackState.targetVersionId, "Restoration did not replace the rollback target with a release Worker version");
  assert(initialState.productionUrl === rollbackState.productionUrl && rollbackState.productionUrl === restoreState.productionUrl, "Production URL changed across initial deploy, rollback, and restoration");
  assert(initialState.workerName === restoreState.workerName, "Worker name changed between initial and restoration deploys");
  assert(initialState.workerTag === restoreState.workerTag, "Worker identity tag changed between initial and restoration deploys");

  console.log(JSON.stringify({
    ok: true,
    gate: "C5F_WORKER_VERSION_LINEAGE",
    releaseSha: manifest.releaseSha,
    workerName: initialState.workerName,
    workerTag: initialState.workerTag,
    productionUrl: initialState.productionUrl,
    initialVersionId: initialState.deployedVersionId,
    rollbackVersionId: rollbackState.targetVersionId,
    restoredVersionId: restoreState.deployedVersionId,
  }, null, 2));
}

async function expectFailure(label, callback) {
  try {
    await callback();
  } catch {
    console.log(`PASS C5F version-lineage self-test rejects ${label}`);
    return;
  }
  throw new Error(`C5F version-lineage self-test unexpectedly accepted ${label}`);
}

async function writeFixture(root, overrides = {}) {
  const initialDir = join(root, "initial");
  const rollbackDir = join(root, "rollback");
  const restoreDir = join(root, "restore");
  for (const directory of [initialDir, rollbackDir, restoreDir]) await mkdir(directory, { recursive: true });

  const productionUrl = overrides.productionUrl ?? "https://example.invalid";
  const workerTag = overrides.workerTag ?? "worker-tag-1";
  const initialVersion = overrides.initialVersion ?? "version-release-initial";
  const rollbackVersion = overrides.rollbackVersion ?? "version-known-good";
  const restoreBefore = overrides.restoreBefore ?? rollbackVersion;
  const restoredVersion = overrides.restoredVersion ?? "version-release-restored";

  await writeFile(join(initialDir, "metadata.txt"), `action=deploy\ndeployment_purpose=initial_release\ngit_sha=${"a".repeat(40)}\nproduction_url=${productionUrl}\n`, "utf8");
  await writeFile(join(initialDir, "c5c-deploy-version-state.json"), JSON.stringify({
    gate: "C5C_DEPLOY_VERSION_STATE", status: "PASS", deploymentPurpose: "initial_release", productionUrl,
    workerName: "cas-flight-simulator", workerTag, deployedVersionId: initialVersion,
    beforeLiveVersionId: "version-previous", afterLiveVersionId: initialVersion,
  }), "utf8");

  await writeFile(join(rollbackDir, "metadata.txt"), `action=rollback\ngovernance_git_sha=${"a".repeat(40)}\ntarget_version_id=${rollbackVersion}\nproduction_url=${productionUrl}\n`, "utf8");
  await writeFile(join(rollbackDir, "c5c-rollback-version-state.json"), JSON.stringify({
    gate: "C5C_ROLLBACK_VERSION_STATE", status: "PASS", productionUrl,
    beforeLiveVersionId: overrides.rollbackBefore ?? initialVersion,
    targetVersionId: rollbackVersion,
    afterLiveVersionId: overrides.rollbackAfter ?? rollbackVersion,
  }), "utf8");

  await writeFile(join(restoreDir, "metadata.txt"), `action=deploy\ndeployment_purpose=restore_after_rollback\ngit_sha=${"a".repeat(40)}\nproduction_url=${overrides.restoreProductionUrl ?? productionUrl}\n`, "utf8");
  await writeFile(join(restoreDir, "c5c-deploy-version-state.json"), JSON.stringify({
    gate: "C5C_DEPLOY_VERSION_STATE", status: "PASS", deploymentPurpose: "restore_after_rollback",
    productionUrl: overrides.restoreProductionUrl ?? productionUrl,
    workerName: "cas-flight-simulator", workerTag: overrides.restoreWorkerTag ?? workerTag,
    deployedVersionId: restoredVersion, beforeLiveVersionId: restoreBefore, afterLiveVersionId: restoredVersion,
  }), "utf8");

  const manifest = {
    releaseSha: "a".repeat(40),
    evidence: {
      c5cDeploy: { status: "PASS", files: ["initial", "restore"] },
      c5cRollback: { status: "PASS", files: ["rollback"] },
    },
  };
  const manifestPath = join(root, "manifest.json");
  await writeFile(manifestPath, JSON.stringify(manifest), "utf8");
  return manifestPath;
}

async function selfTest() {
  const temp = await mkdtemp(join(tmpdir(), "cas-c5f-version-lineage-"));
  try {
    let fixture = join(temp, "valid");
    await mkdir(fixture);
    await validateVersionLineage(await writeFixture(fixture));

    fixture = join(temp, "noop");
    await mkdir(fixture);
    await expectFailure("no-op rollback", async () => validateVersionLineage(await writeFixture(fixture, {
      rollbackVersion: "version-release-initial",
      rollbackAfter: "version-release-initial",
      restoreBefore: "version-release-initial",
    })));

    fixture = join(temp, "wrong-start");
    await mkdir(fixture);
    await expectFailure("rollback starting from another live version", async () => validateVersionLineage(await writeFixture(fixture, {
      rollbackBefore: "version-unrelated",
    })));

    fixture = join(temp, "wrong-restore-start");
    await mkdir(fixture);
    await expectFailure("restoration not starting from rollback target", async () => validateVersionLineage(await writeFixture(fixture, {
      restoreBefore: "version-unrelated",
    })));

    fixture = join(temp, "worker-mismatch");
    await mkdir(fixture);
    await expectFailure("Worker identity mismatch", async () => validateVersionLineage(await writeFixture(fixture, {
      restoreWorkerTag: "different-worker-tag",
    })));

    fixture = join(temp, "url-mismatch");
    await mkdir(fixture);
    await expectFailure("production URL mismatch", async () => validateVersionLineage(await writeFixture(fixture, {
      restoreProductionUrl: "https://different.invalid",
    })));

    console.log("C5F Worker version-lineage self-test PASS");
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
}

if (process.env.C5F_MANIFEST_FILE) await validateVersionLineage(process.env.C5F_MANIFEST_FILE);
if (process.env.C5F_VERSION_LINEAGE_SELF_TEST === "1") await selfTest();
