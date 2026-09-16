# C0 — Foundation Baseline

Status: CLOSED — ENGINEERING FOUNDATION

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
- School-managed-network development mode: client-only localhost via `pnpm dev`.
- Production deployment/verification: GitHub Actions on supported Linux runners.

## C0 deliverables

1. Production-shaped React/Vite project.
2. Cesium Earth viewport with token-safe setup state.
3. Demo Regional Theater camera target.
4. Runtime FPS and transfer instrumentation.
5. Cloudflare Worker `/api/health` endpoint.
6. Static-asset caching rules.
7. Cesium runtime asset sync script.
8. Reproducible lockfile-based CI and production deployment workflow.
9. Documented acceptance criteria and resource budget.

## Acceptance evidence

C0 engineering foundation is closed with the following observed evidence:

- `pnpm install --frozen-lockfile` exits 0 locally/CI.
- `pnpm check` exits 0.
- `pnpm build` exits 0.
- Local client-only page renders and operates Cesium Earth with a restricted ion token.
- Local diagnostics observed: 120 FPS, 43.4 MiB visible transfer, 163 resources.
- GitHub Actions deploys the client assets and Worker successfully.
- Production root returns HTTP success from supported external infrastructure.
- `/api/health` returns HTTP 200 with `ok = true` and `stage = C0_FOUNDATION`.
- Production Cesium token is injected through GitHub Actions Secrets and is not stored in the repository.

## Environment boundary

The school-managed network blocks the current `workers.dev` production hostname through Fortinet/TLS policy before application content loads. This is an external network-policy constraint, not a C0 implementation failure.

Accordingly:

- school-day development and demonstrations may use `http://127.0.0.1:5173` with `pnpm dev`;
- production deployment remains Cloudflare Workers through GitHub Actions;
- final production browser rendering is verified on an allowed network before C5 release closure;
- no certificate bypass, filtering evasion, unapproved CA installation, VPN/proxy workaround, or security-control modification is part of the project plan.

School-network production reachability is tracked separately in Issue #2 and is non-blocking for C1–C4 development.

## Resource gate carried into C2

A standardized 30-minute session will later record:

- median/minimum FPS;
- total transferred MiB measured from browser DevTools/HAR (the in-app Performance API counter is diagnostic only and may undercount cross-origin resources);
- browser memory observations where supported;
- visible terrain-streaming stalls/errors.

Target engineering budget: <= 150 MiB transferred per player-session and >= 45 FPS target, with 30 FPS as the minimum acceptance floor on the selected school-class laptop.

## Out of scope for C0

Flight dynamics, aircraft models, multiplayer rooms, scoring, abstract tag mechanics, terrain collision, theater boundary enforcement, audio, and release UX.
