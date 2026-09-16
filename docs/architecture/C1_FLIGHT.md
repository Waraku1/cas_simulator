# C1 — Flight Vertical Slice

Status: C1.6 LEVEL-CAPTURE TUNING IMPLEMENTED / LOCAL RE-VERIFY PENDING

## Objective

Create the first interactive flight experience on top of the C0 Cesium foundation without introducing multiplayer or game-loop mechanics.

The aircraft is fictional and generic. C1 remains a kinematic game-flight model rather than a reproduction of any real aircraft's aerodynamic performance or procedures.

## Canonical flight state

Canonical state:
- latitude / longitude;
- altitude;
- normalized orientation quaternion relative to local ENU;
- pitch angular velocity;
- roll angular velocity;
- speed;
- throttle;
- vertical speed.

`heading`, `pitch`, and `bank` are telemetry derived from the quaternion for HUD display. They are not independently integrated control-state variables.

Body axes:
- `+X = forward`;
- `+Y = left`;
- `+Z = up`.

Local geographic axes:
- `+X = east`;
- `+Y = north`;
- `+Z = up`.

## Controls

- `W` / `S`: pitch command about the aircraft's own lateral axis;
- `A` / `D`: roll command about the aircraft's own forward axis;
- `Q` / `E`: experimental direct-yaw input for C1 testing only;
- `ArrowUp` / `ArrowDown`: throttle.

`ArrowLeft`, `ArrowRight`, and `Space` are not part of C1 flight control. They remain reserved for a later abstract C4 game-action interface.

## C1.4 body-axis attitude contract

Pitch and roll are intrinsic aircraft-body rotations.

- Pitch has no earth-relative angle clamp.
- Roll/bank has no angle clamp.
- Orientation is normalized as a quaternion after every input update, so continuous loops and rolls remain numerically stable.
- W/S always rotates about the aircraft's own lateral axis, not a fixed world-horizontal axis.
- A/D always rotates about the aircraft's own forward axis.

This means the effect of pitch input depends on bank attitude. At approximately 0° bank, W/S primarily changes nose elevation. At approximately 90° bank, the aircraft lateral axis is approximately vertical relative to the Earth, so W/S primarily changes horizontal travel direction.

Travel direction is derived directly from the aircraft's quaternion forward vector; no synthetic bank-turn term exists.

## C1.5 control-response dynamics

C1.5 changes W/S and A/D from instantaneous angular-rate commands to accelerated angular response.

Pitch:
- maximum pitch rate: 34 deg/s;
- acceleration while W/S is held: 70 deg/s²;
- release deceleration: 180 deg/s².

Roll:
- maximum roll rate: 72 deg/s;
- acceleration while A/D is held: 160 deg/s²;
- release deceleration: 360 deg/s².

The maximum rates intentionally preserve the established C1.4 control sensitivity. The new acceleration stage changes only how quickly those rates are reached.

Operationally:
1. pressing a pitch/roll key starts with a low angular velocity;
2. continuing to hold the key increases angular velocity toward its bounded rate;
3. releasing the key does not set angular velocity to zero instantly;
4. a stronger release deceleration rapidly and continuously brings angular velocity to zero.

This creates progressive control onset and short control overrun without introducing a real-aircraft aerodynamic model.

### Near-level capture — C1.6 tuning

Small residual attitude is automatically returned to level only under a bounded capture condition.

For pitch and bank independently:
- the displayed angle must be within ±5°;
- the relevant input must be released;
- the relevant angular velocity must already be at or below 1.5 deg/s.

When those conditions hold, the remaining angle is driven toward exactly 0° at up to 18 deg/s. This is intentionally softer than the previous C1.5 capture rate of 24 deg/s while allowing a slightly wider ±5° capture region.

Outside the ±5° capture region, C1.6 applies no auto-level authority. Full loops and continuous rolls therefore remain available exactly as in C1.4/C1.5.

## Position integration

The quaternion-derived local body-forward vector is also the velocity direction.

Each update:
1. update pitch and roll angular velocities from the current input;
2. apply body-axis pitch/roll/yaw-test rotations to the orientation quaternion;
3. normalize the quaternion;
4. apply near-level pitch/bank capture only when its bounded conditions are met;
5. derive the body forward vector in local ENU coordinates;
6. advance east/north position and altitude from that forward vector;
7. apply the C1 altitude bounds.

Altitude bounds remain independent of terrain collision during C1. Terrain/collision behavior belongs to later gates.

## Rendering alignment

The flight model exports its canonical local body frame directly. The Cesium renderer converts that frame from local ENU to ECEF and uses the same frame for aircraft orientation, the asymmetric nose marker, chase-camera position, and camera look direction.

Rendering therefore does not independently reconstruct heading/pitch/bank.

## HUD telemetry

The HUD shows speed, altitude, heading, earth-relative pitch display, wrapped bank display, vertical speed, throttle, controls, and runtime diagnostics.

Because Euler-style heading/pitch/bank displays are derived from a full quaternion, conventional display ambiguity near vertical attitudes is expected. It does not constrain the actual orientation or controls.

`Q/E` is labeled `YAW TEST`; mandatory removal before final release remains tracked by Issue #7.

## Verification evidence

Previous C1 revisions through C1.5 passed GitHub Actions with:
- `pnpm install --frozen-lockfile`: PASS;
- `pnpm validate:scaffold`: PASS;
- `pnpm check`: PASS;
- `pnpm build`: PASS.

Local QA on 2026-09-16 confirmed that the C1.5 body-axis and angular-response model met the required baseline: corrected travel direction, unrestricted pitch and roll, bank-dependent pitch behavior, progressive control response, readable HUD, and acceptable control sensitivity.

## C1.6 acceptance

Automated:
- [ ] `pnpm validate:scaffold` exits 0.
- [ ] `pnpm check` exits 0.
- [ ] `pnpm build` exits 0.
- [x] Orientation remains normalized and finite by construction.
- [x] Pitch/roll angle authority remains unrestricted.
- [x] Pitch/roll angular-velocity acceleration/deceleration is unchanged from C1.5.
- [x] Near-level capture is limited to ±5° and inactive during meaningful angular motion.
- [x] Near-level capture rate is reduced from 24 deg/s to 18 deg/s.

Manual localhost re-verification:
- [ ] Residual pitch within ±5° returns smoothly to 0° after pitch motion settles.
- [ ] Residual bank within ±5° returns smoothly to 0° after roll motion settles.
- [ ] The new 18 deg/s capture feels less abrupt than C1.5.
- [ ] Attitudes outside ±5° are not pulled toward level.
- [ ] W/S and A/D accelerated response remains unchanged.
- [ ] Full loops and continuous rolls remain available.
- [ ] Runtime FPS remains acceptable.

## Deferred

C2 owns theater boundaries and the 30-minute performance/resource gate. C3 owns multiplayer synchronization. C4 owns the abstract competitive game loop. Final release owns removal of the experimental direct-yaw control.
