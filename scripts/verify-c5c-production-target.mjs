import { access, mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function normalizedPathname(value) {
  let path = value || "/";
  if (path.endsWith("*")) path = path.slice(0, -1);
  path = path.replace(/\/+$/, "");
  return path || "/";
}

function parseHttpUrl(value, label) {
  assert(typeof value === "string" && value.trim(), `${label} is missing`);
  let parsed;
  try {
    parsed = new URL(value);
  } catch (error) {
    throw new Error(`${label} is not a valid URL: ${error instanceof Error ? error.message : String(error)}`);
  }
  assert(parsed.protocol === "https:" || parsed.protocol === "http:", `${label} must use http or https`);
  return parsed;
}

function targetMatchesProductionUrl(productionUrl, target) {
  let production;
  let trigger;
  try {
    production = parseHttpUrl(productionUrl, "productionUrl");
    trigger = parseHttpUrl(target, "deploy target");
  } catch {
    return false;
  }
  if (production.origin !== trigger.origin) return false;
  const productionPath = normalizedPathname(production.pathname);
  const targetPath = normalizedPathname(trigger.pathname);
  if (targetPath === "/") return true;
  return productionPath === targetPath || productionPath.startsWith(`${targetPath}/`);
}

async function readState(path, label) {
  let value;
  try {
    value = JSON.parse(await readFile(path, "utf8"));
  } catch (error) {
    throw new Error(`${label} is not valid JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
  assert(value?.gate === "C5C_DEPLOY_VERSION_STATE", `${label} has unexpected gate`);
  assert(value?.status === "PASS", `${label} is not PASS`);
  assert(typeof value.productionUrl === "string" && value.productionUrl.trim(), `${label} productionUrl is missing`);
  assert(Array.isArray(value.targets) && value.targets.length > 0, `${label} has no Wrangler deploy targets`);
  assert(
    value.targets.some((target) => typeof target === "string" && targetMatchesProductionUrl(value.productionUrl, target)),
    `${label} productionUrl is not represented by any Wrangler deploy HTTP target`,
  );
  return value;
}

async function collectFiles(path) {
  const info = await stat(path);
  if (info.isFile()) return [path];
  if (!info.isDirectory()) return [];
  const files = [];
  for (const entry of await readdir(path, { withFileTypes: true })) {
    const child = join(path, entry.name);
    if (entry.isDirectory()) files.push(...await collectFiles(child));
    else if (entry.isFile()) files.push(child);
  }
  return files;
}

async function manifestDeployStateFiles(manifestPathInput) {
  const manifestPath = resolve(process.cwd(), manifestPathInput);
  const manifestDirectory = resolve(manifestPath, "..");
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  const gate = manifest.evidence?.c5cDeploy;
  assert(gate?.status === "PASS", "C5F target binding requires c5cDeploy=PASS");
  assert(Array.isArray(gate.files) && gate.files.length > 0, "C5F target binding requires retained c5cDeploy files");
  const files = [];
  for (const declared of gate.files) {
    assert(typeof declared === "string" && declared.trim(), "c5cDeploy.files contains an empty path");
    const path = resolve(manifestDirectory, declared);
    await access(path);
    files.push(...await collectFiles(path));
  }
  const states = files.filter((path) => basename(path) === "c5c-deploy-version-state.json");
  assert(states.length === 2, `C5F target binding requires exactly two deploy version-state records; found ${states.length}`);
  return states;
}

async function validateManifest(manifestPath) {
  const states = await Promise.all((await manifestDeployStateFiles(manifestPath)).map((path, index) => readState(path, `deploy version-state ${index + 1}`)));
  const purposes = states.map((state) => state.deploymentPurpose).sort();
  assert(
    purposes.length === 2 && purposes[0] === "initial_release" && purposes[1] === "restore_after_rollback",
    "C5F target binding requires initial_release and restore_after_rollback deploy states",
  );
  console.log(JSON.stringify({
    ok: true,
    gate: "C5F_PRODUCTION_TARGET_BINDING",
    productionUrls: [...new Set(states.map((state) => state.productionUrl))],
    deploymentPurposes: purposes,
  }, null, 2));
}

async function expectFailure(label, callback) {
  try {
    await callback();
  } catch {
    console.log(`PASS production-target self-test rejects ${label}`);
    return;
  }
  throw new Error(`Production-target self-test unexpectedly accepted ${label}`);
}

async function selfTest() {
  const temp = await mkdtemp(join(tmpdir(), "cas-c5c-target-"));
  try {
    const statePath = join(temp, "state.json");
    const state = {
      gate: "C5C_DEPLOY_VERSION_STATE",
      status: "PASS",
      deploymentPurpose: "initial_release",
      productionUrl: "https://example.invalid/game",
      targets: ["https://example.invalid/game/*", "https://fallback.invalid"],
    };
    await writeFile(statePath, JSON.stringify(state), "utf8");
    await readState(statePath, "valid route-bound state");

    await writeFile(statePath, JSON.stringify({ ...state, productionUrl: "https://other.invalid/game" }), "utf8");
    await expectFailure("different production host", () => readState(statePath, "wrong-host state"));

    await writeFile(statePath, JSON.stringify({ ...state, productionUrl: "https://example.invalid/other" }), "utf8");
    await expectFailure("production path outside Worker route", () => readState(statePath, "wrong-path state"));

    const initialDir = join(temp, "initial");
    const restoreDir = join(temp, "restore");
    await mkdir(initialDir);
    await mkdir(restoreDir);
    await writeFile(join(initialDir, "c5c-deploy-version-state.json"), JSON.stringify({
      ...state,
      productionUrl: "https://example.invalid/game",
      deploymentPurpose: "initial_release",
    }), "utf8");
    await writeFile(join(restoreDir, "c5c-deploy-version-state.json"), JSON.stringify({
      ...state,
      productionUrl: "https://example.invalid/game",
      deploymentPurpose: "restore_after_rollback",
    }), "utf8");
    const manifestPath = join(temp, "manifest.json");
    await writeFile(manifestPath, JSON.stringify({
      releaseSha: "a".repeat(40),
      evidence: { c5cDeploy: { status: "PASS", files: ["initial", "restore"] } },
    }), "utf8");
    await validateManifest(manifestPath);

    await writeFile(join(restoreDir, "c5c-deploy-version-state.json"), JSON.stringify({
      ...state,
      productionUrl: "https://example.invalid/other",
      deploymentPurpose: "restore_after_rollback",
    }), "utf8");
    await expectFailure("manifest containing an unbound restoration endpoint", () => validateManifest(manifestPath));

    console.log("C5C production-target binding validator self-test PASS");
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
}

if (process.env.C5C_TARGET_STATE_FILE) {
  const state = await readState(resolve(process.cwd(), process.env.C5C_TARGET_STATE_FILE), "C5C target state");
  console.log(JSON.stringify({
    ok: true,
    gate: "C5C_PRODUCTION_TARGET_BINDING",
    deploymentPurpose: state.deploymentPurpose,
    productionUrl: state.productionUrl,
    targets: state.targets,
  }, null, 2));
}
if (process.env.C5F_MANIFEST_FILE) await validateManifest(process.env.C5F_MANIFEST_FILE);
if (process.env.C5C_TARGET_SELF_TEST === "1") await selfTest();
