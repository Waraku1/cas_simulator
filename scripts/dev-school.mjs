import { spawn } from "node:child_process";
import net from "node:net";

const children = new Set();
let shuttingDown = false;

function portIsListening(port) {
  return new Promise((resolve) => {
    const socket = net.createConnection({ host: "127.0.0.1", port });
    const finish = (listening) => {
      socket.removeAllListeners();
      socket.destroy();
      resolve(listening);
    };

    socket.setTimeout(500);
    socket.once("connect", () => finish(true));
    socket.once("timeout", () => finish(false));
    socket.once("error", (error) => {
      if (error?.code === "ECONNREFUSED") {
        finish(false);
        return;
      }
      finish(false);
    });
  });
}

async function assertSchoolPortsAvailable() {
  const conflicts = [];
  if (await portIsListening(5173)) conflicts.push("5173 (Vite browser origin)");
  if (await portIsListening(8787)) conflicts.push("8787 (school local C3/C4 relay)");
  if (await portIsListening(8788)) conflicts.push("8788 (school local account API)");

  if (conflicts.length === 0) return;

  console.error("[dev:school] Cannot start because required localhost port(s) are already in use:");
  for (const conflict of conflicts) console.error(`  - ${conflict}`);
  console.error("");
  console.error("Stop the older local development process first (normally the terminal running pnpm dev or pnpm dev:school), then retry.");
  console.error("To identify a listener on macOS, you can run:");
  console.error("  lsof -nP -iTCP:5173 -sTCP:LISTEN");
  console.error("  lsof -nP -iTCP:8787 -sTCP:LISTEN");
  console.error("  lsof -nP -iTCP:8788 -sTCP:LISTEN");
  process.exit(1);
}

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

await assertSchoolPortsAvailable();

start(process.execPath, ["scripts/school-local-backend.mjs"], "school local multiplayer backend");
start(process.execPath, ["scripts/school-account-backend.mjs"], "school local account backend");
start("pnpm", ["exec", "vite", "dev", "--config", "vite.school.config.ts"], "Vite school client");

process.on("SIGINT", () => shutdown(0));
process.on("SIGTERM", () => shutdown(0));
