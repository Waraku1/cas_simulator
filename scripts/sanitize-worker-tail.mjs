import { readFileSync, writeFileSync } from "node:fs";

const [inputPath, outputPath] = process.argv.slice(2);
if (!inputPath || !outputPath) {
  throw new Error("Usage: node scripts/sanitize-worker-tail.mjs <input> <output>");
}

function safeRequest(event) {
  const request = event?.event?.request;
  if (!request) return null;
  let url = null;
  try {
    const parsed = new URL(request.url);
    url = `${parsed.origin}${parsed.pathname}`;
  } catch {
    url = null;
  }
  return {
    url,
    method: typeof request.method === "string" ? request.method : null,
  };
}

function safeException(exception) {
  if (!exception || typeof exception !== "object") return null;
  return {
    name: typeof exception.name === "string" ? exception.name : null,
    message: typeof exception.message === "string" ? exception.message : null,
    timestamp: typeof exception.timestamp === "number" ? exception.timestamp : null,
    stack: typeof exception.stack === "string" ? exception.stack : null,
  };
}

const lines = readFileSync(inputPath, "utf8").split(/\r?\n/);
const sanitized = [];
for (const line of lines) {
  const trimmed = line.trim();
  if (!trimmed.startsWith("{")) continue;
  try {
    const event = JSON.parse(trimmed);
    const exceptions = Array.isArray(event.exceptions)
      ? event.exceptions.map(safeException).filter(Boolean)
      : [];
    sanitized.push({
      outcome: typeof event.outcome === "string" ? event.outcome : null,
      scriptName: typeof event.scriptName === "string" ? event.scriptName : null,
      eventTimestamp: typeof event.eventTimestamp === "number" ? event.eventTimestamp : null,
      exceptions,
      request: safeRequest(event),
    });
  } catch {
    // Ignore Wrangler status/progress lines that are not JSON tail events.
  }
}

writeFileSync(
  outputPath,
  sanitized.map((entry) => JSON.stringify(entry)).join("\n") + (sanitized.length > 0 ? "\n" : ""),
  "utf8",
);

console.log(`C4D_WORKER_TAIL_SANITIZED events=${sanitized.length}`);
