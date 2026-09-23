import { createReadStream, existsSync, statSync } from "node:fs";
import http from "node:http";
import https from "node:https";
import tls from "node:tls";
import { extname, normalize, resolve, sep } from "node:path";

const HOST = "0.0.0.0";
const PORT = Number(process.env.PORT ?? 10000);
const STATIC_ROOT = resolve(process.env.CAS_STATIC_DIR ?? "dist");
const upstream = new URL(
  process.env.CAS_UPSTREAM_ORIGIN ??
    "https://cas-flight-simulator.heleshiheiheleshihei.workers.dev",
);
const configuredPublicOrigin = process.env.CAS_PUBLIC_ORIGIN
  ? new URL(process.env.CAS_PUBLIC_ORIGIN).origin
  : null;

if (!Number.isInteger(PORT) || PORT <= 0 || PORT > 65535) {
  throw new Error("PORT must be a valid TCP port");
}
if (upstream.protocol !== "https:") {
  throw new Error("CAS_UPSTREAM_ORIGIN must use HTTPS");
}
if (configuredPublicOrigin && new URL(configuredPublicOrigin).protocol !== "https:") {
  throw new Error("CAS_PUBLIC_ORIGIN must use HTTPS when configured");
}

const HOP_BY_HOP = new Set([
  "connection",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "proxy-connection",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
]);

const MIME = new Map([
  [".css", "text/css; charset=utf-8"],
  [".glb", "model/gltf-binary"],
  [".html", "text/html; charset=utf-8"],
  [".ico", "image/x-icon"],
  [".jpeg", "image/jpeg"],
  [".jpg", "image/jpeg"],
  [".js", "text/javascript; charset=utf-8"],
  [".json", "application/json; charset=utf-8"],
  [".ktx2", "image/ktx2"],
  [".png", "image/png"],
  [".svg", "image/svg+xml"],
  [".wasm", "application/wasm"],
  [".webp", "image/webp"],
  [".woff", "font/woff"],
  [".woff2", "font/woff2"],
  [".xml", "application/xml; charset=utf-8"],
]);

function firstHeader(value) {
  if (Array.isArray(value)) return value[0] ?? "";
  return String(value ?? "").split(",")[0].trim();
}

function requestPublicOrigin(request) {
  if (configuredPublicOrigin) return configuredPublicOrigin;

  const forwardedProto = firstHeader(request.headers["x-forwarded-proto"]);
  const protocol = forwardedProto || (request.socket.encrypted ? "https" : "http");
  const forwardedHost = firstHeader(request.headers["x-forwarded-host"]);
  const host = forwardedHost || request.headers.host;
  if (!host) return null;

  try {
    return new URL(`${protocol}://${host}`).origin;
  } catch {
    return null;
  }
}

function browserOriginAllowed(request) {
  const origin = firstHeader(request.headers.origin);
  if (!origin) return true;
  const expected = requestPublicOrigin(request);
  if (!expected) return false;

  try {
    return new URL(origin).origin === expected;
  } catch {
    return false;
  }
}

function securityHeaders(headers = {}) {
  return {
    "x-content-type-options": "nosniff",
    "referrer-policy": "no-referrer",
    "x-frame-options": "DENY",
    "permissions-policy": "camera=(), microphone=(), geolocation=()",
    ...headers,
  };
}

function writeJson(response, status, body) {
  const payload = JSON.stringify(body);
  response.writeHead(status, securityHeaders({
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(payload),
    "cache-control": "no-store",
  }));
  response.end(payload);
}

function apiPath(requestUrl) {
  try {
    const url = new URL(requestUrl ?? "/", "http://gateway.invalid");
    return url.pathname.startsWith("/api/") ? `${url.pathname}${url.search}` : null;
  } catch {
    return null;
  }
}

function proxyRequestHeaders(request) {
  const headers = {};
  for (const [name, value] of Object.entries(request.headers)) {
    const lower = name.toLowerCase();
    if (HOP_BY_HOP.has(lower) || lower === "host" || lower === "origin") continue;
    if (value !== undefined) headers[lower] = value;
  }

  headers.host = upstream.host;
  if (request.headers.origin) headers.origin = upstream.origin;
  return headers;
}

function proxyHttp(request, response, path) {
  if (!browserOriginAllowed(request)) {
    writeJson(response, 403, {
      ok: false,
      code: "GATEWAY_ORIGIN_REJECTED",
      message: "The request origin is not allowed by the school gateway.",
    });
    return;
  }

  const proxy = https.request({
    protocol: upstream.protocol,
    hostname: upstream.hostname,
    port: upstream.port || 443,
    method: request.method,
    path,
    headers: proxyRequestHeaders(request),
    timeout: 30_000,
  }, (upstreamResponse) => {
    const headers = {};
    for (const [name, value] of Object.entries(upstreamResponse.headers)) {
      if (HOP_BY_HOP.has(name.toLowerCase()) || value === undefined) continue;
      headers[name] = value;
    }
    response.writeHead(upstreamResponse.statusCode ?? 502, headers);
    upstreamResponse.pipe(response);
  });

  proxy.on("timeout", () => proxy.destroy(new Error("upstream timeout")));
  proxy.on("error", () => {
    if (!response.headersSent) {
      writeJson(response, 502, {
        ok: false,
        code: "GATEWAY_UPSTREAM_UNAVAILABLE",
        message: "The CAS production service is temporarily unavailable.",
      });
    } else {
      response.destroy();
    }
  });

  request.pipe(proxy);
}

