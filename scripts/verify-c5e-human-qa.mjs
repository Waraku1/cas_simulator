import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

const root = new URL("..", import.meta.url).pathname;
const templatePath = resolve(root, "docs/evidence/templates/c5e-human-qa.template.json");
const runbookPath = resolve(root, "docs/operations/C5E_HUMAN_QA_VISUAL_SIGNOFF.md");
const requiredIds = Array.from({ length: 16 }, (_, index) => `C5E-${String(index + 1).padStart(2, "0")}`);
const allowedStatuses = new Set(["PENDING", "PASS", "FAIL", "BLOCKED"]);
const requiredSurfaceKeys = [
  "auth",
  "home",
  "matchmaking",
  "aircraftAssignment",
  "countdown",
  "activeHud",
  "result",
  "leaderboard",
];

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function nonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function validateCommon(record) {
  assert(record && typeof record === "object", "C5E evidence must be a JSON object");
  assert(record.gate === "C5E_HUMAN_QA_VISUAL_SIGNOFF", "Unexpected C5E gate identifier");
  assert(record.environment && typeof record.environment === "object", "Missing C5E environment metadata");
  assert(Array.isArray(record.cases), "C5E cases must be an array");
  assert(record.cases.length === requiredIds.length, `C5E evidence must contain exactly ${requiredIds.length} cases`);

  const seen = new Set();
  for (const item of record.cases) {
    assert(item && typeof item === "object", "C5E case must be an object");
    assert(requiredIds.includes(item.id), `Unexpected C5E case id: ${item.id}`);
    assert(!seen.has(item.id), `Duplicate C5E case id: ${item.id}`);
    seen.add(item.id);
    assert(allowedStatuses.has(item.status), `Invalid status for ${item.id}: ${item.status}`);
    assert(typeof item.notes === "string", `${item.id} notes must be a string`);
    assert(Array.isArray(item.evidenceRefs), `${item.id} evidenceRefs must be an array`);
  }

  for (const id of requiredIds) assert(seen.has(id), `Missing required C5E case: ${id}`);
  assert(record.surfaceCaptures && typeof record.surfaceCaptures === "object", "Missing C5E surfaceCaptures object");
  for (const key of requiredSurfaceKeys) {
    assert(typeof record.surfaceCaptures[key] === "string", `surfaceCaptures.${key} must be a string`);
  }
  assert(typeof record.multiplayerCapture === "string", "multiplayerCapture must be a string");
  assert(typeof record.overallNotes === "string", "overallNotes must be a string");
}

async function validateContract() {
  const template = JSON.parse(await readFile(templatePath, "utf8"));
  validateCommon(template);
  assert(template.releaseSha === "", "C5E template releaseSha must remain blank");
  assert(template.cases.every((item) => item.status === "PENDING"), "C5E template cases must remain PENDING");

  const runbook = await readFile(runbookPath, "utf8");
  for (const id of requiredIds) assert(runbook.includes(id), `C5E runbook missing ${id}`);
  for (const surface of ["Auth", "Home", "Matchmaking", "Aircraft assignment", "Countdown", "Active HUD", "Result", "Leaderboard"]) {
    assert(runbook.includes(surface), `C5E runbook missing surface: ${surface}`);
  }
  assert(runbook.includes("C5E_EVIDENCE_FILE"), "C5E runbook must document evidence validation command");
  assert(runbook.includes("200% zoom"), "C5E runbook must retain zoom observation");
  assert(runbook.includes("1280×720"), "C5E runbook must retain compact desktop observation");

  console.log(JSON.stringify({ ok: true, gate: "C5E_HUMAN_QA_CONTRACT", cases: requiredIds.length }, null, 2));
}

async function validateEvidence(path) {
  const record = JSON.parse(await readFile(resolve(process.cwd(), path), "utf8"));
  validateCommon(record);

  assert(/^[0-9a-f]{40}$/i.test(record.releaseSha ?? ""), "C5E evidence requires a full 40-character Git release SHA");
  assert(nonEmptyString(record.tester), "C5E evidence requires tester identity");
  assert(nonEmptyString(record.capturedAt) && Number.isFinite(Date.parse(record.capturedAt)), "C5E evidence requires a valid capturedAt timestamp");

  for (const key of ["kind", "url", "browser", "browserVersion", "operatingSystem", "device"]) {
    assert(nonEmptyString(record.environment[key]), `C5E environment.${key} is required`);
  }

  const incomplete = record.cases.filter((item) => item.status !== "PASS");
  if (incomplete.length > 0) {
    throw new Error(`C5E is not closed; non-PASS cases: ${incomplete.map((item) => `${item.id}=${item.status}`).join(", ")}`);
  }
  for (const item of record.cases) assert(nonEmptyString(item.notes), `${item.id} requires observation notes`);

  for (const key of requiredSurfaceKeys) {
    assert(nonEmptyString(record.surfaceCaptures[key]), `C5E requires representative capture reference for ${key}`);
  }
  assert(nonEmptyString(record.multiplayerCapture), "C5E requires a paired multiplayer capture/recording reference");
  assert(nonEmptyString(record.overallNotes), "C5E evidence requires overallNotes");

  console.log(JSON.stringify({
    ok: true,
    gate: "C5E_HUMAN_QA_VISUAL_SIGNOFF",
    releaseSha: record.releaseSha,
    casesPassed: record.cases.length,
    visualSignoff: record.cases.find((item) => item.id === "C5E-16")?.status,
  }, null, 2));
}

const evidencePath = process.env.C5E_EVIDENCE_FILE;
if (evidencePath) await validateEvidence(evidencePath);
else await validateContract();
