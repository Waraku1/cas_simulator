# C3 — Multiplayer Foundation

Status: **IMPLEMENTED + DEPLOYED / SCHOOL LOCAL BROWSER QA PENDING**

## Objective

Add a bounded two-player networking layer without changing the accepted C1 flight model or C2 theater/performance contracts.

C3 is transport/presence only. It does not add C4 competition or scoring semantics.

## Room contract

- Private room code: 6 characters.
- Alphabet excludes visually ambiguous characters.
- Maximum clients per room: 2.
- No account/auth/database dependency in v1.
- A full room rejects a third WebSocket before normal participation.

## Production Worker / Durable Object architecture

Route: `/api/rooms/{ROOM}/ws`.

The production Worker maps the normalized room code to `ROOMS.idFromName(roomCode)` and forwards the upgrade request to that Durable Object.

`MultiplayerRoom` uses Cloudflare's Hibernation WebSocket API. Each accepted socket stores a compact attachment containing the generated player ID and slot number. The room uses no periodic server timer: valid incoming pose snapshots are relayed directly to the peer.

The namespace is SQLite-backed through the `c3-v1` `new_sqlite_classes` migration.

## Protocol

Canonical browser/production definitions live in `src/shared/multiplayer.ts`.

Client -> room:
- `pose` only.

Room -> client:
- `welcome`;
- `presence`;
- `peer_pose`;
- bounded `error` messages.

Pose snapshots contain latitude, longitude, altitude, normalized local-body quaternion, monotonic client sequence, and client-local timestamp. The server generates player identity and does not simulate the aircraft.

Protocol guards include a 2048-byte text-message limit, finite/range checks, quaternion-norm sanity check, safe-integer sequence validation, and rejection of binary messages.

## Client architecture

Local aircraft simulation remains at the C2-governed 60 FPS cap. When connected, `EarthScene` publishes local pose at approximately 10 Hz (100 ms). The receiving client estimates short-horizon peer motion from the latest sender snapshots, caps dead-reckoning at 180 ms, and exponentially smooths both position and quaternion orientation toward the predicted pose. This presentation-layer prediction is visual only; the room/worker continues to validate and relay client pose snapshots without becoming a flight-simulation authority. Peer aircraft retain a distinct visual marker/material treatment.

The compact room UI exposes create, join, leave, room code, connection state, and peer presence. Form controls are guarded so room-code input does not trigger flight controls.

## School-local transport compatibility

The managed school Mac has two independent constraints:

- public `workers.dev` is blocked by managed-network policy;
- macOS 12.3 is below the current workerd runtime requirement, so Cloudflare Vite/Miniflare cannot start locally on that device.

School mode therefore preserves the C3 browser-facing protocol but swaps only the local transport implementation:

- Vite client: `127.0.0.1:5173`;
- dependency-free Node relay: `127.0.0.1:8787`;
- `vite.school.config.ts` proxies `/api/*` and WebSocket upgrades to the relay;
- browser code continues using `/api/health` and `/api/rooms/{ROOM}/ws` without a school-specific client code path.

The Node relay implements the bounded semantics required by C3 school use: room validation, two-player capacity, server identity/slot assignment, welcome/presence, pose validation/relay, and disconnect presence updates. It is not a replacement for the production Durable Object implementation and is not deployed publicly.

`pnpm dev:school` starts the local relay and school Vite client together. `pnpm verify:school` first validates local C3 health, then connects two WebSocket clients, verifies presence, and verifies one peer-pose relay.

This school path avoids both the blocked production hostname and unsupported local workerd binary without bypassing school network controls.

## Performance contract

- local simulation/render cap remains 60 FPS;
- network publish cadence: ~5 Hz per client;
- no server simulation tick;
- production room has no server broadcast timer;
- school relay is event-driven and relays only validated snapshots;
- C2 diagnostics remain active for regression comparison.

## Automated implementation evidence

C3 implementation merged through PR #27 as main commit `d57a6f60ae248d87bfe1bdcf8564daa3ba675d4d`.

- [x] Shared protocol types and validators compile.
- [x] Durable Object binding and SQLite migration validate.
- [x] Worker WebSocket route compiles.
- [x] Hibernation room implementation compiles.
- [x] 2-player capacity guard exists.
- [x] client create/join/leave UI compiles.
- [x] local ~5 Hz pose publication compiles.
- [x] remote interpolation/rendering compiles.
- [x] PR CI run `35061807978`: PASS.
- [x] merged-main CI run `35061871273`: PASS.

## Production evidence — 2026-09-16

Production deployment succeeded through GitHub Actions. Wrangler confirmed:

- `env.ROOMS (MultiplayerRoom)` Durable Object binding;
- production root available;
- `/api/health` reports `features.multiplayer = C3_FOUNDATION`;
- deployed Cloudflare version `ff2ad6f3-1e0f-47a5-980e-f9ea44626928`.

An automated production WebSocket smoke test connected two independent clients to the same generated room, verified 2-player presence, sent pose sequence `1` from client 1, and verified that client 2 received the relayed peer pose with matching server identity. Actions run `35062194182` passed.

The smoke test is retained as `scripts/verify-production-multiplayer.mjs` and is part of the production deployment verification workflow.

## Remaining C3 closure evidence

- [ ] On the managed school Mac, `pnpm dev:school` starts without workerd/macOS failure.
- [ ] `curl http://127.0.0.1:5173/api/health` returns JSON with `features.multiplayer = C3_FOUNDATION` and the school-local runtime marker.
- [ ] `pnpm verify:school` passes.
- [ ] Two independent browser contexts create/join the same local room.
- [ ] Both panels show connected/peer online.
- [ ] Each browser visibly renders the peer aircraft.
- [ ] Peer movement/orientation interpolation is usable and stable.
- [ ] Leave/rejoin behavior does not break the remaining client.
- [ ] No obvious C1/C2 UI or performance regression.

C3 remains OPEN only for this final school-Mac human-visible multiplayer QA.