function safeStaticPath(pathname) {
  let decoded;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    return null;
  }

  const relative = normalize(decoded).replace(/^([/\\])+/, "");
  const candidate = resolve(STATIC_ROOT, relative || "index.html");
  if (candidate !== STATIC_ROOT && !candidate.startsWith(`${STATIC_ROOT}${sep}`)) return null;
  return candidate;
}

function sendStatic(request, response) {
  if (request.method !== "GET" && request.method !== "HEAD") {
    response.writeHead(405, securityHeaders({ allow: "GET, HEAD" }));
    response.end();
    return;
  }

  let pathname = "/";
  try {
    pathname = new URL(request.url ?? "/", "http://gateway.invalid").pathname;
  } catch {
    response.writeHead(400, securityHeaders());
    response.end();
    return;
  }

  let filePath = safeStaticPath(pathname);
  if (!filePath) {
    response.writeHead(400, securityHeaders());
    response.end();
    return;
  }

  if (!existsSync(filePath) || !statSync(filePath).isFile()) {
    filePath = resolve(STATIC_ROOT, "index.html");
  }
  if (!existsSync(filePath) || !statSync(filePath).isFile()) {
    writeJson(response, 503, {
      ok: false,
      code: "STATIC_BUILD_MISSING",
      message: "The school gateway frontend build is unavailable.",
    });
    return;
  }

  const extension = extname(filePath).toLowerCase();
  const cacheControl = filePath.endsWith("index.html")
    ? "no-store"
    : pathname.startsWith("/assets/")
      ? "public, max-age=31536000, immutable"
      : "public, max-age=86400";

  const headers = securityHeaders({
    "content-type": MIME.get(extension) ?? "application/octet-stream",
    "content-length": statSync(filePath).size,
    "cache-control": cacheControl,
  });
  response.writeHead(200, headers);
  if (request.method === "HEAD") {
    response.end();
    return;
  }
  createReadStream(filePath).pipe(response);
}

function writeSocketError(socket, status, message) {
  if (socket.destroyed) return;
  const body = JSON.stringify({ ok: false, message });
  socket.end(
    `HTTP/1.1 ${status}\r\nContent-Type: application/json; charset=utf-8\r\nContent-Length: ${Buffer.byteLength(body)}\r\nConnection: close\r\n\r\n${body}`,
  );
}

function proxyWebSocket(request, socket, head, path) {
  if (!browserOriginAllowed(request)) {
    writeSocketError(socket, "403 Forbidden", "The request origin is not allowed by the school gateway.");
    return;
  }

  const upstreamSocket = tls.connect({
    host: upstream.hostname,
    port: Number(upstream.port || 443),
    servername: upstream.hostname,
  });

  let established = false;
  upstreamSocket.once("secureConnect", () => {
    established = true;
    const lines = [`${request.method} ${path} HTTP/1.1`, `Host: ${upstream.host}`];

    for (const [name, value] of Object.entries(request.headers)) {
      const lower = name.toLowerCase();
      if (
        lower === "host" ||
        lower === "origin" ||
        lower === "connection" ||
        lower === "upgrade" ||
        value === undefined
      ) {
        continue;
      }
      const values = Array.isArray(value) ? value : [value];
      for (const item of values) lines.push(`${name}: ${item}`);
    }

    lines.push(`Origin: ${upstream.origin}`);
    lines.push("Connection: Upgrade");
    lines.push("Upgrade: websocket");
    upstreamSocket.write(`${lines.join("\r\n")}\r\n\r\n`);
    if (head.length > 0) upstreamSocket.write(head);

    socket.pipe(upstreamSocket);
    upstreamSocket.pipe(socket);
  });

  upstreamSocket.on("error", () => {
    if (!established) writeSocketError(socket, "502 Bad Gateway", "The CAS WebSocket service is unavailable.");
    else socket.destroy();
  });
  socket.on("error", () => upstreamSocket.destroy());
  socket.on("close", () => upstreamSocket.destroy());
}

const server = http.createServer((request, response) => {
  if (request.url === "/gateway-health") {
    writeJson(response, 200, {
      ok: true,
      gate: "RENDER_SCHOOL_GATEWAY",
    });
    return;
  }

  const path = apiPath(request.url);
  if (path) {
    proxyHttp(request, response, path);
    return;
  }

  sendStatic(request, response);
});

server.on("upgrade", (request, socket, head) => {
  const path = apiPath(request.url);
  if (!path) {
    writeSocketError(socket, "404 Not Found", "Only CAS API WebSockets are supported.");
    return;
  }
  proxyWebSocket(request, socket, head, path);
});

server.listen(PORT, HOST, () => {
  console.log(`[render-school-gateway] listening on ${HOST}:${PORT}`);
  console.log(`[render-school-gateway] upstream host: ${upstream.host}`);
  console.log(
    `[render-school-gateway] public origin policy: ${configuredPublicOrigin ?? "derived from Render forwarded host/proto"}`,
  );
});
