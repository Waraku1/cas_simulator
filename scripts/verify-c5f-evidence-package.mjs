import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { access, copyFile, cp, mkdir, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { basename, dirname, join, relative, resolve } from "node:path";

const root = new URL("..", import.meta.url).pathname;
const templatePath = resolve(root, "docs/evidence/templates/c5f-package.template.json");
const runbookPath = resolve(root, "docs/operations/C5F_CAS_EVIDENCE_PACKAGE.md");
const requiredGates = [
  "c4dProduction",
  "c5bPerformance",
  "c5cDeploy",
  "c5cRollback",
  "c5dSchool",
  "c5eHumanQa",
  "finalMainCi",
];
const localEvidenceRequired = new Set(["c5bPerformance", "c5dSchool", "c5eHumanQa"]);
const requiredDocs = [
  "README.md",
  "docs/architecture/C0_FOUNDATION.md",
  "docs/architecture/C1_FLIGHT.md",
  "docs/architecture/C2_WORLD_THEATER.md",
  "docs/architecture/C3_MULTIPLAYER.md",
  "docs/architecture/C4_PRODUCT_CONTRACT.md",
  "docs/architecture/C4A_AUTH_HOME.md",
  "docs/architecture/C4D_RATING.md",
  "docs/operations/C4D_PRODUCTION_GATE.md",
  "docs/operations/C5A_SECURITY_ACCESSIBILITY.md",
  "docs/operations/C5B_PERFORMANCE_EVIDENCE.md",
  "docs/operations/C5C_DEPLOY_ROLLBACK.md",
  "docs/operations/C5D_SCHOOL_REGRESSION.md",
  "docs/operations/C5E_HUMAN_QA_VISUAL_SIGNOFF.md",
  "docs/operations/C5F_CAS_EVIDENCE_PACKAGE.md",
  "docs/operations/SCHOOL_NETWORK_COMPATIBILITY.md",
  "docs/project/AI_EXECUTION_POLICY.md",
  "docs/project/C5_STATUS.md",
];

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function nonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function validateCommon(manifest) {
  assert(manifest && typeof manifest === "object", "C5F manifest must be a JSON object");
  assert(manifest.gate === "C5F_CAS_EVIDENCE_PACKAGE", "Unexpected C5F gate identifier");
  assert(manifest.repository === "Waraku1/cas_simulator", "Unexpected C5F repository identifier");
  assert(manifest.evidence && typeof manifest.evidence === "object", "C5F manifest requires evidence object");

  for (const gate of requiredGates) {
    const entry = manifest.evidence[gate];
    assert(entry && typeof entry === "object", `Missing C5F evidence gate: ${gate}`);
    assert(typeof entry.status === "string", `${gate}.status must be a string`);
    assert(Array.isArray(entry.files), `${gate}.files must be an array`);
    assert(Array.isArray(entry.refs), `${gate}.refs must be an array`);
    assert(typeof entry.notes === "string", `${gate}.notes must be a string`);
  }
}

async function validateContract() {
  for (const path of requiredDocs) await access(resolve(root, path));
  await access(resolve(root, "scripts/verify-c5e-human-qa.mjs"));

  const template = JSON.parse(await readFile(templatePath, "utf8"));
  validateCommon(template);
  assert(template.releaseSha === "", "C5F template releaseSha must remain blank");
  for (const gate of requiredGates) {
    const entry = template.evidence[gate];
    assert(entry.status === "PENDING", `C5F template gate ${gate} must remain PENDING`);
    assert(entry.files.length === 0 && entry.refs.length === 0, `C5F template gate ${gate} evidence references must remain empty`);
  }

  const runbook = await readFile(runbookPath, "utf8");
  for (const gate of requiredGates) assert(runbook.includes(gate), `C5F runbook missing gate: ${gate}`);
  assert(runbook.includes("CHECKSUMS.sha256"), "C5F runbook must document checksum output");
  assert(runbook.includes("C5F_MANIFEST_FILE"), "C5F runbook must document package generation command");

  console.log(JSON.stringify({ ok: true, gate: "C5F_PACKAGE_CONTRACT", requiredDocs: requiredDocs.length, requiredEvidenceGates: requiredGates.length }, null, 2));
}

async function collectFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await collectFiles(path));
    else if (entry.isFile()) files.push(path);
  }
  return files;
}

async function sha256(path) {
  const data = await readFile(path);
  return createHash("sha256").update(data).digest("hex");
}

