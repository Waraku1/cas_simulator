import { spawn } from "node:child_process";

const children = new Set();
let shuttingDown = false;

function start(command, args, label) {
  const child = spawn(command, args, {
    cwd: process.cwd(),
    env: process.env,
    stdio: "inherit",
  });
  children.add(child);

  child.on("error", (error) => {
    console.error(`[dev:school] ${label} failed to start: ${error.message}`);
    shutdown(1);
  });

  child.on("exit", (code, signal) => {
    children.delete(child);
    if (shuttingDown) return;
    if (code !== 0) {
      console.error(`[dev:school] ${label} exited with ${signal ?? `code ${code}`}.`);
    }
    shutdown(code ?? 1);
  });

  return child;
}

function shutdown(exitCode = 0) {
  if (shuttingDown) return;
  shuttingDown = true;
  for (const child of children) {
    if (!child.killed) child.kill("SIGTERM");
  }
  setTimeout(() => process.exit(exitCode), 500).unref();
}

start(process.execPath, ["scripts/school-local-backend.mjs"], "school local backend");
start("pnpm", ["exec", "vite", "dev", "--config", "vite.school.config.ts"], "Vite school client");

process.on("SIGINT", () => shutdown(0));
process.on("SIGTERM", () => shutdown(0));
