import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function readJson(path, label) {
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch (error) {
    throw new Error(`${label} is not valid JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function soleLiveVersion(status, label, required = true) {
  assert(status && typeof status === "object", `${label} must be an object`);
  assert(Array.isArray(status.versions), `${label}.versions must be an array`);
  const fullTraffic = status.versions.filter((entry) => Number(entry?.percentage) === 100 && typeof entry?.version_id === "string" && entry.version_id.trim());
  const isSole = status.versions.length === 1 && fullTraffic.length === 1;
  if (!isSole) {
    if (!required) return null;
    throw new Error(`${label} must contain exactly one Worker version at 100% traffic`);
  }
  return fullTraffic[0].version_id;
}

async function readWranglerDeploy(path) {
  const text = await readFile(path, "utf8");
  const entries = [];
  for (const [index, raw] of text.split(/\r?\n/).entries()) {
    const line = raw.trim();
    if (!line) continue;
    try {
      entries.push(JSON.parse(line));
    } catch (error) {
      throw new Error(`Wrangler structured output line ${index + 1} is invalid JSON: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  const deploys = entries.filter((entry) => entry?.type === "deploy");
  assert(deploys.length === 1, `Wrangler structured output must contain exactly one deploy entry; found ${deploys.length}`);
  const deploy = deploys[0];
  assert(typeof deploy.version_id === "string" && deploy.version_id.trim(), "Wrangler deploy entry is missing version_id");
  assert(typeof deploy.worker_name === "string" && deploy.worker_name.trim(), "Wrangler deploy entry is missing worker_name");
  assert(typeof deploy.worker_tag === "string" && deploy.worker_tag.trim(), "Wrangler deploy entry is missing worker_tag");
  return deploy;
}

async function writeRecord(path, value) {
  if (!path) return;
  await mkdir(resolve(path, ".."), { recursive: true }).catch(() => {});
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

async function validateDeploy(options) {
  const before = await readJson(options.beforeFile, "deployments-before.json");
  const after = await readJson(options.afterFile, "deployments-live.json");
  const deploy = await readWranglerDeploy(options.wranglerOutputFile);
  const beforeLiveVersionId = soleLiveVersion(before, "deployments-before.json", false);
  const afterLiveVersionId = soleLiveVersion(after, "deployments-live.json", true);

  assert(["initial_release", "restore_after_rollback", "post_release_update"].includes(options.purpose), `Unsupported deployment purpose: ${options.purpose}`);
  if (options.expectedWorkerName) assert(deploy.worker_name === options.expectedWorkerName, `Unexpected Worker name: ${deploy.worker_name}`);
  assert(afterLiveVersionId === deploy.version_id, "Post-deploy live version does not match Wrangler deploy version_id");

  const record = {
    gate: "C5C_DEPLOY_VERSION_STATE",
    status: "PASS",
    deploymentPurpose: options.purpose,
    productionUrl: options.productionUrl,
    workerName: deploy.worker_name,
    workerTag: deploy.worker_tag,
    deployedVersionId: deploy.version_id,
    beforeLiveVersionId,
    afterLiveVersionId,
    beforeDeploymentId: typeof before.id === "string" ? before.id : null,
    afterDeploymentId: typeof after.id === "string" ? after.id : null,
    targets: Array.isArray(deploy.targets) ? deploy.targets : [],
    wranglerTimestamp: deploy.timestamp ?? null,
  };
  await writeRecord(options.outputFile, record);
  return record;
}

async function validateRollbackPre(options) {
  const before = await readJson(options.beforeFile, "deployments-before.json");
  const beforeLiveVersionId = soleLiveVersion(before, "deployments-before.json", true);
  assert(typeof options.targetVersionId === "string" && options.targetVersionId.trim(), "Rollback target version ID is required");
  assert(beforeLiveVersionId !== options.targetVersionId, "Refusing no-op rollback: target version is already the sole 100% live version");
  const record = {
    gate: "C5C_ROLLBACK_PREFLIGHT",
    status: "PASS",
    productionUrl: options.productionUrl,
    beforeLiveVersionId,
    targetVersionId: options.targetVersionId,
    beforeDeploymentId: typeof before.id === "string" ? before.id : null,
  };
  await writeRecord(options.outputFile, record);
  return record;
}

async function validateRollback(options) {
  const before = await readJson(options.beforeFile, "deployments-before.json");
  const after = await readJson(options.afterFile, "deployments-live.json");
  const beforeLiveVersionId = soleLiveVersion(before, "deployments-before.json", true);
  const afterLiveVersionId = soleLiveVersion(after, "deployments-live.json", true);
  assert(typeof options.targetVersionId === "string" && options.targetVersionId.trim(), "Rollback target version ID is required");
  assert(beforeLiveVersionId !== options.targetVersionId, "Rollback evidence is a no-op: target version was already live before rollback");
  assert(afterLiveVersionId === options.targetVersionId, "Post-rollback live version does not match target_version_id");

  const record = {
    gate: "C5C_ROLLBACK_VERSION_STATE",
    status: "PASS",
    productionUrl: options.productionUrl,
    beforeLiveVersionId,
    targetVersionId: options.targetVersionId,
    afterLiveVersionId,
    beforeDeploymentId: typeof before.id === "string" ? before.id : null,
    afterDeploymentId: typeof after.id === "string" ? after.id : null,
  };
  await writeRecord(options.outputFile, record);
  return record;
}

async function expectFailure(label, callback) {
  try {
    await callback();
  } catch {
    console.log(`PASS version-state self-test rejects ${label}`);
    return;
  }
  throw new Error(`Version-state self-test unexpectedly accepted ${label}`);
}

async function selfTest() {
  const temp = await mkdtemp(join(tmpdir(), "cas-c5c-version-state-"));
  try {
    const beforeFile = join(temp, "before.json");
    const afterFile = join(temp, "after.json");
    const wranglerFile = join(temp, "wrangler.ndjson");
    const status = (versionId, id) => ({ id, versions: [{ version_id: versionId, percentage: 100 }] });
    const deployEntry = (versionId, workerTag = "worker-tag") => ({
      version: 1,
      type: "deploy",
      worker_name: "cas-flight-simulator",
      worker_tag: workerTag,
      version_id: versionId,
      targets: ["https://example.invalid"],
      worker_name_overridden: false,
      timestamp: "2026-01-01T00:00:00.000Z",
    });

    await writeFile(beforeFile, JSON.stringify(status("version-old", "deployment-old")), "utf8");
    await writeFile(afterFile, JSON.stringify(status("version-new", "deployment-new")), "utf8");
    await writeFile(wranglerFile, `${JSON.stringify({ type: "wrangler-session", version: 1 })}\n${JSON.stringify(deployEntry("version-new"))}\n`, "utf8");
    const deploy = await validateDeploy({
      beforeFile,
      afterFile,
      wranglerOutputFile: wranglerFile,
      purpose: "initial_release",
      productionUrl: "https://example.invalid",
      expectedWorkerName: "cas-flight-simulator",
    });
    assert(deploy.deployedVersionId === "version-new", "Valid deploy self-test did not resolve deployed version");

    const postReleaseDeploy = await validateDeploy({
      beforeFile,
      afterFile,
      wranglerOutputFile: wranglerFile,
      purpose: "post_release_update",
      productionUrl: "https://example.invalid",
      expectedWorkerName: "cas-flight-simulator",
    });
    assert(postReleaseDeploy.deploymentPurpose === "post_release_update", "Post-release deploy purpose was not accepted");

    await writeFile(afterFile, JSON.stringify(status("version-other", "deployment-other")), "utf8");
    await expectFailure("deploy version/status mismatch", () => validateDeploy({
      beforeFile,
      afterFile,
      wranglerOutputFile: wranglerFile,
      purpose: "initial_release",
      productionUrl: "https://example.invalid",
      expectedWorkerName: "cas-flight-simulator",
    }));

    await writeFile(beforeFile, JSON.stringify(status("version-new", "deployment-new")), "utf8");
    await writeFile(afterFile, JSON.stringify(status("version-old", "deployment-rollback")), "utf8");
    await validateRollbackPre({ beforeFile, targetVersionId: "version-old", productionUrl: "https://example.invalid" });
    const rollback = await validateRollback({ beforeFile, afterFile, targetVersionId: "version-old", productionUrl: "https://example.invalid" });
    assert(rollback.afterLiveVersionId === "version-old", "Valid rollback self-test did not resolve target version");

    await expectFailure("no-op rollback", () => validateRollbackPre({
      beforeFile,
      targetVersionId: "version-new",
      productionUrl: "https://example.invalid",
    }));

    await writeFile(afterFile, JSON.stringify(status("version-other", "deployment-wrong")), "utf8");
    await expectFailure("rollback post-state mismatch", () => validateRollback({
      beforeFile,
      afterFile,
      targetVersionId: "version-old",
      productionUrl: "https://example.invalid",
    }));

    console.log("C5C Worker version-state validator self-test PASS");
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
}

async function main() {
  if (process.env.C5C_VERSION_STATE_SELF_TEST === "1") await selfTest();

  const mode = process.env.C5C_VERSION_STATE_MODE;
  if (!mode) return;
  const common = {
    beforeFile: process.env.C5C_DEPLOYMENTS_BEFORE_FILE,
    afterFile: process.env.C5C_DEPLOYMENTS_AFTER_FILE,
    productionUrl: process.env.C5C_PRODUCTION_URL ?? "",
    outputFile: process.env.C5C_VERSION_STATE_OUTPUT,
  };
  assert(common.beforeFile, "C5C_DEPLOYMENTS_BEFORE_FILE is required");

  if (mode === "deploy") {
    assert(common.afterFile, "C5C_DEPLOYMENTS_AFTER_FILE is required for deploy mode");
    assert(process.env.C5C_WRANGLER_OUTPUT_FILE, "C5C_WRANGLER_OUTPUT_FILE is required for deploy mode");
    const value = await validateDeploy({
      ...common,
      wranglerOutputFile: process.env.C5C_WRANGLER_OUTPUT_FILE,
      purpose: process.env.C5C_DEPLOYMENT_PURPOSE,
      expectedWorkerName: process.env.C5C_EXPECTED_WORKER_NAME,
    });
    console.log(JSON.stringify(value, null, 2));
    return;
  }

  if (mode === "rollback-pre") {
    const value = await validateRollbackPre({
      ...common,
      targetVersionId: process.env.C5C_TARGET_VERSION_ID,
    });
    console.log(JSON.stringify(value, null, 2));
    return;
  }

  if (mode === "rollback") {
    assert(common.afterFile, "C5C_DEPLOYMENTS_AFTER_FILE is required for rollback mode");
    const value = await validateRollback({
      ...common,
      targetVersionId: process.env.C5C_TARGET_VERSION_ID,
    });
    console.log(JSON.stringify(value, null, 2));
    return;
  }

  throw new Error(`Unsupported C5C_VERSION_STATE_MODE=${mode}`);
}

await main();
