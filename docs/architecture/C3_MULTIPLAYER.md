# C3 — Multiplayer Foundation

Status: **IMPLEMENTED ON BRANCH / AUTOMATED + NETWORK QA PENDING**

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

Route:

`/api/rooms/{ROOM}/ws`

The Worker maps the normalized room code to `ROOMS.idFromName(roomCode)` and forwards the upgrade request to that Durable Object.

`MultiplayerRoom` uses Cloudflare's Hibernation WebSocket API. Each accepted socket stores a compact attachment containing the generated player ID and slot number. The attachment survives Durable Object hibernation while the WebSocket remains healthy.

The room does not use `setInterval` or other periodic server timers. Incoming client pose messages are validated and immediately relayed to the other connected client. This preserves the hibernation-friendly execution model.

The namespace is SQLite-backed through the `c3-v1` `new_sqlite_classes` migration, even though C3 does not yet need persistent game state.

## Protocol

Canonical definitions live in `src/shared/multiplayer.ts` and are shared by browser and Worker builds.

Client -> room:
- `pose` only.

Room -> client:
- `welcome`;
- `presence`;
- `peer_pose`;
- bounded `error` messages.

Pose snapshots contain only:
- latitude;
- longitude;
- altitude;
- normalized local-body quaternion;
- monotonic client sequence;
- client-local timestamp.

The server does not accept client-supplied identity and does not simulate the aircraft.

Protocol guards:
- maximum text message size: 2048 bytes;
- finite/range checks for coordinates/altitude;
- quaternion norm sanity check;
- safe-integer sequence check;
- binary messages rejected.

## Client architecture

Local aircraft simulation remains at the C2-governed 60 FPS cap.

When a WebSocket is connected, `EarthScene` publishes the current local pose at approximately 5 Hz (200 ms). The server relays that snapshot to the peer.

The receiving client keeps the previous and current peer snapshots and interpolates between them during the local render loop:
- latitude/longitude/altitude: linear interpolation;
- orientation: quaternion spherical interpolation;
- remote entity rendering: separate visual material from the local aircraft.

The room UI exposes:
- create room;
- join room;
- leave room;
- normalized room code;
- waiting/connected/error state;
- peer presence.

Form controls are guarded so typing into the room-code field does not trigger flight controls.

## School-network split

The normal school development path remains client-only `pnpm dev` at `127.0.0.1:5173`.

Because that path does not host the Worker API, multiplayer connection attempts may show a bounded backend-unavailable state. This must not break local flight, theater, or diagnostics.

Actual two-browser WebSocket verification is performed against the deployed Worker on an allowed network. This is consistent with the accepted school-network architecture from C0/C2.

## Performance contract

- local simulation/render cap remains 60 FPS;
- network publish cadence: ~5 Hz per client;
- no server simulation tick;
- no server broadcast timer;
- server relays only validated snapshots;
- C2 diagnostics remain active so C3 network load can be compared against the accepted C2 baseline.

If C3 materially increases device/network load, a new bounded soak test may be introduced without reopening C2.

## C3 exit criteria

Automated/implementation gate:
- [ ] protocol types and validators pass TypeScript/build;
- [ ] Durable Object binding and SQLite migration validate;
- [ ] Worker upgrade route compiles;
- [ ] Hibernation WebSocket room compiles;
- [ ] 2-player capacity guard exists;
- [ ] client create/join/leave UI compiles;
- [ ] local ~5 Hz pose publish path compiles;
- [ ] remote interpolation/render path compiles;
- [ ] localhost backend-unavailable state is non-fatal;
- [ ] `pnpm validate:scaffold`, `pnpm check`, and `pnpm build` pass.

Manual/deployment gate:
- [ ] C3 Worker deploy succeeds with `ROOMS` Durable Object namespace;
- [ ] two browsers join the same private room;
- [ ] both clients report peer connected;
- [ ] each client sees the other aircraft move with usable interpolation;
- [ ] third-client/full-room behavior is bounded;
- [ ] disconnect/reconnect does not break the remaining client;
- [ ] C1 controls/camera and C2 theater/performance behavior show no regression.

C3 remains open until allowed-network two-browser verification passes.