async function buildPackage(manifestPathInput) {
  const manifestPath = resolve(process.cwd(), manifestPathInput);
  const manifestDirectory = dirname(manifestPath);
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  validateCommon(manifest);

  assert(/^[0-9a-f]{40}$/i.test(manifest.releaseSha ?? ""), "C5F requires a full 40-character releaseSha");
  assert(nonEmptyString(manifest.releaseLabel), "C5F requires releaseLabel");
  assert(nonEmptyString(manifest.preparedBy), "C5F requires preparedBy");
  assert(nonEmptyString(manifest.preparedAt) && Number.isFinite(Date.parse(manifest.preparedAt)), "C5F requires a valid preparedAt timestamp");
  assert(nonEmptyString(manifest.summary), "C5F requires a concise summary");

  const checkoutSha = execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim();
  assert(checkoutSha === manifest.releaseSha, `C5F releaseSha ${manifest.releaseSha} does not match current checkout ${checkoutSha}`);

  for (const gate of requiredGates) {
    const entry = manifest.evidence[gate];
    assert(entry.status === "PASS", `C5F gate ${gate} is not PASS: ${entry.status}`);
    assert(entry.files.length + entry.refs.length > 0, `C5F gate ${gate} has no evidence reference`);
    if (localEvidenceRequired.has(gate)) {
      assert(entry.files.length > 0, `C5F gate ${gate} requires at least one local evidence file`);
    }
    for (const ref of entry.refs) assert(nonEmptyString(ref), `${gate}.refs contains an empty reference`);
    for (const file of entry.files) assert(nonEmptyString(file), `${gate}.files contains an empty path`);
  }

  const c5ePath = resolve(manifestDirectory, manifest.evidence.c5eHumanQa.files[0]);
  await access(c5ePath);
  execFileSync(process.execPath, [resolve(root, "scripts/verify-c5e-human-qa.mjs")], {
    cwd: root,
    env: { ...process.env, C5E_EVIDENCE_FILE: c5ePath },
    stdio: "inherit",
  });

  const outputRoot = resolve(root, ".c5-evidence/cas-package", manifest.releaseSha);
  await rm(outputRoot, { recursive: true, force: true });
  await mkdir(outputRoot, { recursive: true });

  for (const source of requiredDocs) {
    const from = resolve(root, source);
    const to = resolve(outputRoot, "repository", source);
    await mkdir(dirname(to), { recursive: true });
    await copyFile(from, to);
  }

  await copyFile(manifestPath, resolve(outputRoot, "manifest.json"));

  const copiedEvidence = {};
  for (const gate of requiredGates) {
    copiedEvidence[gate] = [];
    const entry = manifest.evidence[gate];
    let index = 0;
    for (const declared of entry.files) {
      const from = resolve(manifestDirectory, declared);
      await access(from);
      const info = await stat(from);
      const safeName = `${String(index + 1).padStart(2, "0")}-${basename(from)}`;
      const to = resolve(outputRoot, "evidence", gate, safeName);
      await mkdir(dirname(to), { recursive: true });
      if (info.isDirectory()) await cp(from, to, { recursive: true });
      else if (info.isFile()) await copyFile(from, to);
      else throw new Error(`Unsupported C5F evidence path type: ${declared}`);
      copiedEvidence[gate].push(relative(outputRoot, to));
      index += 1;
    }
  }

  const lines = [
    "# CAS Simulator — Final Development / Testing Evidence Package",
    "",
    `- Release: ${manifest.releaseLabel}`,
    `- Git SHA: \`${manifest.releaseSha}\``,
    `- Prepared by: ${manifest.preparedBy}`,
    `- Prepared at: ${manifest.preparedAt}`,
    `- Repository: ${manifest.repository}`,
    "",
    "## Summary",
    "",
    manifest.summary,
    "",
    "## Final evidence gates",
    "",
  ];

  for (const gate of requiredGates) {
    const entry = manifest.evidence[gate];
    lines.push(`### ${gate} — ${entry.status}`, "");
    if (entry.notes.trim()) lines.push(entry.notes.trim(), "");
    for (const path of copiedEvidence[gate]) lines.push(`- Packaged file: \`${path}\``);
    for (const ref of entry.refs) lines.push(`- External reference: ${ref}`);
    lines.push("");
  }

  lines.push(
    "## Repository documentation",
    "",
    ...requiredDocs.map((path) => `- \`repository/${path}\``),
    "",
    "## Integrity",
    "",
    "Verify file hashes against `CHECKSUMS.sha256`. Regenerate the package if any evidence file changes.",
    "",
  );

  await writeFile(resolve(outputRoot, "PACKAGE_INDEX.md"), `${lines.join("\n")}\n`, "utf8");

  const packageFiles = (await collectFiles(outputRoot))
    .filter((path) => basename(path) !== "CHECKSUMS.sha256")
    .sort((a, b) => relative(outputRoot, a).localeCompare(relative(outputRoot, b)));
  const checksumLines = [];
  for (const path of packageFiles) checksumLines.push(`${await sha256(path)}  ${relative(outputRoot, path)}`);
  await writeFile(resolve(outputRoot, "CHECKSUMS.sha256"), `${checksumLines.join("\n")}\n`, "utf8");

  console.log(JSON.stringify({
    ok: true,
    gate: "C5F_CAS_EVIDENCE_PACKAGE",
    releaseSha: manifest.releaseSha,
    output: outputRoot,
    packagedFiles: packageFiles.length + 1,
  }, null, 2));
}

const manifestFile = process.env.C5F_MANIFEST_FILE;
if (manifestFile) await buildPackage(manifestFile);
else await validateContract();
