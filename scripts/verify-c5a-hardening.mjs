import { readFileSync } from "node:fs";

function read(path) {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
}

const app = read("src/client/App.tsx");
const main = read("src/client/main.tsx");
const accessibility = read("src/client/product/AccessibilityHardening.tsx");
const accessibilityCss = read("src/client/a11y.css");
const workerApp = read("src/worker/app.ts");
const workerSecurity = read("src/worker/security.ts");
const authCrypto = read("src/worker/auth/crypto.ts");
const authService = read("src/worker/auth/service.ts");
const schoolStore = read("scripts/school-account-store.mjs");
const staticHeaders = read("public/_headers");
const audit = read("docs/operations/C5A_SECURITY_ACCESSIBILITY.md");

const checks = [
  ["App mounts C5A accessibility hardening", app.includes("AccessibilityHardening")],
  ["client imports C5A accessibility stylesheet", main.includes('import "./a11y.css"')],
  ["auth tabs expose selected state", accessibility.includes('aria-selected')],
  ["Heart Points expose progressbar values", accessibility.includes('aria-valuenow') && accessibility.includes('progressbar')],
  ["persistent polite live region exists", accessibility.includes('role="status"') && accessibility.includes('aria-live="polite"')],
  ["persistent assertive live region exists", accessibility.includes('role="alert"') && accessibility.includes('aria-live="assertive"')],
  ["focus-visible styling exists", accessibilityCss.includes(":focus-visible")],
  ["reduced-motion styling exists", accessibilityCss.includes("prefers-reduced-motion")],
  ["Worker enforces browser origin boundary", workerApp.includes("isSameOriginBrowserRequest") && workerApp.includes("crossOriginRequestRejected")],
  ["Worker applies response hardening", workerApp.includes("withSecurityHeaders")],
  ["Worker sets nosniff", workerSecurity.includes('"x-content-type-options": "nosniff"')],
  ["Worker preserves WebSocket upgrades", workerSecurity.includes("response.status === 101")],
  ["production PBKDF2 work factor stays within Workers runtime ceiling", authCrypto.includes("PASSWORD_KDF_ITERATIONS = 100_000") && authCrypto.includes("iterations > PASSWORD_KDF_ITERATIONS")],
  ["school-local password work factor matches production", schoolStore.includes("PASSWORD_ITERATIONS = 100_000")],
  ["credential KDF failures are contained as application errors", authService.includes('"Credential derivation failed."') && authService.includes('"Credential verification failed."')],
  ["static headers disable framing", staticHeaders.includes("X-Frame-Options: DENY")],
  ["static headers define Permissions-Policy", staticHeaders.includes("Permissions-Policy:")],
  ["audit documents external rate limiting", audit.includes("shared edge/infrastructure mechanism")],
  ["audit preserves frozen product semantics", audit.includes("No C1-C4 product semantic changes")],
];

const failures = checks.filter(([, passed]) => !passed);
for (const [label, passed] of checks) {
  console.log(`${passed ? "PASS" : "FAIL"} ${label}`);
}

if (failures.length > 0) {
  console.error(`C5A verification failed: ${failures.length} check(s).`);
  process.exit(1);
}

console.log(`C5A verification passed: ${checks.length} checks.`);
