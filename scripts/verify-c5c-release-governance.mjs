import { readFileSync } from "node:fs";

function read(path) {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
}

const deploy = read(".github/workflows/deploy.yml");
const rollback = read(".github/workflows/rollback.yml");
const runbook = read("docs/operations/C5C_DEPLOY_ROLLBACK.md");

const checks = [
  ["deploy remains manual-only", deploy.includes("workflow_dispatch:") && !deploy.includes("pull_request:") && !deploy.includes("push:")],
  ["deploy requires exact SHA confirmation", deploy.includes("confirm_sha:") && deploy.includes('if [ "$CONFIRM_SHA" != "$GITHUB_SHA" ]')],
  ["deploy records immutable Git identity", deploy.includes("git_sha=$GITHUB_SHA") && deploy.includes("git_ref=$GITHUB_REF")],
  ["deploy records Cloudflare state before mutation", deploy.includes("deployments-before.json") && deploy.includes("versions-before.json")],
  ["deploy tags Cloudflare history with Git SHA", deploy.includes('wrangler deploy --message "C5 deploy git:${GITHUB_SHA}')],
  ["deploy records Cloudflare state after mutation", deploy.includes("deployments-after.json") && deploy.includes("versions-after.json")],
  ["deploy retains smoke evidence", deploy.includes("multiplayer-smoke.txt") && deploy.includes("health-after.json")],
  ["deploy verifies C4D smoke cleanup zero counts", deploy.includes("c4d-cleanup-verification.json") && deploy.includes("users_remaining") && deploy.includes("sessions_remaining") && deploy.includes("rated_matches_remaining") && deploy.includes("C4D_SMOKE_CLEANUP_ZERO_COUNTS=PASS")],
  ["deploy uploads evidence artifact", deploy.includes("actions/upload-artifact@v4") && deploy.includes("c5-production-deploy-")],
  ["rollback remains manual-only", rollback.includes("workflow_dispatch:") && !rollback.includes("pull_request:") && !rollback.includes("push:")],
  ["rollback requires exact SHA confirmation", rollback.includes("confirm_sha:") && rollback.includes('if [ "$CONFIRM_SHA" != "$GITHUB_SHA" ]')],
  ["rollback requires explicit version ID", rollback.includes("target_version_id:") && rollback.includes('TARGET_VERSION_ID: ${{ inputs.target_version_id }}')],
  ["rollback requires literal confirmation", rollback.includes("confirmation:") && rollback.includes('if [ "$CONFIRMATION" != "ROLLBACK" ]')],
  ["rollback uses explicit non-interactive Wrangler target", rollback.includes('wrangler rollback "$TARGET_VERSION_ID"') && rollback.includes('--message "C5 rollback target:${TARGET_VERSION_ID}')],
  ["deploy and rollback share mutation lock", deploy.includes("group: production-deploy") && rollback.includes("group: production-deploy")],
  ["rollback records before and after Cloudflare state", rollback.includes("deployments-before.json") && rollback.includes("deployments-after.json") && rollback.includes("versions-before.json") && rollback.includes("versions-after.json")],
  ["rollback verifies production after mutation", rollback.includes("health-after.json") && rollback.includes("verify-production-multiplayer.mjs")],
  ["rollback verifies C4D smoke cleanup zero counts", rollback.includes("c4d-cleanup-verification.json") && rollback.includes("users_remaining") && rollback.includes("sessions_remaining") && rollback.includes("rated_matches_remaining") && rollback.includes("C4D_SMOKE_CLEANUP_ZERO_COUNTS=PASS")],
  ["rollback uploads evidence artifact", rollback.includes("actions/upload-artifact@v4") && rollback.includes("c5-production-rollback-")],
  ["runbook distinguishes implementation from execution evidence", runbook.includes("C5C execution evidence is closed only after")],
  ["runbook preserves C4D final prerequisite", runbook.includes("C4D_RATED_PRODUCTION_GATE=enabled") && runbook.includes("C4D production D1")],
  ["runbook documents verified cleanup evidence", runbook.includes("c4d-cleanup-verification.json") && runbook.includes("zero-count")],
  ["runbook documents Durable Object rollback boundary", runbook.includes("Durable Object / binding constraint")],
];

const failures = checks.filter(([, passed]) => !passed);
for (const [label, passed] of checks) {
  console.log(`${passed ? "PASS" : "FAIL"} ${label}`);
}

if (failures.length > 0) {
  console.error(`C5C verification failed: ${failures.length} check(s).`);
  process.exit(1);
}

console.log(`C5C verification passed: ${checks.length} checks.`);
