import { execFileSync } from "node:child_process";
import { join } from "node:path";

const root = new URL("..", import.meta.url).pathname;

execFileSync(process.execPath, [join(root, "scripts/verify-scaffold.mjs")], {
  stdio: "inherit",
  env: process.env,
});

if (process.env.C4D_RATED_PRODUCTION_GATE === "enabled") {
  execFileSync(process.execPath, [join(root, "scripts/verify-c4d-production-binding.mjs")], {
    stdio: "inherit",
    env: {
      ...process.env,
      C4D_BINDING_REQUIRED: "1",
    },
  });
}
