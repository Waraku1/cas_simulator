# C0 — Foundation Baseline

Status: IMPLEMENTED LOCALLY / DEPLOYMENT PENDING ACCOUNT CONNECTION

## Purpose

Establish the minimum production-shaped foundation for the CAS flight-simulator project without implementing flight or game mechanics.

## Frozen decisions

- Browser application: React + TypeScript + Vite.
- Geospatial renderer: CesiumJS.
- Base world: WGS84 Earth streamed through Cesium ion.
- Primary future gameplay area: 50 km × 50 km Regional Theater.
- Hosting/backend target: Cloudflare Workers + Static Assets.
- Future multiplayer authority: Cloudflare Durable Objects with hibernatable WebSockets.
- Database/authentication: none in v1 unless later evidence requires them.
- Mobile: non-release-critical.

## C0 deliverables

1. Production-shaped React/Vite project.
2. Cesium Earth viewport with token-safe setup state.
3. Demo Regional Theater camera target.
4. Runtime FPS and transfer instrumentation.
5. Cloudflare Worker `/api/health` endpoint.
6. Static-asset caching rules.
7. Cesium runtime asset sync script.
8. Documented acceptance criteria and resource budget.

## Acceptance criteria

C0 closes only when all of the following are observed on a real machine/account:

- `pnpm install` exits 0.
- `pnpm check` exits 0.
- `pnpm build` exits 0.
- Local page renders Cesium Earth after a valid restricted ion token is configured.
- `/api/health` returns HTTP 200 with `stage = C0_FOUNDATION`.
- `pnpm deploy` produces a public `workers.dev` URL.
- Production URL loads on two desktop browsers.
- Diagnostics panel reports FPS and browser-visible transferred MiB.

## Resource gate carried into C2

A standardized 30-minute session will later record:

- median/minimum FPS;
- total transferred MiB measured from browser DevTools/HAR (the in-app Performance API counter is diagnostic only and may undercount cross-origin resources);
- browser memory observations where supported;
- visible terrain-streaming stalls/errors.

Target engineering budget: <= 150 MiB transferred per player-session and >= 45 FPS target, with 30 FPS as the minimum acceptance floor on the selected school-class laptop.

## Out of scope for C0

Flight dynamics, aircraft models, multiplayer rooms, scoring, target/tag mechanics, terrain collision, theater boundary enforcement, audio, and release UX.
