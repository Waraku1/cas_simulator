# CAS Flight Simulator

Browser-based CAS flight-simulator project built on Cesium Earth.

## Architecture

- React 19 + TypeScript + Vite
- CesiumJS 1.145
- Cloudflare Workers + Static Assets
- Fictional game-oriented flight model (C1, CLOSED)
- Regional theater contract: 50 km × 50 km (C2)
- Durable Objects/WebSocket multiplayer reserved for C3

## One-time setup

Requirements: Node.js 22+ and pnpm 10.x.

```bash
pnpm install
cp .env.example .env.local
```

Create a Cesium ion browser token with only the minimum read permissions needed for the assets used by this app, then set `VITE_CESIUM_ION_TOKEN` in `.env.local`. Do not commit token files.

## School development mode

The managed school network blocks the current Cloudflare `workers.dev` production hostname. Development therefore uses the client-only localhost path:

```bash
pnpm dev
```

Open `http://127.0.0.1:5173`. Do not bypass TLS warnings or school filtering controls.

## Flight controls

- `W / S`: pitch
- `A / D`: roll/bank
- `ArrowUp / ArrowDown`: throttle
- `Q / E`: temporary `YAW TEST` development instrumentation; removal before release is tracked by Issue #7

The aircraft is fictional and uses game-oriented kinematics rather than real-aircraft performance data.

## C2 theater and resource gate

C2 adds a visible 50 km × 50 km theater boundary, a 5 km edge-warning band, and a 30-minute browser benchmark panel. The panel tracks current/average/minimum FPS, elapsed time, browser-observed transfer, resource counts, and optional heap data. `COPY C2 REPORT` copies structured evidence for the project log.

Browser-observed transfer is intentionally labeled as such because cross-origin resources and cache hits can report zero bytes in Resource Timing.

## Production mode

Production build/deployment is executed through GitHub Actions using repository secrets for Cloudflare and Cesium credentials. Production runtime health is verified automatically after deployment.

Current production health endpoint:

```text
https://cas-flight-simulator.heleshiheiheleshihei.workers.dev/api/health
```

Production browser verification is performed on an allowed network before C5 release closure.

## Validate

```bash
pnpm validate:scaffold
pnpm check
pnpm build
```

## Project gates

- C0 Foundation — CLOSED
- C1 Flight — CLOSED / ACCEPTED
- C2 World / Theater resource gate — IMPLEMENTED / 30-MIN QA PENDING
- C3 Multiplayer — pending C2 closure
- C4 Game loop — pending
- C5 Release — pending

See `docs/architecture/C0_FOUNDATION.md`, `docs/architecture/C0_STATUS.md`, `docs/architecture/C1_FLIGHT.md`, `docs/architecture/C2_WORLD_THEATER.md`, and `docs/operations/SCHOOL_NETWORK_COMPATIBILITY.md`.
