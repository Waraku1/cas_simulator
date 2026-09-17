import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import os from "node:os";
import { resolve } from "node:path";

const pnpmCommand = process.platform === "win32" ? "pnpm.cmd" : "pnpm";
const evidenceDir = resolve(process.env.C5D_EVIDENCE_DIR ?? ".c5-evidence/school-regression");
const startedAt = new Date();
const gates = [
  { id: "c3_multiplayer", script: "verify:school" },
  { id: "c4b_matchmaking", script: "verify:school:c4b" },
  { id: "c4c_competition", script: "verify:school:c4c" },
  { id: "c4d_accounts", script: "verify:school:c4d" },
  { id: "c4d_ranked_product", script: "verify:school:c4d:ranked" },
];

function commandText(command, args) {
  return [command, ...args].join(" ");
}

function readCommand(command, args) {
  const result = spawnSync(command, args, {
    cwd: process.cwd(),
    encoding: "utf8",
    env: process.env,
    maxBuffer: 4 * 1024 * 1024,
  });
  return result.status === 0 ? result.stdout.trim() : null;
}

const gitSha = readCommand("git", ["rev-parse", "HEAD"]);
const pnpmVersion = readCommand(pnpmCommand, ["--version"]);

const results = [];
let failed = false;

for (const gate of gates) {
  const gateStartedAt = Date.now();
  const args = ["run", gate.script];
  console.log(`\n[C5D] Running ${commandText(pnpmCommand, args)}`);
  const result = spawnSync(pnpmCommand, args, {
    cwd: process.cwd(),
    encoding: "utf8",
    env: process.env,
    maxBuffer: 8 * 1024 * 1024,
  });
  const stdout = result.stdout ?? "";
  const stderr = result.stderr ?? "";
  if (stdout) process.stdout.write(stdout);
  if (stderr) process.stderr.write(stderr);

  const passed = result.status === 0;
  failed ||= !passed;
  results.push({
    id: gate.id,
    script: gate.script,
    passed,
    exitCode: result.status,
    signal: result.signal ?? null,
    durationMs: Date.now() - gateStartedAt,
    stdout: stdout.trim(),
    stderr: stderr.trim(),
  });
}

const finishedAt = new Date();
const report = {
  gate: "C5D_SCHOOL_RELEASE_REGRESSION",
  ok: !failed,
  startedAt: startedAt.toISOString(),
  finishedAt: finishedAt.toISOString(),
  durationMs: finishedAt.getTime() - startedAt.getTime(),
  environment: {
    gitSha,
    nodeVersion: process.version,
    pnpmVersion,
    platform: process.platform,
    arch: process.arch,
    osRelease: os.release(),
    osVersion: typeof os.version === "function" ? os.version() : null,
    hostnameRecorded: false,
    schoolOrigin: "http://127.0.0.1:5173",
  },
  gates: results,
};

mkdirSync(evidenceDir, { recursive: true });
const timestamp = finishedAt.toISOString().replace(/[:.]/g, "-");
const evidencePath = resolve(evidenceDir, `c5d-school-regression-${timestamp}.json`);
writeFileSync(evidencePath, `${JSON.stringify(report, null, 2)}\n`, "utf8");

console.log(`\n[C5D] Evidence written to ${evidencePath}`);
console.log(`[C5D] ${report.ok ? "PASS" : "FAIL"}: ${results.filter((entry) => entry.passed).length}/${results.length} release regression gates passed.`);

if (failed) process.exit(1);
