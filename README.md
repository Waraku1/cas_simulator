# CAS Flight Simulator

Browser-based CAS flight-simulator project built on Cesium Earth.

## Architecture

- React 19 + TypeScript + Vite
- CesiumJS 1.145
- Cloudflare Workers + Static Assets in production
- Fictional game-oriented flight model (C1, CLOSED)
- Regional theater contract: 50 km × 50 km (C2, CLOSED)
- Cloudflare Durable Object + Hibernation WebSocket multiplayer in production (C3)
- dependency-free Node localhost multiplayer relay for the managed school Mac

## One-time setup

Requirements: Node.js 22+ and pnpm 10.x.

```bash
pnpm install
cp .env.example .env.local
```

Create a Cesium ion browser token with only the minimum read permissions needed for the assets used by this app, then set `VITE_CESIUM_ION_TOKEN` in `.env.local`. Do not commit token files.

## School development mode

The managed school network blocks the public Cloudflare `workers.dev` production hostname before application content loads. In addition, the development Mac runs macOS 12.3, while the current Cloudflare `workerd` local runtime requires a newer macOS release. School use therefore does not depend on either the public Worker hostname or local `workerd`.

The canonical school mode is:

```bash
pnpm dev:school
```

Open:

```text
http://127.0.0.1:5173
```

This starts:

- the normal Vite/Cesium client on `127.0.0.1:5173`;
- a dependency-free Node C3 relay on `127.0.0.1:8787`;
- a Vite proxy that keeps `/api/health` and `/api/rooms/{ROOM}/ws` on the same browser origin.

The Node relay implements the same bounded C3 room/presence/pose-relay contract needed by the browser, while production remains Cloudflare Worker + Durable Object.

For a quick school-local backend/multiplayer self-test, leave `pnpm dev:school` running and use a second terminal:

```bash
pnpm verify:school
```

That check verifies the local health endpoint, creates two WebSocket clients, joins them to one generated room, verifies two-player presence, and verifies one pose relay.

The previous client-only mode remains available:

```bash
pnpm dev
```

Use client-only mode only when multiplayer/backend behavior is intentionally unnecessary.

Two independent browser contexts on the same Mac can use the local room backend. Separate school-managed devices are not assumed to reach a laptop-hosted service across the managed Wi-Fi. Do not bypass TLS warnings or school filtering controls, and do not expose the development server on the managed LAN without explicit authorization.

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
- maximum 2 connected clients;
- local flight simulation remains authoritative for the local aircraft;
- local pose snapshots publish at approximately 5 Hz;
- the room validates and relays snapshots without running a server simulation tick;
- the receiving client interpolates the peer aircraft locally.

Production uses one SQLite-backed Cloudflare Durable Object per room and the Hibernation WebSocket API. School localhost uses a Node relay with the same browser-facing protocol because current `workerd` cannot run on the managed macOS 12.3 device.

C3 is implemented and deployed. Production health, Durable Object binding, two-client presence, and pose relay have passed automated production verification. School-local transport is verified separately through `pnpm verify:school`.

C3 contains networking/presence only. Later competition/scoring behavior remains outside this gate.

## Production mode

Production build/deployment is executed through GitHub Actions using repository secrets for Cloudflare and Cesium credentials. The deployment workflow verifies the production root, C3 health feature, and a real two-client WebSocket pose relay.

Current production health endpoint:

```text
https://cas-flight-simulator.heleshiheiheleshihei.workers.dev/api/health
```

The public production hostname remains subject to the school-managed network policy. School development/demo uses `pnpm dev:school` instead of attempting to bypass that policy.

## Validate

```bash
pnpm validate:scaffold
pnpm check
pnpm build
```

For school full-stack validation:

```bash
pnpm dev:school
# in another terminal
pnpm verify:school
```

## Project gates

- C0 Foundation — CLOSED
- C1 Flight — CLOSED / ACCEPTED
- C2 World / Theater resource gate — CLOSED / ACCEPTED
- C3 Multiplayer — IMPLEMENTED + DEPLOYED / SCHOOL LOCAL QA PENDING
- C4 Competition loop — pending
- C5 Release — pending

See `docs/architecture/C0_FOUNDATION.md`, `docs/architecture/C0_STATUS.md`, `docs/architecture/C1_FLIGHT.md`, `docs/architecture/C2_WORLD_THEATER.md`, `docs/architecture/C3_MULTIPLAYER.md`, and `docs/operations/SCHOOL_NETWORK_COMPATIBILITY.md`.
