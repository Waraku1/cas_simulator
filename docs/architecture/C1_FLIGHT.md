# C1 — Flight Vertical Slice

Status: C1.3 ATTITUDE/MOTION ALIGNMENT IMPLEMENTED / LOCAL RE-VERIFY PENDING

## Objective

Create the first interactive flight experience on top of the C0 Cesium foundation without introducing multiplayer or game-loop mechanics.

## Flight model boundary

The aircraft is fictional and generic. The model is designed for stable, readable game interaction rather than reproduction of any real aircraft's performance, procedures, or handling qualities.

State:
- latitude / longitude;
- altitude;
- heading;
- pitch;
- bank;
- speed;
- throttle;
- vertical speed.

Controls:
- `W` / `S`: pitch-rate input;
- `A` / `D`: bank input;
- `Q` / `E`: experimental direct-yaw input for C1 testing only;
- `ArrowUp` / `ArrowDown`: throttle.

`ArrowLeft`, `ArrowRight`, and `Space` are not part of C1 flight control. They remain reserved for a later abstract C4 game-action interface.

## C1.3 attitude envelope

Local QA found the original attitude envelope too restrictive.

- Pitch is no longer clamped to a narrow maximum.
- Pitch is stored as a wrapped signed angle so continuous 360° loops are possible while the numeric state remains finite.
- Releasing `W` / `S` preserves the attained pitch instead of automatically returning to level.
- Bank authority is expanded from ±55° to ±85°.
- Bank still recenters when `A` / `D` are released for the current arcade-oriented C1 control model.
- `Q` / `E` direct yaw is explicitly experimental and must be removed before final release; bank-induced turning is the canonical turning path.

Altitude remains bounded independently of attitude during C1; terrain/collision behavior belongs to later gates.

## Spawn and motion/orientation alignment

The theater center is close to high terrain, so startup uses an absolute altitude of 5,400 m and level initial pitch.

Two rounds of HPR-sign correction were insufficient to eliminate a localhost-observed forward-direction mismatch. C1.3 therefore removes Cesium HPR heading interpretation from the aircraft/camera alignment path entirely.

The renderer now constructs a body frame directly from the same state variables used by the flight integrator:

- navigation heading defines horizontal forward (`0° = north`, `90° = east`);
- pitch rotates that forward vector toward local up/down;
- bank rotates the body left/up axes about the forward axis;
- body axes are `+X = forward`, `+Y = left`, `+Z = up`.

The same body-forward vector drives:
- aircraft quaternion orientation;
- an asymmetric nose marker;
- chase-camera position;
- camera look direction.

This makes visual forward and simulated motion share one reference-frame contract rather than relying on separate heading conventions.

## Rendering architecture

Cesium owns the high-frequency visual loop. React does not re-render at display refresh rate: flight state updates via `requestAnimationFrame`, aircraft pose and camera are applied directly to Cesium properties, and compact telemetry is published to React at roughly 10 Hz for the HUD.

The aircraft representation uses simple Cesium geometry, including an asymmetric nose marker, so C1 adds no external 3D-model dependency or asset-fetch cost. The camera is positioned directly from the computed aircraft body frame using world-space direction/up vectors.

## HUD contract

The HUD preserves the central viewport and places information around the edges:
- speed left;
- altitude right;
- attitude ladder and reticle center;
- heading / pitch / bank / vertical speed below center;
- throttle lower center;
- controls lower left;
- runtime diagnostics upper right;
- lightweight fictional cockpit/nose reference at the lower center.

`Q/E` is labeled `YAW TEST` so the temporary nature of direct-yaw control is visible during development.

## Verification evidence

Initial C1 verification and previous QA corrections passed GitHub Actions with:
- `pnpm install --frozen-lockfile`: PASS;
- `pnpm validate:scaffold`: PASS;
- `pnpm check`: PASS;
- `pnpm build`: PASS.

Local QA on 2026-09-16 confirmed Cesium Earth/HUD rendering, readable diagnostics, and approximately 97 FPS before C1.3.

## C1 acceptance

Automated:
- [x] Flight state remains finite by construction.
- [x] HUD telemetry is decoupled from the high-frequency Cesium render loop.
- [x] No real-aircraft performance model, multiplayer, scoring, damage, or realistic weapon mechanics are introduced.

Manual localhost re-verification required after C1.3:
- [ ] Visual aircraft nose, camera view, and actual travel direction agree.
- [ ] Full-range pitch input can pass through ±90° and continue through a loop without snapping to level.
- [ ] Bank reaches the expanded ±85° envelope and remains controllable.
- [ ] `Q/E` remains clearly identified as experimental only.
- [ ] Runtime FPS remains acceptable.

## Deferred

C2 owns theater boundaries and the 30-minute performance/resource gate. C3 owns multiplayer synchronization. C4 owns the abstract competitive game loop. Final release owns removal of the experimental direct-yaw control.
