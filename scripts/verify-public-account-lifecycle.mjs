import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = new URL("..", import.meta.url).pathname;
const read = (path) => readFileSync(resolve(root, path), "utf8");

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const auth = read("src/shared/auth.ts");
const app = read("src/worker/app.ts");
const service = read("src/worker/auth/service.ts");
const repository = read("src/worker/auth/repository.ts");
const migration = read("migrations/0003_account_lifecycle.sql");
const client = read("src/client/product/ProductLive.tsx");
const accountHook = read("src/client/product/useAccount.ts");
const notice = read("src/client/product/AccountDataNotice.tsx");
const privacy = read("PRIVACY.md");
const schoolStore = read("scripts/school-account-store.mjs");
const schoolBackend = read("scripts/school-account-backend.mjs");
const schoolVerify = read("scripts/verify-school-accounts.mjs");
const provisionWorkflow = read(".github/workflows/c4d-provision-d1.yml");
const c5fLineage = read("scripts/verify-c5f-evidence-lineage.mjs");

const checks = [
  ["shared delete endpoint exists", auth.includes('deleteAccount: "/api/account/delete"')],
  ["worker routes delete as account mutation", app.includes("ACCOUNT_API.deleteAccount")],
  ["deletion requires authenticated account", service.includes('Sign in before deleting the account.')],
  ["deletion requires exact confirmation", service.includes('body.confirmation !== "DELETE"')],
  ["deletion re-verifies password", service.includes("verifyPasswordHash(body.password")],
  ["deletion clears session cookie", service.includes('"set-cookie": clearSessionCookie(secureCookie)')],
  ["expired sessions are cleaned on account activity", service.includes("deleteExpiredSessions(Date.now())")],
  ["schema records deletion timestamp", migration.includes("deleted_at_ms")],
  ["repository revokes all user sessions", repository.includes('DELETE FROM sessions WHERE user_id = ?')],
  ["repository removes credential material", repository.includes("password_hash = ''") && repository.includes("password_salt = ''")],
  ["repository anonymizes public identity", repository.includes("display_name = 'Deleted Pilot'") && repository.includes("anonymizedLoginId")],
  ["deleted account cannot login", repository.includes("login_id = ? AND deleted_at_ms IS NULL")],
  ["deleted account cannot authenticate session", repository.includes("u.deleted_at_ms IS NULL")],
  ["deleted account is excluded from leaderboard", repository.includes("WHERE deleted_at_ms IS NULL")],
  ["client exposes pre-registration data notice", client.includes("<AccountDataDisclosure />")],
  ["client exposes authenticated account privacy UI", client.includes("ACCOUNT & PRIVACY") && client.includes("DELETE ACCOUNT")],
  ["client deletion requires exact DELETE", client.includes('deleteConfirmation !== "DELETE"')],
  ["account hook invokes deletion endpoint", accountHook.includes("ACCOUNT_API.deleteAccount")],
  ["data notice explains retained ledger", notice.includes("rated-match ledger") && notice.includes("internal user ID")],
  ["repository privacy notice exists", privacy.includes("# Account Data Handling Notice") && privacy.includes("## Account deletion")],
  ["school parity implements deletion", schoolStore.includes("function deleteAccount") && schoolBackend.includes('"/api/account/delete"')],
  ["school smoke verifies deletion lifecycle", schoolVerify.includes("deletionRevokedSessions") && schoolVerify.includes("deletionRemovedLeaderboardEntry")],
  ["production provisioning verifies deleted_at_ms", provisionWorkflow.includes("users.deleted_at_ms") && provisionWorkflow.includes("PRAGMA table_info(users)")],
  ["production provisioning emits account lifecycle schema PASS", provisionWorkflow.includes("C4D_ACCOUNT_LIFECYCLE_SCHEMA=PASS") && provisionWorkflow.includes('accountLifecycleSchema: "PASS"')],
  ["C5F requires account lifecycle provisioning evidence", c5fLineage.includes('provision.accountLifecycleSchema === "PASS"')],
];

for (const [label, passed] of checks) {
  assert(passed, `Public account lifecycle contract failed: ${label}`);
  console.log(`PASS ${label}`);
}

console.log(JSON.stringify({
  ok: true,
  gate: "PUBLIC_ACCOUNT_LIFECYCLE",
  checks: checks.length,
}, null, 2));
