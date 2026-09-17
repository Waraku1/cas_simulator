import { execFileSync } from "node:child_process";
import { resolve } from "node:path";

const root = new URL("..", import.meta.url).pathname;
const packageVerifier = resolve(root, "scripts/verify-c5f-evidence-package.mjs");
const lineageVerifier = resolve(root, "scripts/verify-c5f-evidence-lineage.mjs");
const versionLineageVerifier = resolve(root, "scripts/verify-c5f-version-lineage.mjs");
const targetBindingVerifier = resolve(root, "scripts/verify-c5c-production-target.mjs");
const env = { ...process.env };

if (process.env.C5F_MANIFEST_FILE) {
  execFileSync(process.execPath, [lineageVerifier], { cwd: root, env, stdio: "inherit" });
  execFileSync(process.execPath, [versionLineageVerifier], { cwd: root, env, stdio: "inherit" });
  execFileSync(process.execPath, [targetBindingVerifier], { cwd: root, env, stdio: "inherit" });
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
  execFileSync(process.execPath, [versionLineageVerifier], {
    cwd: root,
    env: {
      ...env,
      C5F_VERSION_LINEAGE_SELF_TEST: process.env.C5F_SELF_TEST === "1" ? "1" : "0",
    },
    stdio: "inherit",
  });
  execFileSync(process.execPath, [targetBindingVerifier], {
    cwd: root,
    env: {
      ...env,
      C5C_TARGET_SELF_TEST: process.env.C5F_SELF_TEST === "1" ? "1" : "0",
    },
    stdio: "inherit",
  });
}
