# C3 — Multiplayer Foundation

Status: **IMPLEMENTED + DEPLOYED / MANUAL TWO-BROWSER UI QA PENDING**

## Objective

Add a bounded two-player networking layer without changing the accepted C1 flight model or C2 theater/performance contracts.

C3 is transport/presence only. It does not add C4 competition or scoring semantics.

## Room contract

- Private room code: 6 characters.
- Alphabet excludes visually ambiguous characters.
- One Cloudflare Durable Object instance per room code.
- Maximum clients per room: 2.
- No account/auth/database dependency in v1.
- A full room rejects a third WebSocket before upgrade.

## Worker / Durable Object architecture

Route: `/api/rooms/{ROOM}/ws`.

The Worker maps the normalized room code to `ROOMS.idFromName(roomCode)` and forwards the upgrade request to that Durable Object.

`MultiplayerRoom` uses Cloudflare's Hibernation WebSocket API. Each accepted socket stores a compact attachment containing the generated player ID and slot number. The room uses no periodic server timer: valid incoming pose snapshots are relayed directly to the peer.

The namespace is SQLite-backed through the `c3-v1` `new_sqlite_classes` migration.

## Protocol

Canonical definitions live in `src/shared/multiplayer.ts` and are shared by browser and Worker builds.

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

Local aircraft simulation remains at the C2-governed 60 FPS cap. When connected, `EarthScene` publishes local pose at approximately 5 Hz (200 ms). The receiving client interpolates peer latitude/longitude/altitude linearly and orientation with quaternion spherical interpolation. Peer aircraft use a distinct visual material.

The compact room UI exposes create, join, leave, room code, connection state, and peer presence. Form controls are guarded so room-code input does not trigger flight controls.

## School-network split

The normal school development path remains client-only `pnpm dev` at `127.0.0.1:5173`. Because that path does not host the Worker API, multiplayer connection attempts may show a bounded backend-unavailable state without breaking flight/theater/diagnostics.

Human-visible two-browser verification is performed against the deployed Worker on an allowed network. School filtering is not bypassed.

## Performance contract

- local simulation/render cap remains 60 FPS;
- network publish cadence: ~5 Hz per client;
- no server simulation tick;
- no server broadcast timer;
- server relays only validated snapshots;
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
- [x] localhost backend-unavailable state is non-fatal.
- [x] PR CI run `35061807978`: PASS.
- [x] merged-main CI run `35061871273`: PASS.

## Production evidence — 2026-09-16

Production deployment succeeded through GitHub Actions. Wrangler confirmed:

- `env.ROOMS (MultiplayerRoom)` Durable Object binding;
- production root available;
- `/api/health` reports `features.multiplayer = C3_FOUNDATION`;
- deployed Cloudflare version `ff2ad6f3-1e0f-47a5-980e-f9ea44626928`.

An automated production WebSocket smoke test then connected two independent clients to the same generated room, verified 2-player presence, sent pose sequence `1` from client 1, and verified that client 2 received the relayed peer pose with matching server identity. Actions run `35062194182` passed.

The smoke test is retained as `scripts/verify-production-multiplayer.mjs` and is part of the production deployment verification workflow.

## Remaining C3 closure evidence

- [ ] Open the production UI in two browser contexts/devices on an allowed network.
- [ ] Browser A creates a room and Browser B joins the same code.
- [ ] Both panels show connected/peer online.
- [ ] Each browser visibly renders the peer aircraft.
- [ ] Peer movement and orientation interpolation are subjectively usable/stable.
- [ ] Leave/rejoin behavior does not break the remaining client.
- [ ] No obvious C1/C2 UI or performance regression.

C3 remains OPEN only for this final human-visible two-browser interpolation/UI QA.
