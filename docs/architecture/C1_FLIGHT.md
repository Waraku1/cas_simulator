# C1 — Flight Vertical Slice

Status: C1.1 QA CORRECTION IMPLEMENTED / LOCAL RE-VERIFY PENDING

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
- `W` / `S`: pitch;
- `A` / `D`: bank;
- `Q` / `E`: yaw input;
- `ArrowUp` / `ArrowDown`: throttle.

`ArrowLeft`, `ArrowRight`, and `Space` are not part of C1 flight control. They are reserved for a later abstract C4 game-action interface.

The integrator clamps frame delta and all primary control/state ranges. When the browser loses focus, pressed-key state is cleared.

## Spawn and orientation correction

Local QA showed that the theater center is close to high terrain, so the original absolute startup altitude was too low. C1.1 raises the initial absolute altitude to 5,400 m and starts at level pitch.

The flight model uses conventional navigation heading (`0° = north`, `90° = east`). Cesium entity HPR is east-referenced, so C1.1 explicitly converts navigation heading before applying entity orientation. This removes the visual heading mismatch observed in the first localhost QA.

## Rendering architecture

Cesium owns the high-frequency visual loop. React does not re-render at display refresh rate: the flight state updates via `requestAnimationFrame`, aircraft pose and camera are applied directly to Cesium properties, and compact telemetry is published to React at roughly 10 Hz for the HUD.

The aircraft representation uses simple Cesium geometry so C1 adds no external 3D-model dependency or asset-fetch cost. The camera range is reduced in C1.1 so the self-aircraft is easier to perceive.

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

The cockpit reference is CSS-only and adds no external 3D asset fetch. It provides an attitude/direction reference while preserving the central terrain view.

The layout adapts at narrower widths and respects `prefers-reduced-motion` for HUD transitions.

## Verification evidence

Initial C1 branch and merged main verification passed:
- `pnpm install --frozen-lockfile`: PASS;
- `pnpm validate:scaffold`: PASS;
- `pnpm check`: PASS;
- `pnpm build`: PASS.

Local QA on 2026-09-16 confirmed:
- Cesium Earth and HUD render together;
- HUD remains legible;
- runtime diagnostics remain visible;
- observed FPS: `97`.

C1.1 was created from those QA findings to correct spawn altitude, display orientation, control mapping, camera proximity, and self-aircraft visual reference.

## C1 acceptance

Automated:
- [x] Initial C1 automated verification passed.
- [x] Flight state is bounded and finite by construction.
- [x] HUD telemetry is decoupled from the high-frequency Cesium render loop.
- [x] No real-aircraft performance model, multiplayer, scoring, damage, or realistic weapon mechanics are introduced.

Manual localhost re-verification required after C1.1:
- [ ] Startup is clearly above terrain.
- [ ] Visual aircraft direction matches the displayed/navigation heading.
- [ ] `W/S`, `A/D`, `Q/E`, and `ArrowUp/ArrowDown` controls behave as shown in the HUD.
- [ ] The closer camera and cockpit/nose reference make self-orientation intuitive.
- [ ] Runtime FPS remains acceptable.

## Deferred

C2 owns theater boundaries and the 30-minute performance/resource gate. C3 owns multiplayer synchronization. C4 owns the abstract competitive game loop.
