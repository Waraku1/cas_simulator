# CAS Flight Simulator

Browser-based CAS flight-simulator project built on Cesium Earth.

## Architecture

- React 19 + TypeScript + Vite
- CesiumJS 1.145
- Cloudflare Workers + Static Assets
- Fictional bounded flight model (C1)
- Regional Theater contract: 50 km × 50 km
- Durable Objects/WebSocket multiplayer reserved for C3

## One-time setup

Requirements: Node.js 22+ and pnpm 10.x.

```bash
pnpm install
cp .env.example .env.local
```

Create a Cesium ion browser token with only the minimum read permissions needed for the assets used by this app, then set:

```text
VITE_CESIUM_ION_TOKEN=...
```

Do not commit `.env.local`.

## School development mode

The managed school network blocks the current Cloudflare `workers.dev` production hostname. Development therefore uses the client-only localhost mode:

```bash
pnpm dev
```

Open:

```text
http://127.0.0.1:5173
```

This is the canonical school-day development/demo path. Do not bypass TLS warnings or school filtering controls.

## C1 flight controls

- `W` / `S`: pitch
- `A` / `D`: bank
- `Q` / `E`: yaw input
- `R` / `F`: throttle

The C1 aircraft is fictional and uses bounded game-oriented dynamics rather than real-aircraft performance data.

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

- C0 Foundation — CLOSED (engineering foundation)
- C1 Flight — IMPLEMENTED / manual localhost QA pending
- C2 World / Theater resource gate
- C3 Multiplayer
- C4 Game loop
- C5 Release

See `docs/architecture/C0_FOUNDATION.md`, `docs/architecture/C0_STATUS.md`, `docs/architecture/C1_FLIGHT.md`, and `docs/operations/SCHOOL_NETWORK_COMPATIBILITY.md`.
