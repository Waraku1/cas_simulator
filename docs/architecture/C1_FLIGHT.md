# C1 — Flight Vertical Slice

Status: C1.4 BODY-AXIS ATTITUDE IMPLEMENTED / LOCAL RE-VERIFY PENDING

## Objective

Create the first interactive flight experience on top of the C0 Cesium foundation without introducing multiplayer or game-loop mechanics.

The aircraft is fictional and generic. C1 remains a kinematic game-flight model rather than a reproduction of any real aircraft's aerodynamic performance or procedures.

## Canonical flight state

C1.4 changes attitude representation fundamentally.

Canonical state:
- latitude / longitude;
- altitude;
- normalized orientation quaternion relative to local ENU;
- speed;
- throttle;
- vertical speed.

`heading`, `pitch`, and `bank` are now telemetry derived from the quaternion for HUD display. They are not independently integrated control-state variables.

Body axes:
- `+X = forward`;
- `+Y = left`;
- `+Z = up`.

Local geographic axes:
- `+X = east`;
- `+Y = north`;
- `+Z = up`.

## Controls

- `W` / `S`: pitch-rate input about the aircraft's own lateral axis;
- `A` / `D`: roll-rate input about the aircraft's own forward axis;
- `Q` / `E`: experimental direct-yaw input for C1 testing only;
- `ArrowUp` / `ArrowDown`: throttle.

`ArrowLeft`, `ArrowRight`, and `Space` are not part of C1 flight control. They remain reserved for a later abstract C4 game-action interface.

## C1.4 body-axis attitude contract

Pitch and roll are intrinsic aircraft-body rotations.

- Pitch has no earth-relative angle clamp.
- Roll/bank has no angle clamp.
- Roll no longer auto-recenters when `A` / `D` are released.
- Orientation is normalized as a quaternion after every input update, so continuous loops and rolls remain numerically stable.
- W/S always rotates about the aircraft's own lateral axis, not a fixed world-horizontal axis.
- A/D always rotates about the aircraft's own forward axis.

This means the effect of pitch input depends on bank attitude. At approximately 0° bank, W/S primarily changes nose elevation. At approximately 90° bank, the aircraft lateral axis is approximately vertical relative to the Earth, so W/S primarily changes horizontal travel direction. This is the intended C1.4 behavior.

C1.4 intentionally removes the earlier synthetic `bankTurn` term. Travel direction is now derived directly from the aircraft's quaternion forward vector; turns occur because the aircraft attitude itself changes.

`Q/E` direct yaw remains temporary test instrumentation. Mandatory removal before final release is tracked separately in Issue #7.

## Position integration

The quaternion-derived local body-forward vector is also the velocity direction.

Each update:
1. apply body-axis pitch/roll/yaw-test rotations to the orientation quaternion;
2. normalize the quaternion;
3. derive the body forward vector in local ENU coordinates;
4. advance east/north position from the forward vector's horizontal components;
5. advance altitude from the forward vector's vertical component;
6. apply the C1 altitude bounds.

Altitude bounds remain independent of terrain collision during C1. Terrain/collision behavior belongs to later gates.

## Rendering alignment

The flight model exports its canonical local body frame directly. The Cesium renderer converts that frame from local ENU to ECEF and uses the same frame for:
- aircraft quaternion orientation;
- asymmetric nose marker;
- chase-camera position;
- camera look direction.

Rendering therefore does not independently reconstruct heading/pitch/bank.

This preserves the C1.3 correction that made aircraft nose, camera, and actual travel direction share one reference-frame contract.

## HUD telemetry

The HUD shows:
- speed;
- altitude;
- heading;
- earth-relative pitch display;
- wrapped bank display;
- vertical speed;
- throttle;
- controls;
- runtime diagnostics.

Because Euler-style heading/pitch/bank displays are derived from a full quaternion, conventional display ambiguity near vertical attitudes is expected. It does not constrain the actual orientation or controls.

`Q/E` is labeled `YAW TEST` so the temporary direct-yaw path remains visibly experimental.

## Verification evidence

Previous C1/C1.1/C1.2/C1.3 revisions passed GitHub Actions with:
- `pnpm install --frozen-lockfile`: PASS;
- `pnpm validate:scaffold`: PASS;
- `pnpm check`: PASS;
- `pnpm build`: PASS.

Local QA on 2026-09-16 confirmed Cesium Earth/HUD rendering, corrected travel direction, relaxed pitch/bank behavior, readable diagnostics, and approximately 97 FPS before C1.4.

## C1.4 acceptance

Automated:
- [ ] `pnpm validate:scaffold` exits 0.
- [ ] `pnpm check` exits 0.
- [ ] `pnpm build` exits 0.
- [x] Orientation is normalized and finite by construction.
- [x] No pitch or bank angle clamp exists in the canonical attitude state.
- [x] No bank auto-recenter exists.
- [x] No synthetic bank-turn term remains in the canonical position integration.

Manual localhost re-verification:
- [ ] A/D can roll continuously through 90°, 180°, and 360° without clamping or automatic return to level.
- [ ] At near-level bank, W/S primarily changes climb/dive direction.
- [ ] At approximately 90° bank, W/S primarily changes horizontal travel direction.
- [ ] Aircraft nose, camera, and actual motion remain aligned through combined pitch/roll inputs.
- [ ] `Q/E` remains visibly marked `YAW TEST`.
- [ ] Runtime FPS remains acceptable.

## Deferred

C2 owns theater boundaries and the 30-minute performance/resource gate. C3 owns multiplayer synchronization. C4 owns the abstract competitive game loop. Final release owns removal of the experimental direct-yaw control.
