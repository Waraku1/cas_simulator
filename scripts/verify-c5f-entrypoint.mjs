import { execFileSync } from "node:child_process";
import { resolve } from "node:path";

const root = new URL("..", import.meta.url).pathname;
const packageVerifier = resolve(root, "scripts/verify-c5f-evidence-package.mjs");
const lineageVerifier = resolve(root, "scripts/verify-c5f-evidence-lineage.mjs");
const versionTransitionVerifier = resolve(root, "scripts/verify-c5c-version-transition.mjs");
const env = { ...process.env };

if (process.env.C5F_MANIFEST_FILE) {
  execFileSync(process.execPath, [lineageVerifier], { cwd: root, env, stdio: "inherit" });
  execFileSync(process.execPath, [versionTransitionVerifier], { cwd: root, env, stdio: "inherit" });
  execFileSync(process.execPath, [packageVerifier], { cwd: root, env, stdio: "inherit" });
} else {
  execFileSync(process.execPath, [packageVerifier], { cwd: root, env, stdio: "inherit" });
  execFileSync(process.execPath, [lineageVerifier], {
    cwd: root,
    env: {
      ...env,
      C5F_LINEAGE_SELF_TEST: process.env.C5F_SELF_TEST === "1" ? "1" : "0",
    },
    stdio: "inherit",
  });
  execFileSync(process.execPath, [versionTransitionVerifier], {
    cwd: root,
    env: {
      ...env,
      C5C_VERSION_TRANSITION_SELF_TEST: process.env.C5F_SELF_TEST === "1" ? "1" : "0",
    },
    stdio: "inherit",
  });
}
