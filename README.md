# CAS Flight Simulator

Browser-based CAS flight-simulator project built on Cesium Earth.

## Architecture

- React 19 + TypeScript + Vite
- CesiumJS 1.145
- Cloudflare Workers + Static Assets
- Fictional game-oriented flight model (C1, CLOSED)
- Regional theater contract: 50 km × 50 km (C2, CLOSED)
- Cloudflare Durable Object + Hibernation WebSocket multiplayer (C3)

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

The client-only localhost server does not host the Cloudflare Worker/Durable Object backend. C3 room connection attempts therefore fail gracefully in this mode while flight, theater, HUD, and diagnostics remain usable. Real two-browser multiplayer verification is performed against the deployed Worker on an allowed network.

## Flight controls

- `W / S`: pitch
- `A / D`: roll/bank
- `ArrowUp / ArrowDown`: throttle
- `Q / E`: temporary `YAW TEST` development instrumentation; removal before release is tracked by Issue #7

The aircraft is fictional and uses game-oriented kinematics rather than real-aircraft performance data.

## C2 theater and resource gate

C2 adds a visible 50 km × 50 km theater boundary, a 5 km edge-warning band, and browser-side performance/resource evidence.

C2 is CLOSED / ACCEPTED. After correcting the benchmark measurement and introducing a 60 FPS runtime governor, the accepted active-foreground preflight measured 59.9 average FPS and a 52 FPS minimum valid sample. The previously planned 30-minute soak was explicitly waived because the remediated preflight, functional boundary QA, and control-regression QA satisfied the gate at substantially lower device/time cost. The waiver is recorded in Issue #12 and `docs/architecture/C2_WORLD_THEATER.md`.

## C3 multiplayer foundation

C3 introduces a bounded private two-player room layer:

- 6-character room codes;
- one SQLite-backed Durable Object per room;
- maximum 2 connected clients;
- Hibernation WebSocket API;
- local flight simulation remains authoritative for the local aircraft;
- local pose snapshots publish at approximately 5 Hz;
- the room validates and relays snapshots without running a server simulation tick;
- the receiving client interpolates the peer aircraft locally.

C3 contains networking/presence only. Later competition/scoring behavior remains outside this gate.

## Production mode

Production build/deployment is executed through GitHub Actions using repository secrets for Cloudflare and Cesium credentials. Production runtime health is verified automatically after deployment.

Current production health endpoint:

```text
https://cas-flight-simulator.heleshiheiheleshihei.workers.dev/api/health
```

Production browser verification is performed on an allowed network before release closure.

## Validate

```bash
pnpm validate:scaffold
pnpm check
pnpm build
```

## Project gates

- C0 Foundation — CLOSED
- C1 Flight — CLOSED / ACCEPTED
- C2 World / Theater resource gate — CLOSED / ACCEPTED
- C3 Multiplayer — IMPLEMENTATION IN PROGRESS / NETWORK QA PENDING
- C4 Competition loop — pending
- C5 Release — pending

See `docs/architecture/C0_FOUNDATION.md`, `docs/architecture/C0_STATUS.md`, `docs/architecture/C1_FLIGHT.md`, `docs/architecture/C2_WORLD_THEATER.md`, `docs/architecture/C3_MULTIPLAYER.md`, and `docs/operations/SCHOOL_NETWORK_COMPATIBILITY.md`.
