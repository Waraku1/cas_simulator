# CAS Flight Simulator

C0 foundation for a two-player, browser-based flight experience built on Cesium Earth.

## Architecture

- React 19 + TypeScript + Vite
- CesiumJS 1.145
- Cloudflare Workers + Static Assets
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

## Run

```bash
pnpm dev
```

Health endpoint:

```text
/api/health
```

## Validate

```bash
pnpm check
pnpm build
pnpm preview
```

## Deploy target

Authenticate Wrangler once on the development machine, then:

```bash
pnpm deploy
```

The Cloudflare Vite plugin deploys the client assets and Worker as one unit.

## Project gates

- C0 Foundation
- C1 Flight
- C2 World / Theater resource gate
- C3 Multiplayer
- C4 Game loop
- C5 Release

See `docs/architecture/C0_FOUNDATION.md` for the C0 contract.
