# Render School Gateway

## Purpose

Provide a school-network-reachable HTTPS/WSS origin for multiple managed Macs while retaining the existing Cloudflare Worker + Durable Objects + D1 deployment as the authoritative product backend.

The Render service is a gateway, not a second game backend. It must not create a separate account store, rating authority, matchmaking authority, or ranked-match state.

## Topology

```text
Managed Mac A --- HTTPS/WSS ---+
                              |
Managed Mac B --- HTTPS/WSS ---+--> Render Web Service
                                      |
                                      +-- static Vite client
                                      |
                                      +-- fixed /api/* reverse proxy
                                             |
                                             v
                                  Cloudflare production Worker
                                    + D1
                                    + Matchmaker Durable Object
                                    + RankedMatch Durable Object
```

## Security boundary

The gateway:

- binds only its public HTTP server to `0.0.0.0:$PORT` as required by Render;
- accepts proxy traffic only for `/api/*`;
- uses one fixed HTTPS upstream from `CAS_UPSTREAM_ORIGIN`;
- validates any browser `Origin` against the school gateway public origin before proxying;
- rewrites the accepted browser `Origin` to the fixed upstream origin so the existing Worker same-origin boundary remains effective;
- forwards cookies and `Set-Cookie` without logging them;
- does not log request URLs because ranked join tokens appear in WebSocket query strings;
- supports HTTP and WebSocket proxying through the same public Render port;
- serves the built Vite/Cesium client for non-API routes;
- uses `Referrer-Policy: strict-origin-when-cross-origin` so Cesium ion Allowed URL checks receive the Render origin without exposing path/query data cross-origin.

Do not turn this into a general-purpose proxy and do not add arbitrary target URLs supplied by the client.

## Render service

The repository Blueprint is `render.yaml`.

Build:

```text
corepack enable && pnpm install --frozen-lockfile && pnpm build:render
```

Start:

```text
pnpm start:render
```

Health check:

```text
/gateway-health
```

Required environment:

- `CAS_UPSTREAM_ORIGIN`: fixed production Worker HTTPS origin. The Blueprint contains the reviewed production value.
- `CAS_PUBLIC_ORIGIN`: exact public Render origin. The reviewed Blueprint pins this to `https://cas-simulator-school.onrender.com`.
- `VITE_CESIUM_ION_TOKEN`: Render secret/environment value available during build. Use a token scoped to required Cesium assets and permit the Render school origin.

## Deployment

1. In Render, create a Blueprint/Web Service from `Waraku1/cas_simulator`.
2. Use the reviewed branch/commit intended for school deployment.
3. Supply `VITE_CESIUM_ION_TOKEN` without printing it in logs or chat.
4. Deploy.
5. Confirm `https://cas-simulator-school.onrender.com/gateway-health` returns `ok: true`.
6. Open the Render origin from two separate managed Macs.
7. Verify Register/Login -> Home -> Matchmaking -> Assignment -> Countdown -> Active -> Result -> Rating/Leaderboard.
8. Verify peer rendering and reconnect behavior across the two physical Macs.

## Cesium

The browser loads Cesium data directly. The token used by the Render build must allow the exact Render school origin (or approved custom domain). Prefer a separate school/Render token from the production Worker-origin token so origin scope remains explicit.

## Verification

Repository contract:

```bash
pnpm verify:render:school
pnpm build:render
```

After deployment, perform two-Mac E2E on the school LAN. This is the acceptance test that matters for the new capability.

## Boundary with localhost school mode

`pnpm dev:school` remains the fully local fallback for one managed Mac and two browser contexts. The Render gateway is the multi-device school path. Do not expose ports 5173/8787/8788/8789 directly to the managed LAN and do not bypass school filtering, TLS controls, VPN policy, or DNS policy.
